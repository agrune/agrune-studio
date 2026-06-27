// Site-pack catalog (Phase 6) — publish a signed pack (manifest + scenarios), discover it with
// verified provenance, consume/pin it, and run its scenarios immediately; revocation blocks install;
// version history accumulates. Most of this is pure (crypto + fs); only `runInstalled` needs chromium.

import assert from 'node:assert/strict'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { mkdtemp, readFile } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import { before, describe, it } from 'node:test'
import {
  BrowserSession,
  emptyKeyset,
  generateKeyPair,
  grantAdmin,
  parsePinnedKey,
  parseSigningKey,
  publishPackToDir,
  revokeAdmin,
  scanStore,
  signKeyset,
  writeStoreIndex,
  type AgruneManifest,
} from 'agrune'
import { createPack, signPack } from './pack.js'
import { installPack, listCatalog, runInstalled, versionsFor } from './catalog.js'
import { SCENARIO_SCHEMA_ID, type Scenario } from '../scenario/schema.js'

const manifest: AgruneManifest = {
  version: 3,
  groups: [
    {
      groupId: 'login',
      targets: [
        { targetId: 'user', actionKinds: ['fill'], selector: { css: '#user' } },
        { targetId: 'signin', name: 'Sign in', actionKinds: ['click'], selector: { css: '#signin' } },
      ],
    },
  ],
}

const scenario: Scenario = {
  schema: SCENARIO_SCHEMA_ID,
  name: 'login flow',
  manifest: { schemaVersion: 3 },
  steps: [
    { do: 'fill', ref: 'user', value: 'alice' },
    { do: 'click', ref: 'signin' },
    { assert: 'textPresent', value: 'Signed in as alice' },
  ],
}

const html = `<!doctype html><html><head><title>Pack App</title></head><body>
<input id="user" /><button id="signin">Sign in</button><div id="out"></div>
<script>
window.__agrune_manifest__ = ${JSON.stringify(manifest)};
document.getElementById('signin').addEventListener('click', function(e){
  e.preventDefault();
  document.getElementById('out').textContent = 'Signed in as ' + document.getElementById('user').value;
});
</script></body></html>`

async function serve() {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end(html)
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const { port } = server.address() as AddressInfo
  return { url: `http://127.0.0.1:${port}/`, close: () => new Promise<void>((r) => server.close(() => r())) }
}

function actor() {
  const kp = generateKeyPair()
  return { kp, priv: parseSigningKey(kp.privateKeyPem)!, pub: parsePinnedKey(kp.publicKeyBase64)! }
}

const ORIGIN = 'example.test'

