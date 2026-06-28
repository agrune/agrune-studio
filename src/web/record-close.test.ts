import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import { before, describe, it } from 'node:test'
import { BrowserSession } from 'agrune'
import { startRecording } from '../record/capture.js'

const manifest = { version: 3, groups: [{ groupId: 'app', targets: [{ targetId: 'go', actionKinds: ['click'], selector: { css: '#go' } }] }] }
function pageHtml(): string {
  return `<!doctype html><html><head><title>Close</title></head><body><button id="go">Go</button>
<script>window.__agrune_manifest__ = ${JSON.stringify(manifest)};</script></body></html>`
}
async function serve() {
  const server = http.createServer((_q, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(pageHtml()) })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const { port } = server.address() as AddressInfo
  return { url: `http://127.0.0.1:${port}/`, close: () => new Promise<void>((r) => server.close(() => r())) }
}
async function waitFor(pred: () => boolean | Promise<boolean>, ms = 5000) {
  const t0 = Date.now()
  while (!(await pred())) { if (Date.now() - t0 > ms) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 50)) }
}

let available = true
describe('graceful close (real chromium)', () => {
  before(async () => { const p = new BrowserSession(true); try { await p.start(); await p.stop() } catch { available = false } })

  it('closing the page persists the trail and fires onClosed', async (t) => {
    if (!available) return t.skip('chromium unavailable')
    const app = await serve()
    const dir = await mkdtemp(path.join(tmpdir(), 'rec-'))
    let closed = false
    const ctrl = await startRecording({ url: app.url, artifactsDir: dir, headless: true, onClosed: () => { closed = true } })
    try {
      await ctrl.browser.page().close() // simulate the user closing the QA window
      await waitFor(() => closed)
      const raw = await readFile(path.join(dir, 'trail.json'), 'utf8') // trail persisted on close
      assert.ok(JSON.parse(raw).version === 1)
    } finally {
      await ctrl.stop().catch(() => undefined)
      await rm(dir, { recursive: true, force: true })
      await app.close()
    }
  })
})
