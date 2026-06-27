// `agrune-studio <keygen|admin|sign|publish|verify>` — keys, the root-signed admin model, signing,
// publishing to a dir store, and the runtime trust gate (Phase 3).

import path from 'node:path'
import { createPublicKey } from 'node:crypto'
import {
  generateKeyPair,
  signManifest,
  verifyEnvelope,
  publishToDir,
  emptyKeyset,
  signKeyset,
  grantAdmin,
  revokeAdmin,
  verifyKeyset,
  verifyManifestWithKeyset,
  keyIdFor,
  publicKeyBase64,
  type ManifestProvenance,
} from 'agrune'
import { readManifestFile } from '../io.js'
import {
  loadPrivateKey,
  loadPublicKey,
  readKeysetEnvelope,
  readManifestEnvelope,
  writeJsonFile,
  writePrivateKey,
} from './keystore.js'

interface ParsedArgs {
  positionals: string[]
  flags: Map<string, string | true>
}

const PUBLISH_USAGE = `Usage:
  agrune-studio keygen --out <privkey.pem> [--label <name>]
  agrune-studio admin init --root <rootkey.pem> --out <keyset.json>
  agrune-studio admin grant --root <rootkey.pem> --keyset <keyset.json> --admin-pub <pub|file> [--label <name>]
  agrune-studio admin revoke --root <rootkey.pem> --keyset <keyset.json> --key-id <id>
  agrune-studio admin list --keyset <keyset.json> --root <rootpub|rootkey>
  agrune-studio sign <manifest.json> --key <signer.pem> --out <envelope.json> [--origin <o>] [--app-version <v>] [--author human|agent]
  agrune-studio publish <envelope.json> --store <dir> --origin <o> [--schema-version 3] [--app-version <v>]
  agrune-studio verify <envelope.json> --root <rootpub|rootkey> [--keyset <keyset.json>]`

export async function runPublishCommand(command: string, argv: string[]): Promise<number> {
  if (command === 'admin') return runAdmin(argv)
  const args = parseArgs(argv)
  if (command === 'keygen') return runKeygen(args)
  if (command === 'sign') return runSign(args)
  if (command === 'publish') return runPublish(args)
  if (command === 'verify') return runVerify(args)
  throw new Error(`unknown command: ${command}\n\n${PUBLISH_USAGE}`)
}

async function runKeygen(args: ParsedArgs): Promise<number> {
  const out = getRequiredFlag(args, 'out')
  const kp = generateKeyPair()
  await writePrivateKey(path.resolve(process.cwd(), out), kp.privateKeyPem)
  const label = typeof args.flags.get('label') === 'string' ? ` (${args.flags.get('label') as string})` : ''
  console.log(`Wrote private key${label}: ${out}  [mode 0600 — secret, never commit, never put in the store]`)
  console.log(`keyId:           ${kp.keyId}`)
  console.log(`public (base64): ${kp.publicKeyBase64}`)
  console.log('public (PEM):')
  console.log(kp.publicKeyPem.trim())
  return 0
}

async function runAdmin(argv: string[]): Promise<number> {
  const [sub, ...rest] = argv
  const args = parseArgs(rest)
  if (sub === 'init') return adminInit(args)
  if (sub === 'grant') return adminGrant(args)
  if (sub === 'revoke') return adminRevoke(args)
  if (sub === 'list') return adminList(args)
  throw new Error(`unknown admin subcommand: ${sub ?? '(none)'}\n\n${PUBLISH_USAGE}`)
}

async function adminInit(args: ParsedArgs): Promise<number> {
  const rootPriv = loadPrivateKey(getRequiredFlag(args, 'root'), 'root key')
  const out = getRequiredFlag(args, 'out')
  const rootPub = createPublicKey(rootPriv)
  const envelope = signKeyset(emptyKeyset(rootPub, nowIso()), rootPriv)
  await writeJsonFile(path.resolve(process.cwd(), out), envelope)
  console.log(`Created keyset ${out} (rootKeyId ${keyIdFor(rootPub)}, 0 admins)`)
  return 0
}

async function adminGrant(args: ParsedArgs): Promise<number> {
  const rootPriv = loadPrivateKey(getRequiredFlag(args, 'root'), 'root key')
  const rootPub = createPublicKey(rootPriv)
  const keysetPath = path.resolve(process.cwd(), getRequiredFlag(args, 'keyset'))
  const verified = verifyKeyset(await readKeysetEnvelope(keysetPath), rootPub)
  if (!verified.ok) throw new Error(`keyset does not verify under this root: ${verified.reason}`)

  const adminPub = loadPublicKey(getRequiredFlag(args, 'admin-pub'), 'admin public key')
  const label = typeof args.flags.get('label') === 'string' ? (args.flags.get('label') as string) : undefined
  const keyId = keyIdFor(adminPub)
  const next = grantAdmin(
    verified.keyset,
    { keyId, publicKey: publicKeyBase64(adminPub), ...(label ? { label } : {}), addedAt: nowIso() },
    nowIso(),
  )
  await writeJsonFile(keysetPath, signKeyset(next, rootPriv))
  console.log(`Granted admin ${keyId}${label ? ` (${label})` : ''} — keyset re-signed`)
  return 0
}

