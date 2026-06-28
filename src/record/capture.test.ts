import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import { before, describe, it } from 'node:test'
import { BrowserSession } from 'agrune'
import { startRecording } from './capture.js'
import { readTrail } from './trail.js'

const manifest = {
  version: 3,
  groups: [{ groupId: 'app', targets: [
    { targetId: 'go', name: 'Go', actionKinds: ['click'], selector: { css: '#go' } },
    { targetId: 'pwd', name: 'Password', sensitive: true, actionKinds: ['fill'], selector: { css: '#pwd' } },
  ] }],
}

function pageHtml(): string {
  return `<!doctype html><html><head><title>Capture</title></head><body>
<button id="go">Go</button>
<div id="plain">plain</div>
<input id="pwd" type="password" />
<script>window.__agrune_manifest__ = ${JSON.stringify(manifest)};</script>
</body></html>`
}

async function serve(): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end(pageHtml())
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return { url: `http://127.0.0.1:${port}/`, close: () => new Promise<void>((resolve) => server.close(() => resolve())) }
}

async function waitFor(pred: () => boolean, ms = 5000): Promise<void> {
  const t0 = Date.now()
  while (!pred()) {
    if (Date.now() - t0 > ms) throw new Error('waitFor timed out')
    await new Promise((r) => setTimeout(r, 50))
  }
}

let available = true

describe('capture controller (real chromium)', () => {
  before(async () => {
    const probe = new BrowserSession(true)
    try {
      await probe.start()
      await probe.stop()
    } catch {
      available = false
    }
  })

  it('captures clicks, maps declared targets, flags undeclared, and persists the trail', async (t) => {
    if (!available) return t.skip('chromium unavailable')
    const app = await serve()
    const dir = await mkdtemp(path.join(tmpdir(), 'rec-'))
    const ctrl = await startRecording({ url: app.url, artifactsDir: dir, headless: true })
    try {
      // a real click on the declared button → mapped to ref 'go'
      await ctrl.browser.page().locator('#go').click()
      await waitFor(() => ctrl.recording.entries.some((e) => e.action?.do === 'click' && e.ref === 'go'))
      const mapped = ctrl.recording.entries.find((e) => e.ref === 'go')!
      assert.ok(mapped.screenshot, 'a screenshot should be captured')
      await stat(mapped.screenshot!) // file exists

      // a click on an undeclared element → recorded but ref null (unmapped)
      await ctrl.browser.page().locator('#plain').click()
      await waitFor(() => ctrl.recording.entries.some((e) => e.action?.rawTarget?.css === '#plain'))
      const unmapped = ctrl.recording.entries.find((e) => e.action?.rawTarget?.css === '#plain')!
      assert.equal(unmapped.ref, null)

      // manual bug bookmark
      await ctrl.bug('looks wrong')
      assert.ok(ctrl.recording.bookmarks.length >= 1)

      const final = await ctrl.stop()
      const back = await readTrail(dir)
      assert.equal(back.version, 1)
      assert.equal(back.entries.length, final.entries.length)
    } finally {
      await ctrl.stop().catch(() => undefined)
      await rm(dir, { recursive: true, force: true })
      await app.close()
    }
  })

  it('routes a sensitive field value into the vault, not the trail', async (t) => {
    if (!available) return t.skip('chromium unavailable')
    const app = await serve()
    const dir = await mkdtemp(path.join(tmpdir(), 'rec-'))
    const secdir = await mkdtemp(path.join(tmpdir(), 'sec-'))
    const ctrl = await startRecording({ url: app.url, artifactsDir: dir, secretsDir: secdir, headless: true })
    try {
      await ctrl.browser.page().locator('#pwd').fill('hunter2')
      await ctrl.browser.page().locator('#pwd').press('Tab') // fire change
      await waitFor(() => ctrl.recording.entries.some((e) => e.action?.do === 'fill' && e.ref === 'pwd'))
      const entry = ctrl.recording.entries.find((e) => e.ref === 'pwd')!
      assert.equal(entry.action!.value, undefined, 'plaintext must not be in the trail')
      assert.equal(entry.action!.secretRef, 'rec1__pwd'.replace('rec1', ctrl.recording.id))
      assert.equal(entry.screenshot, undefined, 'sensitive fill must not capture a screenshot')
      const { resolveSecret } = await import('./secrets.js')
      assert.equal(await resolveSecret(secdir, entry.action!.secretRef!), 'hunter2')
    } finally {
      await ctrl.stop().catch(() => undefined)
      await rm(dir, { recursive: true, force: true })
      await rm(secdir, { recursive: true, force: true })
      await app.close()
    }
  })
})
