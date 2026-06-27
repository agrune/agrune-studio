// Agrune Studio dashboard — talks to the Node backend which drives the real engine.

const state = { url: 'http://127.0.0.1:4178', meta: null, panel: 'scenarios', pendingScenario: null }

// ---- tiny DOM helpers ------------------------------------------------------
function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v
    else if (k === 'html') e.innerHTML = v
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v)
    else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v === true ? '' : v)
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue
    e.append(kid.nodeType ? kid : document.createTextNode(String(kid)))
  }
  return e
}
const $ = (sel) => document.querySelector(sel)

async function api(path, body) {
  const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`)
  return data
}

function urlField() {
  return h('div', { class: 'col', style: 'flex:1;min-width:320px' },
    h('label', {}, 'App URL'),
    h('input', { type: 'text', value: state.url, placeholder: 'http://localhost:3000', oninput: (e) => (state.url = e.target.value) }),
  )
}

function jsonArea(value, rows = 16) {
  return h('textarea', { rows, spellcheck: 'false' }, typeof value === 'string' ? value : JSON.stringify(value, null, 2))
}

function busy(btn, on) {
  btn.disabled = on
  btn.dataset.label ??= btn.textContent
  btn.textContent = ''
  if (on) btn.append(h('span', { class: 'spinner' }), ' running…')
  else btn.textContent = btn.dataset.label
}

// ---- report rendering (shared by run / catalog run) ------------------------
function renderScenarioReport(report) {
  const ok = report.status === 'pass'
  const stepEls = report.steps.map((s) =>
    h('div', { class: `step ${s.status}` },
      h('span', { class: 'mark' }, s.status === 'pass' ? '✓' : s.status === 'fail' ? '✗' : '·'),
      h('div', { style: 'flex:1' },
        h('div', { class: 'summary' }, `${s.index + 1}. ${s.summary}`),
        s.detail ? h('div', { class: 'detail' }, s.detail) : null,
      ),
      h('span', { class: 'dur' }, `${s.durationMs}ms`),
    ),
  )
  const shots = report.steps.filter((s) => s.screenshot).map((s) =>
    h('img', { src: s.screenshot, alt: s.summary, onclick: () => openLightbox(s.screenshot) }),
  )
  return h('div', {},
    h('div', { class: `banner ${ok ? 'pass' : 'fail'}` },
      h('b', {}, ok ? 'PASS' : 'FAIL'), `${report.scenario} — ${report.passed} passed, ${report.failed} failed, ${report.skipped} skipped (${report.durationMs}ms)`,
    ),
    report.error ? h('div', { class: 'err' }, report.error) : null,
    h('div', { class: 'steps' }, ...stepEls),
    shots.length ? h('div', { class: 'shots' }, ...shots) : null,
  )
}

function openLightbox(src) {
  $('#lightbox-img').src = src
  $('#lightbox').classList.remove('hidden')
}

// ---- panels ----------------------------------------------------------------
const panels = {
  scenarios: {
    title: 'Scenarios',
    desc: 'Author a deterministic scenario over manifest refs, replay it against a real app, get a pass/fail report with screenshots.',
    render(c) {
      const ta = jsonArea(sampleScenario())
      const out = h('div', {})
      const validateBtn = h('button', { class: 'btn ghost' }, 'Validate')
      const runBtn = h('button', { class: 'btn' }, 'Run')
      validateBtn.onclick = async () => {
        try {
          const r = await api('/api/scenario/validate', { scenario: parse(ta) })
          out.replaceChildren(h('div', { class: `banner ${r.ok ? 'pass' : 'fail'}` }, r.ok ? 'Scenario is valid ✓' : 'Invalid: ' + r.errors.map((e) => `${e.path} ${e.message}`).join('; ')))
        } catch (e) { out.replaceChildren(h('div', { class: 'err' }, e.message)) }
      }
      runBtn.onclick = async () => {
        busy(runBtn, true); out.replaceChildren(h('div', { class: 'muted' }, 'launching a browser, replaying…'))
        try {
          const report = await api('/api/scenario/run', { scenario: parse(ta), url: state.url })
          out.replaceChildren(renderScenarioReport(report))
        } catch (e) { out.replaceChildren(h('div', { class: 'err' }, e.message)) }
        finally { busy(runBtn, false) }
      }
      c.append(
        h('div', { class: 'row', style: 'margin-bottom:16px' }, urlField()),
        h('div', { class: 'grid-2' },
          h('div', { class: 'card' }, h('h3', {}, 'Scenario'), ta, h('div', { class: 'row', style: 'margin-top:12px' }, runBtn, validateBtn)),
          h('div', { class: 'card' }, h('h3', {}, 'Report'), out),
        ),
      )
    },
  },

  recorder: {
    title: 'Flight Recorder',
    desc: 'QA 모드 창을 띄워 행동·콘솔·네트워크·스크린샷을 블랙박스로 캡처하고, 버그 순간을 박제해 시나리오로 추출합니다.',
    render(c) {
      const out = h('div', {})
      const startBtn = h('button', { class: 'btn' }, '녹화 시작')
      startBtn.onclick = async () => {
        busy(startBtn, true)
        try {
          const r = await api('/api/record/start', { url: state.url })
          recorderSession(out, r.id)
          startBtn.disabled = true; startBtn.textContent = '녹화 중…'
        } catch (e) { out.replaceChildren(h('div', { class: 'err' }, e.message)); busy(startBtn, false) }
      }
      c.append(
        h('div', { class: 'card' },
          h('div', { class: 'row' }, urlField(), h('div', { style: 'align-self:flex-end' }, startBtn)),
          h('p', { class: 'muted', style: 'margin:10px 0 0' }, '시작하면 QA 모드 브라우저 창이 뜹니다. 그 창에서 평소처럼 앱을 조작하세요. 캡처는 이 창 동안에만 일어납니다.'),
        ),
        h('div', { class: 'card', style: 'margin-top:20px' }, out),
      )
    },
  },

  repair: {
    title: 'Auto-repair (AI ①)',
    desc: 'When a ref drifts, propose a new selector → the core verify gate → replay against the healed map. A wrong fix can never go green.',
    render(c) {
      const ta = jsonArea(sampleScenario())
      const out = h('div', {})
      const btn = h('button', { class: 'btn' }, 'Repair')
      btn.onclick = async () => {
        busy(btn, true); out.replaceChildren(h('div', { class: 'muted' }, 'running scenario, attempting repair…'))
        try {
          const r = await api('/api/scenario/repair', { scenario: parse(ta), url: state.url })
          const cls = r.status === 'healed' ? 'pass' : r.status === 'already-green' ? 'pass' : 'warn'
          out.replaceChildren(
            h('div', { class: `banner ${cls}` }, h('b', {}, r.status.toUpperCase().replace('-', ' ')), r.scenario),
            r.driftedRef ? h('div', { class: 'kv', style: 'margin-top:12px' }, h('b', {}, 'drifted ref'), h('span', {}, r.driftedRef)) : null,
            (r.proposed || []).length ? h('div', { style: 'margin-top:10px' }, h('label', {}, 'proposed'), ...(r.proposed.map((p) => h('div', { class: 'tag' }, `${p.targetId} → ${JSON.stringify(p.selector)}`)))) : null,
            (r.verdicts || []).length ? h('div', { style: 'margin-top:10px' }, h('label', {}, 'verify gate'), ...r.verdicts.map((v) => h('div', { class: 'tag' }, `${v.targetId}: ${v.eligible ? 'ELIGIBLE' : 'rejected — ' + (v.reason || '')}`))) : null,
            r.detail ? h('div', { class: 'muted', style: 'margin-top:10px' }, r.detail) : null,
            r.after ? h('div', { style: 'margin-top:16px' }, h('label', {}, 'replay after heal'), renderScenarioReport(r.after)) : null,
          )
        } catch (e) { out.replaceChildren(h('div', { class: 'err' }, e.message)) }
        finally { busy(btn, false) }
      }
      c.append(
        h('div', { class: 'row', style: 'margin-bottom:16px' }, urlField()),
        h('div', { class: 'grid-2' },
          h('div', { class: 'card' }, h('h3', {}, 'Scenario'), ta, h('div', { class: 'row', style: 'margin-top:12px' }, btn)),
          h('div', { class: 'card' }, h('h3', {}, 'Repair console'), out),
        ),
      )
    },
  },

  monkey: {
    title: 'Monkey testing (AI ②)',
    desc: 'Bounded exploration over declared targets. Crash / console / network oracle. A finding becomes a reproducible candidate scenario.',
    render(c) {
      const steps = h('input', { type: 'number', value: '25', style: 'width:90px' })
      const seed = h('input', { type: 'number', value: '1', style: 'width:90px' })
      const out = h('div', {})
      const btn = h('button', { class: 'btn' }, 'Run monkey')
      btn.onclick = async () => {
        busy(btn, true); out.replaceChildren(h('div', { class: 'muted' }, 'exploring…'))
        try {
          const r = await api('/api/monkey', { url: state.url, steps: Number(steps.value), seed: Number(seed.value) })
          out.replaceChildren(
            h('div', { class: `banner ${r.findings.length ? 'fail' : 'pass'}` }, h('b', {}, r.findings.length ? `${r.findings.length} FINDING(S)` : 'CLEAN'), `${r.stepsAttempted} steps · ${r.visited.length} targets · seed ${r.seed}`),
            ...r.findings.map((f) => h('div', { class: 'proposal' },
              h('h4', {}, `[${f.kind}] at step ${f.atStep + 1}`),
              h('div', { class: 'muted', style: 'font-size:12px' }, f.detail),
              h('div', { style: 'margin-top:8px' }, h('label', {}, 'repro'), h('div', {}, ...f.steps.map((s) => h('span', { class: 'tag' }, s.do + (s.ref ? ' ' + s.ref : ''))))),
              h('details', { style: 'margin-top:8px' }, h('summary', { class: 'muted' }, 'candidate scenario'), h('pre', { class: 'json' }, JSON.stringify(f.candidate, null, 2))),
            )),
            r.findings.length ? null : h('div', { class: 'muted', style: 'margin-top:10px' }, `Actuated ${r.visited.length} declared targets, no crash/console/network errors surfaced.`),
          )
        } catch (e) { out.replaceChildren(h('div', { class: 'err' }, e.message)) }
        finally { busy(btn, false) }
      }
      c.append(
        h('div', { class: 'card' },
          h('div', { class: 'row' }, urlField(), h('div', { class: 'col' }, h('label', {}, 'steps'), steps), h('div', { class: 'col' }, h('label', {}, 'seed'), seed), h('div', { style: 'align-self:flex-end' }, btn)),
        ),
        h('div', { class: 'card', style: 'margin-top:20px' }, h('h3', {}, 'Findings'), out),
      )
    },
  },

  discover: {
    title: 'Scenario discovery (AI ③)',
    desc: 'Walk the app, measure coverage against your suite, propose uncovered flows for you to adopt.',
    render(c) {
      const existing = jsonArea('[]', 8)
      const out = h('div', {})
      const btn = h('button', { class: 'btn' }, 'Discover')
      btn.onclick = async () => {
        busy(btn, true); out.replaceChildren(h('div', { class: 'muted' }, 'walking the app…'))
        try {
          let ex = []
          try { ex = JSON.parse(existing.value || '[]') } catch { ex = [] }
          const r = await api('/api/discover', { url: state.url, existing: ex })
          if (r.error) { out.replaceChildren(h('div', { class: 'err' }, r.error)); return }
          const pct = Math.round(r.before.ratio * 100), pj = Math.round(r.projected.ratio * 100)
          out.replaceChildren(
            h('div', { class: 'kv' }, h('b', {}, 'coverage'), h('span', {}, `${r.before.covered.length}/${r.before.declared.length} (${pct}%) → projected ${pj}% if all adopted`)),
            h('div', { class: 'bar', style: 'margin:8px 0 4px' }, h('span', { style: `width:${pct}%` })),
            ...(r.proposals.length ? r.proposals.map((p, i) => h('div', { class: 'proposal' },
              h('h4', {}, `[${i}] ${p.name}`),
              h('div', { class: 'muted', style: 'font-size:12px' }, p.rationale),
              h('div', { style: 'margin-top:6px' }, ...p.newRefs.map((x) => h('span', { class: 'tag' }, x))),
              h('details', { style: 'margin-top:8px' }, h('summary', { class: 'muted' }, 'scenario'), h('pre', { class: 'json' }, JSON.stringify(p.scenario, null, 2))),
            )) : [h('div', { class: 'empty' }, 'No new flows — coverage is complete or nothing actionable is uncovered.')]),
          )
        } catch (e) { out.replaceChildren(h('div', { class: 'err' }, e.message)) }
        finally { busy(btn, false) }
      }
      c.append(
        h('div', { class: 'row', style: 'margin-bottom:16px' }, urlField()),
        h('div', { class: 'grid-2' },
          h('div', { class: 'card' }, h('h3', {}, 'Existing suite (JSON array, optional)'), existing, h('div', { class: 'row', style: 'margin-top:12px' }, btn)),
          h('div', { class: 'card' }, h('h3', {}, 'Coverage + proposals'), out),
        ),
      )
    },
  },

  catalog: {
    title: 'Site-pack catalog',
    desc: 'Discover signed site packs over the store, verify provenance under the pinned root + keyset, install + run.',
    render(c) {
      const store = h('input', { type: 'text', placeholder: '/path/to/store' })
      const root = h('input', { type: 'text', placeholder: 'root public key (PEM/base64/path)' })
      const keyset = h('input', { type: 'text', placeholder: '/path/to/keyset.json' })
      const dest = h('input', { type: 'text', placeholder: '/path/to/install/dir' })
      const out = h('div', {})
      const listBtn = h('button', { class: 'btn' }, 'List catalog')
      listBtn.onclick = async () => {
        busy(listBtn, true); out.replaceChildren(h('div', { class: 'muted' }, 'verifying packs…'))
        try {
          const r = await api('/api/catalog/list', { store: store.value, root: root.value, keyset: keyset.value })
          out.replaceChildren(...(r.items.length ? r.items.map((it) => catalogCard(it, { store, root, keyset, dest, out })) : [h('div', { class: 'empty' }, 'catalog is empty')]))
        } catch (e) { out.replaceChildren(h('div', { class: 'err' }, e.message)) }
        finally { busy(listBtn, false) }
      }
      c.append(
        h('div', { class: 'card' },
          h('div', { class: 'grid-2' },
            h('div', { class: 'col' }, h('label', {}, 'store dir'), store, h('label', { style: 'margin-top:8px' }, 'keyset.json'), keyset),
            h('div', { class: 'col' }, h('label', {}, 'root public key'), root, h('label', { style: 'margin-top:8px' }, 'install dest'), dest),
          ),
          h('div', { class: 'row', style: 'margin-top:12px' }, listBtn),
        ),
        h('div', { class: 'card', style: 'margin-top:20px' }, h('h3', {}, 'Packs'), out),
      )
    },
  },
}

function catalogCard(it, ctx) {
  const status = it.verified ? h('span', { class: 'badge ok' }, '✓ verified') : h('span', { class: 'badge bad' }, '✗ ' + (it.reason || 'unverified'))
  const runUrl = h('input', { type: 'text', value: state.url, style: 'max-width:260px' })
  const result = h('div', {})
  const installBtn = h('button', { class: 'btn sm' }, 'Install')
  const runBtn = h('button', { class: 'btn sm ghost' }, 'Run scenarios')
  installBtn.onclick = async () => {
    busy(installBtn, true)
    try {
      const r = await api('/api/catalog/install', { store: ctx.store.value, root: ctx.root.value, keyset: ctx.keyset.value, origin: it.origin, version: it.version, dest: ctx.dest.value })
      result.replaceChildren(h('div', { class: 'banner pass' }, 'installed + pinned', ` ${r.origin}@${r.version} (${r.scenarioPaths.length} scenarios)`))
    } catch (e) { result.replaceChildren(h('div', { class: 'err' }, e.message)) }
    finally { busy(installBtn, false) }
  }
  runBtn.onclick = async () => {
    busy(runBtn, true)
    try {
      const r = await api('/api/catalog/run', { dest: ctx.dest.value, origin: it.origin, url: runUrl.value })
      result.replaceChildren(...r.reports.map(renderScenarioReport), h('div', { class: 'muted', style: 'margin-top:8px' }, `${r.passed} passed, ${r.failed} failed`))
    } catch (e) { result.replaceChildren(h('div', { class: 'err' }, e.message)) }
    finally { busy(runBtn, false) }
  }
  return h('div', { class: 'proposal' },
    h('div', { class: 'row', style: 'justify-content:space-between' }, h('h4', {}, `${it.name || it.origin} · v${it.version}`), status),
    h('div', { class: 'kv', style: 'margin-top:6px' },
      h('b', {}, 'origin'), h('span', {}, it.origin),
      h('b', {}, 'signer'), h('span', {}, it.signerKeyId || '—'),
      h('b', {}, 'published'), h('span', {}, it.publishedAt || '—'),
      h('b', {}, 'scenarios'), h('span', {}, it.scenarioCount ?? '—'),
    ),
    h('div', { class: 'row', style: 'margin-top:10px' }, installBtn, runBtn, runUrl),
    result,
  )
}

// ---- recorder session (live polling) --------------------------------------
function recorderSession(out, id) {
  let polling = true
  const timeline = h('div', { class: 'steps' })
  const status = h('div', { class: 'muted' }, 'recording… (창에서 앱을 조작하세요)')
  const bugBtn = h('button', { class: 'btn sm', style: 'background:#f85149' }, '버그다!')
  const cpBtn = h('button', { class: 'btn sm ghost' }, '체크포인트')
  const stopBtn = h('button', { class: 'btn sm ghost' }, '정지')
  const extractBtn = h('button', { class: 'btn' }, '시나리오 추출')
  const extractOut = h('div', {})

  bugBtn.onclick = () => api('/api/record/bug', { id }).catch(() => {})
  cpBtn.onclick = () => api('/api/record/checkpoint', { id }).catch(() => {})
  stopBtn.onclick = async () => { polling = false; await api('/api/record/stop', { id }).catch(() => {}); status.textContent = 'stopped.' }
  extractBtn.onclick = async () => {
    busy(extractBtn, true)
    try {
      const r = await api('/api/record/extract', { id })
      extractOut.replaceChildren(
        h('div', { class: 'banner pass' }, h('b', {}, '추출됨'), ` ${r.scenario.steps.length} steps`),
        r.gaps?.length ? h('div', { class: 'banner warn', style: 'margin-top:8px' }, `${r.gaps?.length} unmapped — 매니페스트에 추가해야 테스트로 박힙니다`) : null,
        h('div', { class: 'row', style: 'margin-top:10px' }, h('button', { class: 'btn sm', onclick: () => sendToScenarios(r.scenario) }, 'Scenarios로 보내기')),
        h('pre', { class: 'json', style: 'margin-top:10px' }, JSON.stringify(r.scenario, null, 2)),
      )
    } catch (e) { extractOut.replaceChildren(h('div', { class: 'err' }, e.message)) }
    finally { busy(extractBtn, false) }
  }

  out.replaceChildren(
    h('div', { class: 'row', style: 'justify-content:space-between' }, status, h('div', { class: 'row' }, bugBtn, cpBtn, stopBtn)),
    timeline,
    h('div', { class: 'row', style: 'margin-top:14px' }, extractBtn),
    extractOut,
  )

  async function tick() {
    if (!polling) return
    try {
      const r = await api('/api/record/status', { id })
      renderTimeline(timeline, r.recording)
    } catch (err) { if (polling) console.warn('recorder poll error', err) }
    if (polling) setTimeout(tick, 1000)
  }
  tick()
}

function renderTimeline(container, recording) {
  const isBookmark = (i) => recording.bookmarks.includes(i)
  container.replaceChildren(...recording.entries.map((e, i) => {
    const mark = e.kind === 'action' ? (e.ref ? '✓' : '⚠') : e.kind === 'nav' ? '↪' : '★'
    const label = e.kind === 'action'
      ? `${e.action.do} ${e.ref ? e.ref : '(unmapped: ' + (e.action.rawTarget.css || e.action.rawTarget.tag) + ')'}${e.action.value ? ' = "' + e.action.value + '"' : ''}`
      : e.kind === 'nav' ? `nav → ${e.navUrl}` : e.kind === 'checkpoint' ? 'checkpoint' : (e.note || 'bookmark')
    const cls = e.kind === 'action' && !e.ref ? 'step skipped' : isBookmark(i) || (e.anomalies && e.anomalies.length) ? 'step fail' : 'step pass'
    const anomaly = e.anomalies && e.anomalies.length ? h('div', { class: 'detail' }, e.anomalies.map((a) => `${a.kind}: ${a.detail}`).join('; ')) : null
    const thumb = e.screenshot ? h('img', { src: e.screenshot, alt: label, style: 'width:90px;height:56px;object-fit:cover;object-position:top;border:1px solid var(--border);border-radius:6px;cursor:zoom-in', onclick: () => openLightbox(e.screenshot) }) : null
    return h('div', { class: cls },
      h('span', { class: 'mark' }, mark),
      h('div', { style: 'flex:1' }, h('div', { class: 'summary' }, `${i + 1}. ${label}`), anomaly),
      thumb,
    )
  }))
}

function sendToScenarios(scenario) {
  state.pendingScenario = scenario
  select('scenarios')
}

// ---- helpers ---------------------------------------------------------------
function parse(ta) {
  try { return JSON.parse(ta.value) } catch (e) { throw new Error('scenario JSON parse error: ' + e.message) }
}
function sampleScenario() {
  if (state.pendingScenario) {
    const p = state.pendingScenario
    state.pendingScenario = null
    return p
  }
  const s = state.meta?.sample ? structuredClone(state.meta.sample) : { schema: 'agrune.scenario/v1', name: 'my scenario', manifest: { schemaVersion: 3 }, steps: [] }
  s.url = state.url
  s.name = 'demo flow'
  s.steps = [
    { do: 'click', ref: 'nav_board_tab', label: 'open board' },
    { do: 'click', ref: 'board_new_task_button', label: 'new task' },
    { do: 'fill', ref: 'wizard_title_input', value: 'Ship the catalog' },
    { assert: 'targetVisible', ref: 'wizard_title_input', label: 'wizard open' },
    { assert: 'noConsoleErrors' },
  ]
  return s
}

// ---- shell -----------------------------------------------------------------
const NAV = [
  ['scenarios', '▶', 'Scenarios'],
  ['recorder', '⏺', 'Recorder'],
  ['repair', '✚', 'Auto-repair'],
  ['monkey', '🐒', 'Monkey'],
  ['discover', '🧭', 'Discover'],
  ['catalog', '📦', 'Catalog'],
]
function renderNav() {
  const nav = $('#nav')
  nav.replaceChildren(...NAV.map(([key, ic, label]) =>
    h('button', { class: `nav-item ${state.panel === key ? 'active' : ''}`, onclick: () => select(key) }, h('span', { class: 'ic' }, ic), label),
  ))
}
function select(key) {
  state.panel = key
  renderNav()
  const p = panels[key]
  $('#panel-title').textContent = p.title
  $('#panel-desc').textContent = p.desc
  const c = $('#panel')
  c.replaceChildren()
  p.render(c)
}

$('#lightbox').addEventListener('click', () => $('#lightbox').classList.add('hidden'))

async function boot() {
  try {
    state.meta = await fetch('/api/meta').then((r) => r.json())
  } catch { /* offline meta is fine */ }
  renderNav()
  select('scenarios')
}
boot()
