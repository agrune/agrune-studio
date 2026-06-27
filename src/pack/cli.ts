// `agrune-studio pack <create|publish>` (closed publish) and `catalog <list|install|run>` (open
// consume) — the site-pack catalog over the signed store (Phase 6).

import path from 'node:path'
import { readdir, readFile } from 'node:fs/promises'
import { createPublicKey } from 'node:crypto'
import {
  keyIdFor,
  publishPackToDir,
  scanStore,
  writeStoreIndex,
  type ManifestProvenance,
  type SignedEnvelope,
} from 'agrune'
import { readManifestFile } from '../io.js'
import { validateScenario, type Scenario } from '../scenario/schema.js'
import { formatReport } from '../scenario/report.js'
import { createPack, signPack } from './pack.js'
import { installPack, listCatalog, runInstalled, versionsFor } from './catalog.js'
import {
  loadPrivateKey,
  loadPublicKey,
  readJsonFile,
  readKeysetEnvelope,
  writeJsonFile,
} from '../publish/keystore.js'

interface ParsedArgs {
  positionals: string[]
  flags: Map<string, string | true>
}

const PACK_USAGE = `Usage:
  agrune-studio pack create --manifest <m.json> --scenarios <dir> --name <n> --version <v> --key <signer.pem> --out <pack.json> [--origin <o>]
  agrune-studio pack publish <pack.json> --store <dir> [--origin <o>] [--version <v>]
  agrune-studio catalog list --store <dir> --root <rootpub> --keyset <keyset.json>
  agrune-studio catalog install <origin> --store <dir> --root <rootpub> --keyset <keyset.json> --dest <dir> [--version <v>]
  agrune-studio catalog run <origin> --dest <dir> --url <app> [--headed]`

export async function runPackCommand(command: string, argv: string[]): Promise<number> {
  const [sub, ...rest] = argv
  const args = parseArgs(rest)
  if (command === 'pack') {
    if (sub === 'create') return packCreate(args)
    if (sub === 'publish') return packPublish(args)
  }
  if (command === 'catalog') {
    if (sub === 'list') return catalogList(args)
    if (sub === 'install') return catalogInstall(args)
    if (sub === 'run') return catalogRun(args)
  }
  throw new Error(`unknown ${command} subcommand: ${sub ?? '(none)'}\n\n${PACK_USAGE}`)
}

async function packCreate(args: ParsedArgs): Promise<number> {
  const manifest = await readManifestFile(getRequiredFlag(args, 'manifest'))
  const scenarios = await loadScenarios(path.resolve(process.cwd(), getRequiredFlag(args, 'scenarios')))
  if (scenarios.length === 0) throw new Error('no valid scenarios found in --scenarios dir')
  const name = getRequiredFlag(args, 'name')
  const version = getRequiredFlag(args, 'version')
  const origin = typeof args.flags.get('origin') === 'string' ? (args.flags.get('origin') as string) : undefined
  const signer = loadPrivateKey(getRequiredFlag(args, 'key'), 'signing key')

  const pack = createPack({ name, version, ...(origin ? { origin } : {}), manifest, scenarios })
  const meta: ManifestProvenance = { schemaVersion: manifest.version, publishedAt: new Date().toISOString(), author: 'human' }
  if (origin) meta.origin = origin
  const envelope = signPack(pack, meta, signer, keyIdFor(createPublicKey(signer)))
  await writeJsonFile(path.resolve(process.cwd(), getRequiredFlag(args, 'out')), envelope)
  console.log(`Created + signed pack "${name}" v${version} (${scenarios.length} scenario(s)) -> ${getRequiredFlag(args, 'out')}`)
  return 0
}

async function packPublish(args: ParsedArgs): Promise<number> {
  const file = getRequiredPositional(args, 0, 'pack.json')
  const envelope = await readJsonFile<SignedEnvelope>(file)
  const payload = parsePackPayload(envelope)
  const origin = typeof args.flags.get('origin') === 'string' ? (args.flags.get('origin') as string) : payload.origin
  const version = typeof args.flags.get('version') === 'string' ? (args.flags.get('version') as string) : payload.version
  if (!origin) throw new Error('pack has no origin — pass --origin')
  if (!version) throw new Error('pack has no version — pass --version')
  const store = path.resolve(process.cwd(), getRequiredFlag(args, 'store'))
  const written = publishPackToDir(store, { origin, version }, envelope)
  const index = writeStoreIndex(store, new Date().toISOString())
  console.log(`Published pack -> ${written}`)
  console.log(`Updated store index -> ${index}  (${scanStore(store).length} pack(s))`)
  return 0
}