async function adminRevoke(args: ParsedArgs): Promise<number> {
  const rootPriv = loadPrivateKey(getRequiredFlag(args, 'root'), 'root key')
  const rootPub = createPublicKey(rootPriv)
  const keysetPath = path.resolve(process.cwd(), getRequiredFlag(args, 'keyset'))
  const verified = verifyKeyset(await readKeysetEnvelope(keysetPath), rootPub)
  if (!verified.ok) throw new Error(`keyset does not verify under this root: ${verified.reason}`)
  const keyId = getRequiredFlag(args, 'key-id')
  await writeJsonFile(keysetPath, signKeyset(revokeAdmin(verified.keyset, keyId, nowIso()), rootPriv))
  console.log(`Revoked admin ${keyId} — keyset re-signed`)
  return 0
}

async function adminList(args: ParsedArgs): Promise<number> {
  const rootPub = loadPublicKey(getRequiredFlag(args, 'root'), 'root key')
  const verified = verifyKeyset(await readKeysetEnvelope(path.resolve(process.cwd(), getRequiredFlag(args, 'keyset'))), rootPub)
  if (!verified.ok) {
    console.error(`keyset does not verify under this root: ${verified.reason}`)
    return 1
  }
  const ks = verified.keyset
  console.log(`keyset rootKeyId ${ks.rootKeyId} — ${ks.admins.length} admin(s)`)
  for (const a of ks.admins) {
    const revoked = ks.revoked.includes(a.keyId)
    console.log(`  ${revoked ? '✗ REVOKED' : '✓ active  '}  ${a.keyId}  ${a.label ?? ''}`)
  }
  return 0
}

async function runSign(args: ParsedArgs): Promise<number> {
  const file = getRequiredPositional(args, 0, 'manifest')
  const manifest = await readManifestFile(file)
  const signer = loadPrivateKey(getRequiredFlag(args, 'key'), 'signing key')
  const out = getRequiredFlag(args, 'out')

  const author = args.flags.get('author')
  const meta: ManifestProvenance = {
    schemaVersion: manifest.version,
    publishedAt: nowIso(),
    author: author === 'agent' ? 'agent' : 'human',
  }
  const origin = args.flags.get('origin')
  if (typeof origin === 'string') meta.origin = origin
  const appVersion = args.flags.get('app-version')
  if (typeof appVersion === 'string') meta.appVersion = appVersion

  const keyId = keyIdFor(createPublicKey(signer))
  const envelope = signManifest(manifest, meta, signer, keyId)
  await writeJsonFile(path.resolve(process.cwd(), out), envelope)
  console.log(`Signed ${file} -> ${out}  (signer ${keyId})`)
  return 0
}

async function runPublish(args: ParsedArgs): Promise<number> {
  const file = getRequiredPositional(args, 0, 'envelope')
  const envelope = await readManifestEnvelope(file)
  const store = getRequiredFlag(args, 'store')
  const origin = getRequiredFlag(args, 'origin')
  const schemaVersion = Number(typeof args.flags.get('schema-version') === 'string' ? args.flags.get('schema-version') : 3)
  const appVersion = typeof args.flags.get('app-version') === 'string' ? (args.flags.get('app-version') as string) : undefined
  const written = publishToDir(path.resolve(process.cwd(), store), { origin, schemaVersion, ...(appVersion ? { appVersion } : {}) }, envelope)
  console.log(`Published -> ${written}`)
  return 0
}

async function runVerify(args: ParsedArgs): Promise<number> {
  const file = getRequiredPositional(args, 0, 'envelope')
  const envelope = await readManifestEnvelope(file)
  const rootPub = loadPublicKey(getRequiredFlag(args, 'root'), 'root key')
  const keysetSpec = args.flags.get('keyset')

  const result =
    typeof keysetSpec === 'string'
      ? verifyManifestWithKeyset(envelope, rootPub, await readKeysetEnvelope(path.resolve(process.cwd(), keysetSpec)))
      : verifyEnvelope(envelope, rootPub)

  if (result.ok) {
    console.log(`VERIFIED — runtime would ACCEPT this manifest.`)
    console.log(`  signer keyId: ${result.value.keyId ?? '(none)'}`)
    console.log(`  origin:       ${result.value.provenance.origin ?? '(none)'}`)
    console.log(`  contentHash:  ${result.value.contentHash.slice(0, 16)}…`)
    return 0
  }
  console.error(`REJECTED — runtime would NOT accept: ${result.reason}${result.detail ? ` (${result.detail})` : ''}`)
  return 1
}

// ---- helpers ---------------------------------------------------------------

function nowIso(): string {
  return new Date().toISOString()
}

function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = []
  const flags = new Map<string, string | true>()
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!
    if (!arg.startsWith('--')) {
      positionals.push(arg)
      continue
    }
    const name = arg.slice(2)
    const next = argv[index + 1]
    if (!next || next.startsWith('--')) {
      flags.set(name, true)
      continue
    }
    flags.set(name, next)
    index += 1
  }
  return { positionals, flags }
}

function getRequiredPositional(args: ParsedArgs, index: number, name: string): string {
  const value = args.positionals[index]
  if (!value) throw new Error(`missing <${name}>\n\n${PUBLISH_USAGE}`)
  return value
}

function getRequiredFlag(args: ParsedArgs, name: string): string {
  const value = args.flags.get(name)
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`missing --${name}\n\n${PUBLISH_USAGE}`)
  return value
}
