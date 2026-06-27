// AI ③ scenario discovery (Phase 5) — the AI proposes an uncovered flow, deduped against the
// existing suite; the coverage delta is measured; the adopted proposal is a deterministic scenario
// that runs green.

import assert from 'node:assert/strict'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { before, describe, it } from 'node:test'
import { BrowserSession } from 'agrune'
import { runDiscovery } from './discover.js'
import { runScenario } from '../scenario/runner.js'
import { validateScenario, SCENARIO_SCHEMA_ID, type Scenario } from '../scenario/schema.js'

// Two groups: login (covered by an existing scenario) and search (uncovered → should be proposed).
const manifest = {
  version: 3,
  groups: [
    {
      groupId: 'login',
      targets: [
        { targetId: 'user', actionKinds: ['fill'], selector: { css: '#user' } },
        { targetId: 'signin', name: 'Sign in', actionKinds: ['click'], selector: { css: '#signin' } },
      ],
    },
    {
      groupId: 'search',
      targets: [
        { targetId: 'query', actionKinds: ['fill'], selector: { css: '#q' } },
        { targetId: 'go', name: 'Go', actionKinds: ['click'], selector: { css: '#go' } },
      ],
    },
  ],
}

const html = `<!doctype html><html><head><title>Discover App</title></head><body>
<input id="user" /><button id="signin">Sign in</button>
<input id="q" /><button id="go">Go</button>
<script>window.__agrune_manifest__ = ${JSON.stringify(manifest)};</script>
</body></html>`

async function serve(): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end(html)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return { url: `http://127.0.0.1:${port}/`, close: () => new Promise<void>((resolve) => server.close(() => resolve())) }
}

const loginScenario: Scenario = {
  schema: SCENARIO_SCHEMA_ID,
  name: 'login covered',
  manifest: { schemaVersion: 3 },
  steps: [
    { do: 'fill', ref: 'user', value: 'a' },
    { do: 'click', ref: 'signin' },
  ],
}

let available = true

describe('scenario discovery (real chromium)', () => {
  before(async () => {
    const probe = new BrowserSession(true)
    try {
      await probe.start()
      await probe.stop()
    } catch {
      available = false
    }
  })

  it('proposes only the UNCOVERED flow and measures the coverage delta', async (t) => {
    if (!available) return t.skip('chromium unavailable')
    const app = await serve()
    try {
      const report = await runDiscovery({ url: app.url, existing: [loginScenario] })
      assert.equal(report.error, undefined)
      // before: login (2/4) covered
      assert.equal(report.before.covered.length, 2)
      assert.deepEqual(report.before.uncovered.sort(), ['go', 'query'])
      // exactly one proposal — for the uncovered search group
      assert.equal(report.proposals.length, 1)
      assert.deepEqual(report.proposals[0]!.newRefs.sort(), ['go', 'query'])
      // projected coverage reaches 100%
      assert.equal(report.projected.ratio, 1)
    } finally {
      await app.close()
    }
  })

  it('the adopted proposal is a valid, deterministic, GREEN scenario', async (t) => {
    if (!available) return t.skip('chromium unavailable')
    const app = await serve()
    try {
      const report = await runDiscovery({ url: app.url, existing: [loginScenario] })
      const proposed = report.proposals[0]!.scenario
      // it validates as a real scenario (pure data, closed enum)
      assert.equal(validateScenario(proposed).ok, true)
      // and replays green against the app
      const run = await runScenario(proposed, { url: app.url })
      assert.equal(run.status, 'pass', JSON.stringify(run.steps, null, 2))
    } finally {
      await app.close()
    }
  })

  it('proposes nothing when the suite already covers everything', async (t) => {
    if (!available) return t.skip('chromium unavailable')
    const app = await serve()
    try {
      const full: Scenario = {
        schema: SCENARIO_SCHEMA_ID,
        name: 'full',
        manifest: { schemaVersion: 3 },
        steps: [
          { do: 'fill', ref: 'user', value: 'a' },
          { do: 'click', ref: 'signin' },
          { do: 'fill', ref: 'query', value: 'b' },
          { do: 'click', ref: 'go' },
        ],
      }
      const report = await runDiscovery({ url: app.url, existing: [full] })
      assert.equal(report.before.ratio, 1)
      assert.equal(report.proposals.length, 0)
    } finally {
      await app.close()
    }
  })
})