async function catalogList(args: ParsedArgs): Promise<number> {
  const store = path.resolve(process.cwd(), getRequiredFlag(args, 'store'))
  const rootPub = loadPublicKey(getRequiredFlag(args, 'root'), 'root key')
  const keyset = await readKeysetEnvelope(path.resolve(process.cwd(), getRequiredFlag(args, 'keyset')))
  const items = await listCatalog(store, rootPub, keyset)
  if (items.length === 0) {
    console.log('catalog is empty.')
    return 0
  }
  console.log('APP / ORIGIN          VERSION   STATUS     SIGNER            PUBLISHED                 SCENARIOS')
  for (const i of items) {
    const status = i.verified ? '✓ verified' : `✗ ${i.reason ?? 'unverified'}`
    console.log(
      `${pad(i.origin, 21)} ${pad(i.version, 9)} ${pad(status, 10)} ${pad(i.signerKeyId ?? '-', 17)} ${pad(i.publishedAt ?? '-', 25)} ${i.scenarioCount ?? '-'}`,
    )
  }
  return 0
}

async function catalogInstall(args: ParsedArgs): Promise<number> {
  const origin = getRequiredPositional(args, 0, 'origin')
  const store = path.resolve(process.cwd(), getRequiredFlag(args, 'store'))
  const rootPub = loadPublicKey(getRequiredFlag(args, 'root'), 'root key')
  const keyset = await readKeysetEnvelope(path.resolve(process.cwd(), getRequiredFlag(args, 'keyset')))
  const dest = path.resolve(process.cwd(), getRequiredFlag(args, 'dest'))

  let version = typeof args.flags.get('version') === 'string' ? (args.flags.get('version') as string) : undefined
  if (!version) {
    const items = await listCatalog(store, rootPub, keyset)
    const versions = versionsFor(items, origin)
    version = versions[versions.length - 1] // latest by sort order
    if (!version) throw new Error(`no packs for origin "${origin}" in the store`)
  }

  const result = await installPack(store, origin, version, dest, rootPub, keyset)
  console.log(`Installed + pinned ${origin}@${version}`)
  console.log(`  signer:    ${result.signerKeyId ?? '(root)'}`)
  console.log(`  manifest:  ${result.manifestPath}`)
  console.log(`  scenarios: ${result.scenarioPaths.length} -> ${path.join(result.dir, 'scenarios')}`)
  return 0
}

async function catalogRun(args: ParsedArgs): Promise<number> {
  const origin = getRequiredPositional(args, 0, 'origin')
  const dest = path.resolve(process.cwd(), getRequiredFlag(args, 'dest'))
  const url = getRequiredFlag(args, 'url')
  const headless = args.flags.get('headed') !== true
  const installDir = path.join(dest, encodeURIComponent(origin))

  const result = await runInstalled(installDir, url, headless)
  for (const report of result.reports) console.log(formatReport(report))
  console.log(`\n${origin}: ${result.passed} passed, ${result.failed} failed`)
  return result.failed === 0 ? 0 : 1
}

// ---- helpers ---------------------------------------------------------------

function parsePackPayload(envelope: SignedEnvelope): { origin?: string; version?: string } {
  try {
    const payload = JSON.parse(envelope.payloadJson) as { data?: { origin?: string; version?: string } }
    return { origin: payload.data?.origin, version: payload.data?.version }
  } catch {
    return {}
  }
}

async function loadScenarios(dir: string): Promise<Scenario[]> {
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    return []
  }
  const scenarios: Scenario[] = []
  for (const entry of entries.sort()) {
    if (!entry.endsWith('.json')) continue
    try {
      const result = validateScenario(JSON.parse(await readFile(path.join(dir, entry), 'utf8')))
      if (result.ok) scenarios.push(result.scenario)
    } catch {
      /* skip non-scenario json */
    }
  }
  return scenarios
}

function pad(value: string | number, width: number): string {
  return String(value).padEnd(width, ' ')
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
  if (!value) throw new Error(`missing <${name}>\n\n${PACK_USAGE}`)
  return value
}

function getRequiredFlag(args: ParsedArgs, name: string): string {
  const value = args.flags.get(name)
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`missing --${name}\n\n${PACK_USAGE}`)
  return value
}
