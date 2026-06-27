// Deterministic runner — replays a scenario against a real (locally served) app via real chromium.
// Proves the Phase 1 done-criterion: a scenario replays GREEN on a stable app and flips RED on an
// intentional break — assertion drift AND target (selector) drift.
//
// Guards on browser availability: if chromium can't launch, the browser cases are skipped (the
// schema cases run regardless), mirroring the core's integration-test pattern.

import assert from 'node:assert/strict'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { after, before, describe, it } from 'node:test'
import { BrowserSession } from 'agrune'
import { runScenario } from './runner.js'
import type { Scenario } from './schema.js'

const manifest = {
  version: 3,
  groups: [
    {
      groupId: 'login',
      targets: [
        { targetId: 'username', actionKinds: ['fill'], selector: { css: '#user' } },
        { targetId: 'signin', actionKinds: ['click'], selector: { role: { name: 'button' }, text: 'Sign in' } },
      ],
    },
  ],
}

type Variant = 'stable' | 'assertion-break' | 'target-drift'

function pageHtml(variant: Variant): string {
  // assertion-break: the success message changes → textPresent fails.
  // target-drift: the Sign in button is gone (replaced by a non-button) → `signin` ref won't resolve.
  const button =
    variant === 'target-drift'
      ? `<span id="signin">Submit now</span>`
      : `<button type="submit" id="signin">Sign in</button>`
  const message = variant === 'assertion-break' ? 'Login failed' : 'Signed in as %u'
  return `<!doctype html><html><head><title>Studio Demo App</title></head><body>
<h1>Welcome</h1>
<form>
  <input id="user" name="username" />
  ${button}
</form>
<div id="result" style="display:none"></div>
<script>
window.__agrune_manifest__ = ${JSON.stringify(manifest)};
var b = document.getElementById('signin');
b.addEventListener('click', function(e){
  e.preventDefault();
  var r = document.getElementById('result');
  r.textContent = ${JSON.stringify(message)}.replace('%u', document.getElementById('user').value);
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
    { assert: 'titleContains', value: 'Studio Demo' },
    { assert: 'noConsoleErrors' },
  ],
}

async function serve(variant: Variant): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end(pageHtml(variant))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}/`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

let available = true

describe('scenario runner (real chromium)', () => {
  before(async () => {
    const probe = new BrowserSession(true)
    try {
      await probe.start()
      await probe.stop()
    } catch {
      available = false
    }
  })

  it('replays GREEN on a stable app', async (t) => {
    if (!available) return t.skip('chromium unavailable')
    const app = await serve('stable')
    try {
      const report = await runScenario(scenario, { url: app.url })
      assert.equal(report.error, undefined)
      assert.equal(report.status, 'pass', JSON.stringify(report.steps, null, 2))
      assert.equal(report.failed, 0)
      assert.equal(report.passed, scenario.steps.length)
    } finally {
      await app.close()
    }
  })

  it('flips RED on an assertion break', async (t) => {
    if (!available) return t.skip('chromium unavailable')
    const app = await serve('assertion-break')
    try {
      const report = await runScenario(scenario, { url: app.url })
      assert.equal(report.status, 'fail')
      const failed = report.steps.find((s) => s.status === 'fail')
      assert.ok(failed, 'expected a failing step')
      assert.equal(failed!.summary.includes('textPresent'), true)
      // stop-on-first-failure: later steps are skipped, not run
      assert.ok(report.skipped >= 1)
    } finally {
      await app.close()
    }
  })

  it('flips RED on target (selector) drift — the ref no longer resolves', async (t) => {
    if (!available) return t.skip('chromium unavailable')
    const app = await serve('target-drift')
    try {
      const report = await runScenario(scenario, { url: app.url })
      assert.equal(report.status, 'fail')
      const failed = report.steps.find((s) => s.status === 'fail')
      assert.ok(failed, 'expected a failing step')
      // the click on `signin` is where drift bites
      assert.equal(failed!.summary.includes('signin'), true)
    } finally {
      await app.close()
    }
  })

  it('reports a setup error when no URL is available', async () => {
    const report = await runScenario({ ...scenario, url: undefined }, { headless: true })
    // about:blank opens, but the manifest/refs won't resolve → first action fails (not a crash)
    assert.equal(report.status, 'fail')
  })
})
