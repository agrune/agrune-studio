import assert from 'node:assert/strict'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { before, describe, it } from 'node:test'
import { BrowserSession } from 'agrune'
import { startServer } from './server.js'

const manifest = {
  version: 3,
  groups: [{ groupId: 'app', targets: [{ targetId: 'go', name: 'Go', actionKinds: ['click'], selector: { css: '#go' } }] }],
}

// the page auto-clicks #go shortly after load, so the recorder captures an entry with no external input
function pageHtml(): string {
  return `<!doctype html><html><head><title>Auto</title></head><body>
<button id="go">Go</button>
<script>window.__agrune_manifest__ = ${JSON.stringify(manifest)};
setTimeout(function(){ document.getElementById('go').click(); }, 300);</script>
</body></html>`
}

async function serveApp(): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end(pageHtml())
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return { url: `http://127.0.0.1:${port}/`, close: () => new Promise<void>((resolve) => server.close(() => resolve())) }
}

async function post(base: string, path: string, body: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return { status: res.status, json: await res.json().catch(() => ({})) }
}

let available = true

describe('record routes (real chromium)', () => {
  before(async () => {
    const probe = new BrowserSession(true)
    try {
      await probe.start()
      await probe.stop()
    } catch {
      available = false
    }
  })

  it('start → status (captures auto-click) → extract → stop', async (t) => {
    if (!available) return t.skip('chromium unavailable')
    const app = await serveApp()
    const studio = await startServer({ port: 0 })
    try {
      const started = await post(studio.url, '/api/record/start', { url: app.url, headless: true })
      assert.equal(started.status, 200)
      const id = started.json.id as string
      assert.ok(id)

      // poll status until the auto-click is captured and mapped
      let mapped = false
      for (let i = 0; i < 60 && !mapped; i += 1) {
        const st = await post(studio.url, '/api/record/status', { id })
        mapped = (st.json.recording?.entries ?? []).some((e: any) => e.ref === 'go')
        if (!mapped) await new Promise((r) => setTimeout(r, 100))
      }
      assert.ok(mapped, 'expected the auto-click to be captured and mapped to ref "go"')

      const ex = await post(studio.url, '/api/record/extract', { id })
      assert.equal(ex.status, 200)
      assert.ok(ex.json.scenario, 'extract returns a scenario')

      const stopped = await post(studio.url, '/api/record/stop', { id })
      assert.equal(stopped.status, 200)
      assert.equal(stopped.json.recording.version, 1)
    } finally {
      await studio.close()
      await app.close()
    }
  })
})
