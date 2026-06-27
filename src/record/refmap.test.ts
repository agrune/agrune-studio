import assert from 'node:assert/strict'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { before, describe, it } from 'node:test'
import { BrowserSession } from 'agrune'
import { HIT_ATTR, mapHitToRef } from './refmap.js'

const manifest = {
  version: 3,
  groups: [
    {
      groupId: 'app',
      targets: [{ targetId: 'go', name: 'Go', actionKinds: ['click'], selector: { css: '#go' } }],
    },
  ],
}

function pageHtml(): string {
  return `<!doctype html><html><head><title>Refmap</title></head><body>
<button id="go"><span id="inner">Go</span></button>
<div id="plain">plain</div>
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

let available = true

describe('refmap (real chromium)', () => {
  before(async () => {
    const probe = new BrowserSession(true)
    try {
      await probe.start()
      await probe.stop()
    } catch {
      available = false
    }
  })

  it('maps a nonce on the declared element to its ref (rank 0)', async (t) => {
    if (!available) return t.skip('chromium unavailable')
    const app = await serve()
    const browser = new BrowserSession(true)
    try {
      await browser.start()
      await browser.open(app.url)
      // tag the declared button with a nonce, exactly as the capture script would
      await browser.page().locator('#go').evaluate((el, a) => el.setAttribute(a, 'N1'), HIT_ATTR)
      const m = await mapHitToRef(browser, 'N1')
      assert.ok(m, 'expected a match')
      assert.equal(m!.ref, 'go')
      assert.equal(m!.rank, 0)
    } finally {
      await browser.stop().catch(() => undefined)
      await app.close()
    }
  })

  it('maps a nonce on a child up to the ancestor target (rank 1)', async (t) => {
    if (!available) return t.skip('chromium unavailable')
    const app = await serve()
    const browser = new BrowserSession(true)
    try {
      await browser.start()
      await browser.open(app.url)
      await browser.page().locator('#inner').evaluate((el, a) => el.setAttribute(a, 'N2'), HIT_ATTR)
      const m = await mapHitToRef(browser, 'N2')
      assert.ok(m, 'expected a match')
      assert.equal(m!.ref, 'go')
      assert.equal(m!.rank, 1)
    } finally {
      await browser.stop().catch(() => undefined)
      await app.close()
    }
  })

  it('returns null for an undeclared element', async (t) => {
    if (!available) return t.skip('chromium unavailable')
    const app = await serve()
    const browser = new BrowserSession(true)
    try {
      await browser.start()
      await browser.open(app.url)
      await browser.page().locator('#plain').evaluate((el, a) => el.setAttribute(a, 'N3'), HIT_ATTR)
      const m = await mapHitToRef(browser, 'N3')
      assert.equal(m, null)
    } finally {
      await browser.stop().catch(() => undefined)
      await app.close()
    }
  })
})