describe('site-pack catalog', () => {
  it('publishes a signed pack and discovers it with VERIFIED provenance', async () => {
    const store = await mkdtemp(path.join(os.tmpdir(), 'agrune-store-'))
    const root = actor()
    const admin = actor()
    const keyset = signKeyset(
      grantAdmin(emptyKeyset(root.pub), { keyId: admin.kp.keyId, publicKey: admin.kp.publicKeyBase64, label: 'alice' }),
      root.priv,
    )
    const env = signPack(
      createPack({ name: 'Example app', version: '1.0.0', origin: ORIGIN, manifest, scenarios: [scenario] }),
      { origin: ORIGIN, publishedAt: '2026-06-27T00:00:00.000Z', author: 'human' },
      admin.priv,
      admin.kp.keyId,
    )
    publishPackToDir(store, { origin: ORIGIN, version: '1.0.0' }, env)
    writeStoreIndex(store)

    const items = await listCatalog(store, root.pub, keyset)
    assert.equal(items.length, 1)
    assert.equal(items[0]!.verified, true)
    assert.equal(items[0]!.origin, ORIGIN)
    assert.equal(items[0]!.signerKeyId, admin.kp.keyId)
    assert.equal(items[0]!.scenarioCount, 1)
    assert.equal(items[0]!.publishedAt, '2026-06-27T00:00:00.000Z')
  })

  it('consume/install pins the manifest + scenarios; a REVOKED signer blocks install', async () => {
    const store = await mkdtemp(path.join(os.tmpdir(), 'agrune-store-'))
    const dest = await mkdtemp(path.join(os.tmpdir(), 'agrune-install-'))
    const root = actor()
    const admin = actor()
    let ks = grantAdmin(emptyKeyset(root.pub), { keyId: admin.kp.keyId, publicKey: admin.kp.publicKeyBase64 })
    const env = signPack(
      createPack({ name: 'Example', version: '1.0.0', origin: ORIGIN, manifest, scenarios: [scenario] }),
      { origin: ORIGIN }, admin.priv, admin.kp.keyId,
    )
    publishPackToDir(store, { origin: ORIGIN, version: '1.0.0' }, env)

    const installed = await installPack(store, ORIGIN, '1.0.0', dest, root.pub, signKeyset(ks, root.priv))
    assert.equal(installed.scenarioPaths.length, 1)
    const pinned = JSON.parse(await readFile(path.join(installed.dir, 'pinned.json'), 'utf8'))
    assert.equal(pinned.version, '1.0.0')
    assert.equal(pinned.signerKeyId, admin.kp.keyId)

    // revoke the admin → the same store pack must no longer install under the new keyset
    ks = revokeAdmin(ks, admin.kp.keyId)
    await assert.rejects(() => installPack(store, ORIGIN, '1.0.0', dest, root.pub, signKeyset(ks, root.priv)), /did not verify/)
  })

  it('keeps version history (publish a new version → both show in the index)', async () => {
    const store = await mkdtemp(path.join(os.tmpdir(), 'agrune-store-'))
    const root = actor()
    const admin = actor()
    const keyset = signKeyset(
      grantAdmin(emptyKeyset(root.pub), { keyId: admin.kp.keyId, publicKey: admin.kp.publicKeyBase64 }),
      root.priv,
    )
    for (const version of ['1.0.0', '1.1.0']) {
      const env = signPack(
        createPack({ name: 'Example', version, origin: ORIGIN, manifest, scenarios: [scenario] }),
        { origin: ORIGIN }, admin.priv, admin.kp.keyId,
      )
      publishPackToDir(store, { origin: ORIGIN, version }, env)
    }
    writeStoreIndex(store)
    const items = await listCatalog(store, root.pub, keyset)
    assert.deepEqual(versionsFor(items, ORIGIN), ['1.0.0', '1.1.0'])
    assert.ok(items.every((i) => i.verified))
  })

  it('a pack signed by a non-admin is shown UNVERIFIED in the catalog', async () => {
    const store = await mkdtemp(path.join(os.tmpdir(), 'agrune-store-'))
    const root = actor()
    const stranger = actor()
    const keyset = signKeyset(emptyKeyset(root.pub), root.priv) // stranger never granted
    const env = signPack(
      createPack({ name: 'Evil', version: '1.0.0', origin: ORIGIN, manifest, scenarios: [scenario] }),
      { origin: ORIGIN }, stranger.priv, stranger.kp.keyId,
    )
    publishPackToDir(store, { origin: ORIGIN, version: '1.0.0' }, env)
    const items = await listCatalog(store, root.pub, keyset)
    assert.equal(items[0]!.verified, false)
  })

  describe('run the consumed pack against a live app (real chromium)', () => {
    let available = true
    before(async () => {
      const probe = new BrowserSession(true)
      try {
        await probe.start()
        await probe.stop()
      } catch {
        available = false
      }
    })

    it('runs the pinned scenarios immediately — GREEN', async (t) => {
      if (!available) return t.skip('chromium unavailable')
      const store = await mkdtemp(path.join(os.tmpdir(), 'agrune-store-'))
      const dest = await mkdtemp(path.join(os.tmpdir(), 'agrune-install-'))
      const root = actor()
      const admin = actor()
      const keyset = signKeyset(
        grantAdmin(emptyKeyset(root.pub), { keyId: admin.kp.keyId, publicKey: admin.kp.publicKeyBase64 }),
        root.priv,
      )
      const env = signPack(
        createPack({ name: 'Example', version: '1.0.0', origin: ORIGIN, manifest, scenarios: [scenario] }),
        { origin: ORIGIN }, admin.priv, admin.kp.keyId,
      )
      publishPackToDir(store, { origin: ORIGIN, version: '1.0.0' }, env)
      const installed = await installPack(store, ORIGIN, '1.0.0', dest, root.pub, keyset)

      const app = await serve()
      try {
        const result = await runInstalled(installed.dir, app.url)
        assert.equal(result.failed, 0, JSON.stringify(result.reports, null, 2))
        assert.equal(result.passed, 1)
      } finally {
        await app.close()
      }
    })
  })
})
