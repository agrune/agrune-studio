// Publishing + key/admin model (Phase 3, Q3 = root-signed admin keyset). Pure crypto/IO — no
// browser. Proves: an admin-signed manifest is accepted under the pinned root; grant/revoke work;
// a wrong signer / forged keyset / tampered payload are rejected.

import assert from 'node:assert/strict'
import { createPublicKey } from 'node:crypto'
import { describe, it } from 'node:test'
import {
  emptyKeyset,
  generateKeyPair,
  grantAdmin,
  keyIdFor,
  parsePinnedKey,
  parseSigningKey,
  publicKeyBase64,
  revokeAdmin,
  signKeyset,
  signManifest,
  verifyManifestWithKeyset,
  type AgruneManifest,
} from 'agrune'

const manifest: AgruneManifest = {
  version: 3,
  groups: [{ groupId: 'g', targets: [{ targetId: 't', actionKinds: ['click'], selector: { css: '#x' } }] }],
}

function makeActor() {
  const kp = generateKeyPair()
  return { kp, priv: parseSigningKey(kp.privateKeyPem)!, pub: parsePinnedKey(kp.publicKeyBase64)! }
}

describe('publishing trust model (root-signed admin keyset)', () => {
  it('an admin granted by root produces a manifest the runtime accepts', () => {
    const root = makeActor()
    const admin = makeActor()
    const env = signManifest(manifest, { author: 'human' }, admin.priv, admin.kp.keyId)
    const keyset = signKeyset(
      grantAdmin(emptyKeyset(root.pub), { keyId: admin.kp.keyId, publicKey: admin.kp.publicKeyBase64, label: 'alice' }),
      root.priv,
    )
    const r = verifyManifestWithKeyset(env, root.pub, keyset)
    assert.equal(r.ok, true)
    if (r.ok) assert.equal(r.value.keyId, admin.kp.keyId)
  })

  it('the root (owner) may sign directly', () => {
    const root = makeActor()
    const env = signManifest(manifest, undefined, root.priv, root.kp.keyId)
    const keyset = signKeyset(emptyKeyset(root.pub), root.priv)
    assert.equal(verifyManifestWithKeyset(env, root.pub, keyset).ok, true)
  })

  it('REVOKING an admin rejects its signatures without re-pinning the root', () => {
    const root = makeActor()
    const admin = makeActor()
    const env = signManifest(manifest, undefined, admin.priv, admin.kp.keyId)
    let ks = grantAdmin(emptyKeyset(root.pub), { keyId: admin.kp.keyId, publicKey: admin.kp.publicKeyBase64 })
    assert.equal(verifyManifestWithKeyset(env, root.pub, signKeyset(ks, root.priv)).ok, true)
    ks = revokeAdmin(ks, admin.kp.keyId)
    const r = verifyManifestWithKeyset(env, root.pub, signKeyset(ks, root.priv))
    assert.equal(r.ok, false)
    if (!r.ok) assert.equal(r.reason, 'untrusted-signer')
  })

  it('a non-admin signer is rejected', () => {
    const root = makeActor()
    const stranger = makeActor()
    const env = signManifest(manifest, undefined, stranger.priv, stranger.kp.keyId)
    const keyset = signKeyset(emptyKeyset(root.pub), root.priv) // stranger never granted
    const r = verifyManifestWithKeyset(env, root.pub, keyset)
    assert.equal(r.ok, false)
    if (!r.ok) assert.equal(r.reason, 'untrusted-signer')
  })

  it('a keyset NOT signed by the pinned root is rejected (forged grant)', () => {
    const root = makeActor()
    const attacker = makeActor()
    const env = signManifest(manifest, undefined, attacker.priv, attacker.kp.keyId)
    // attacker self-grants and signs the keyset with their OWN key (not root)
    const forged = signKeyset(
      grantAdmin(emptyKeyset(attacker.pub), { keyId: attacker.kp.keyId, publicKey: attacker.kp.publicKeyBase64 }),
      attacker.priv,
    )
    const r = verifyManifestWithKeyset(env, root.pub, forged)
    assert.equal(r.ok, false)
    if (!r.ok) assert.equal(r.reason, 'untrusted-keyset')
  })

  it('a tampered manifest payload is rejected even from a trusted admin', () => {
    const root = makeActor()
    const admin = makeActor()
    const env = signManifest(manifest, undefined, admin.priv, admin.kp.keyId)
    const tampered = { ...env, payloadJson: env.payloadJson.replace('#x', '#evil') }
    const keyset = signKeyset(
      grantAdmin(emptyKeyset(root.pub), { keyId: admin.kp.keyId, publicKey: admin.kp.publicKeyBase64 }),
      root.priv,
    )
    assert.equal(verifyManifestWithKeyset(tampered, root.pub, keyset).ok, false)
  })

  it('keyIdFor + publicKeyBase64 are stable and consistent for a keypair', () => {
    const a = makeActor()
    assert.equal(keyIdFor(a.pub), a.kp.keyId)
    assert.equal(keyIdFor(createPublicKey(a.priv)), a.kp.keyId)
    assert.equal(publicKeyBase64(a.pub), a.kp.publicKeyBase64)
  })
})
