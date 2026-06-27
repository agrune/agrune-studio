// AI ① auto-repair (Phase 2) — a scenario broken by an app change goes GREEN again with no
// hand-editing, AND a wrong fix can NEVER go green (the verify gate is mechanical).

import assert from 'node:assert/strict'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { before, describe, it } from 'node:test'
import { BrowserSession, type ProposeSelector } from 'agrune'
import { repairScenario } from './heal.js'
import { runScenario } from './runner.js'
import type { Scenario } from './schema.js'

// `signin` is addressed by a CSS id that the drift variant renames (#signin-btn -> #login-btn).
// The button's visible text "Sign in" is stable, so the heuristic (re-ground by name) can heal it.
const manifest = {
  version: 3,
  groups: [
    {
      groupId: 'login',
      targets: [
        { targetId: 'username', actionKinds: ['fill'], selector: { css: '#user' } },
        { targetId: 'signin', name: 'Sign in', actionKinds: ['click'], selector: { css: '#signin-btn' } },
      ],
    },
  ],
}

function pageHtml(drift: boolean): string {
  const id = drift ? 'login-btn' : 'signin-btn'
  return `<!doctype html><html><head><title>Studio Demo App</title></head><body>
<form>
  <input id="user" name="username" />
  <button type="submit" id="${id}">Sign in</button>
</form>
<div id="result" style="display:none"></div>
<script>
window.__agrune_manifest__ = ${JSON.stringify(manifest)};
document.querySelector('button').addEventListener('click', function(e){
  e.preventDefault();
  var r = document.getElementById('result');
  r.textContent = 'Signed in as ' + document.getElementById('user').value;
  r.style.display = 'block';
});
</script>
</body></html>`
}

const scenario: Scenario = {
  schema: 'agrune.scenario/v1',
  name: 'login flow',
  manifest: { schemaVersion: 3 },
  steps: [
    { do: 'fill', ref: 'username', value: 'alice' },
    { do: 'click', ref: 'signin' },
    { assert: 'textPresent', value: 'Signed in as alice' },
  ],
}

async function serve(drift: boolean): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end(pageHtml(drift))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return { url: `http://127.0.0.1:${port}/`, close: () => new Promise<void>((resolve) => server.close(() => resolve())) }
}

let available = true

describe('scenario auto-repair (real chromium)', () => {
  before(async () => {
    const probe = new BrowserSession(true)
    try {
      await probe.start()
      await probe.stop()
    } catch {
      available = false
    }
  })

  it('sanity: scenario is green on the stable app', async (t) => {
    if (!available) return t.skip('chromium unavailable')
    const app = await serve(false)
    try {
      const r = await runScenario(scenario, { url: app.url })
      assert.equal(r.status, 'pass')
    } finally {
      await app.close()
    }
  })

  it('HEALS a drifted ref via an injected proposal (the AI seam)', async (t) => {
    if (!available) return t.skip('chromium unavailable')
    const app = await serve(true)
    const propose: ProposeSelector = async () => ({ css: '#login-btn' })
    try {
      const report = await repairScenario(scenario, { url: app.url, propose })
      assert.equal(report.before.status, 'fail', 'precondition: drift breaks the scenario')
      assert.equal(report.status, 'healed', JSON.stringify(report, null, 2))
      assert.equal(report.driftedRef, 'signin')
      assert.equal(report.after?.status, 'pass')
      const signin = report.mergedManifest?.groups[0]?.targets.find((tt) => tt.targetId === 'signin')
      assert.deepEqual(signin?.selector, { css: '#login-btn' })
    } finally {
      await app.close()
    }
  })

  it('HEALS via the default heuristic (re-ground by visible name)', async (t) => {
    if (!available) return t.skip('chromium unavailable')
    const app = await serve(true)
    try {
      const report = await repairScenario(scenario, { url: app.url }) // default heuristicPropose
      assert.equal(report.status, 'healed', JSON.stringify(report, null, 2))
      const signin = report.mergedManifest?.groups[0]?.targets.find((tt) => tt.targetId === 'signin')
      assert.deepEqual(signin?.selector, { text: 'Sign in' })
    } finally {
      await app.close()
    }
  })

  it('GUARD: a wrong proposal can never go green (needs-human)', async (t) => {
    if (!available) return t.skip('chromium unavailable')
    const app = await serve(true)
    const propose: ProposeSelector = async () => ({ css: '#does-not-exist' })
    try {
      const report = await repairScenario(scenario, { url: app.url, propose })
      assert.equal(report.status, 'needs-human')
      assert.equal(report.after, undefined, 'no healed replay when nothing passed the gate')
      const verdict = report.verdicts?.find((v) => v.targetId === 'signin')
      assert.equal(verdict?.eligible, false)
      assert.equal(verdict?.resolves, false)
    } finally {
      await app.close()
    }
  })

  it('reports already-green when nothing is broken', async (t) => {
    if (!available) return t.skip('chromium unavailable')
    const app = await serve(false)
    try {
      const report = await repairScenario(scenario, { url: app.url })
      assert.equal(report.status, 'already-green')
    } finally {
      await app.close()
    }
  })
})
