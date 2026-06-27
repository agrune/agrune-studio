// Key / keyset / envelope IO for Studio's publishing commands (Phase 3).
//
// Studio OWNS keygen + the admin model (SPEC §6); the cryptographic primitives are the core's
// (`generateKeyPair`, `signKeyset`, `verifyKeyset`, `signManifest`, `verifyEnvelope`). Studio never
// re-implements verification.
//
// KEY STORAGE (documented, SPEC §5): private keys are secrets — never commit them, never put them in
// the store. The ROOT key is used only to (re)sign the keyset (grant/revoke) so it should live
// offline / in an HSM / in a secret manager. Admin keys belong in a secret manager. Studio writes
// private key files mode 0600 and prints a warning.

import { readFile, writeFile } from 'node:fs/promises'
import { createPublicKey, type KeyObject } from 'node:crypto'
import { parsePinnedKey, parseSigningKey, type KeysetEnvelope, type ManifestEnvelope } from 'agrune'

export async function readText(file: string): Promise<string> {
  try {
    return await readFile(file, 'utf8')
  } catch (err) {
    throw new Error(`failed to read ${file}: ${(err as Error).message}`)
  }
}

export async function readJsonFile<T>(file: string): Promise<T> {
  const raw = await readText(file)
  try {
    return JSON.parse(raw) as T
  } catch (err) {
    throw new Error(`invalid JSON in ${file}: ${(err as Error).message}`)
  }
}

/** Write a private key file with owner-only permissions. */
export async function writePrivateKey(file: string, pem: string): Promise<void> {
  await writeFile(file, pem.endsWith('\n') ? pem : `${pem}\n`, { encoding: 'utf8', mode: 0o600 })
}

export async function writeJsonFile(file: string, value: unknown): Promise<void> {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

/** Load a signing (private) key from a spec (PEM string or path). Throws on a non-ed25519 key. */
export function loadPrivateKey(spec: string, what = 'signing key'): KeyObject {
  const key = parseSigningKey(spec)
  if (!key) throw new Error(`invalid ${what} (expected an ed25519 PEM or a path to one): ${truncate(spec)}`)
  return key
}

/** Load a public key from a spec (PEM, path, or base64 raw 32-byte ed25519). Accepts a private key
 *  spec too and derives the public half. */
export function loadPublicKey(spec: string, what = 'public key'): KeyObject {
  const pub = parsePinnedKey(spec)
  if (pub) return pub
  const priv = parseSigningKey(spec)
  if (priv) return createPublicKey(priv)
  throw new Error(`invalid ${what} (expected an ed25519 public key, path, or base64): ${truncate(spec)}`)
}

export async function readKeysetEnvelope(file: string): Promise<KeysetEnvelope> {
  return readJsonFile<KeysetEnvelope>(file)
}

export async function readManifestEnvelope(file: string): Promise<ManifestEnvelope> {
  return readJsonFile<ManifestEnvelope>(file)
}

function truncate(s: string): string {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > 48 ? `${t.slice(0, 48)}…` : t
}
