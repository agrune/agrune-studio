// AI ② monkey testing (Phase 4) — a bounded run surfaces a reproducible console error as a
// candidate scenario; the candidate, replayed, reproduces the finding; and a clean app yields no
// findings. The monkey only ever actuates DECLARED targets (the strict-mode cage).

import assert from 'node:assert/strict'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { before, describe, it } from 'node:test'
import { BrowserSession } from 'agrune'
import { runMonkey } from './explore.js'
import { runScenario } from '../scenario/runner.js'

// Two declared targets: a harmless input, and a "boom" button that throws on click (→ console error).
const manifest = {
  version: 3,
  groups: [
    {
      groupId: 'app',
      targets: [
        { targetId: 'note', actionKinds: ['fill'], selector: { css: '#note' } },
        { targetId: 'boom', name: 'Boom', actionKinds: ['click'], selector: { css: '#boom' } },
      ],
    },
  ],
}

function pageHtml(buggy: boolean): string {
  const handler = buggy
    ? `throw new Error('monkey-found-bug: kaboom');`
    : `document.getElementById('out').textContent = 'ok';`
  return `<!doctype html><html><head><title>Monkey Target</title></head><body>
<input id="note" />
<button id="boom">Boom</button>
<div id="out"></div>
<script>
window.__agrune_manifest__ = ${JSON.stringify(manifest)};
document.getElementById('boom').addEventListener('click', function(){ ${handler} });
</script>
</body></html>`
}

async function serve(buggy: boolean): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end(pageHtml(buggy))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return { url: `http://127.0.0.1:${port}/`, close: () => new Promise<void>((resolve) => server.close(() => resolve())) }
}

let available = true

describe('monkey explorer (real chromium)', () => {
  before(async () => {
    const probe = new BrowserSession(true)
    try {
      await probe.start()
      await probe.stop()
    } catch {
      available = false
    }
  })

  it('surfaces a console error as a reproducible candidate scenario', async (t) => {
    if (!available) return t.skip('chromium unavailable')
    const app = await serve(true)
    try {
      const report = await runMonkey({ url: app.url, maxSteps: 8, seed: 7, stopOnFirst: true })
      assert.ok(report.findings.length >= 1, 'expected at least one finding')
      const finding = report.findings[0]!
      assert.equal(finding.kind, 'console-error')
      // the trail that triggered it must include the boom click
      assert.ok(finding.steps.some((s) => s.do === 'click' && s.ref === 'boom'))
      // the candidate is a valid, replayable scenario that reproduces the finding
      const replay = await runScenario(finding.candidate, {})
      assert.equal(replay.status, 'fail', 'candidate should reproduce the bug (red)')
      const failed = replay.steps.find((s) => s.status === 'fail')
      assert.ok(failed?.summary.includes('noConsoleErrors'))
    } finally {
      await app.close()
    }
  })

  it('finds nothing on a clean app, and only ever touches declared targets', async (t) => {
    if (!available) return t.skip('chromium unavailable')
    const app = await serve(false)
    try {
      const report = await runMonkey({ url: app.url, maxSteps: 8, seed: 7 })
      assert.equal(report.findings.length, 0)
      // every actuated ref is a declared manifest target (the cage)
      for (const ref of report.visited) assert.ok(['note', 'boom'].includes(ref), `off-manifest ref: ${ref}`)
    } finally {
      await app.close()
    }
  })

  it('is reproducible: same (url, seed) → same trail', async (t) => {
    if (!available) return t.skip('chromium unavailable')
    const app = await serve(false)
    try {
      const a = await runMonkey({ url: app.url, maxSteps: 6, seed: 42 })
      const b = await runMonkey({ url: app.url, maxSteps: 6, seed: 42 })
      assert.deepEqual(a.visited, b.visited)
    } finally {
      await app.close()
    }
  })
})
