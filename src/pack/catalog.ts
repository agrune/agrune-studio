// Catalog over the signed dir store (PLAN Phase 6): discover packs (with verified provenance),
// install/consume (verify under the pinned root + keyset, then pin locally), and run the pinned
// scenarios immediately. Publish is closed (admin-signed); consume is open (anyone with the root).

import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises'
import path from 'node:path'
import type { KeyObject } from 'node:crypto'
import { readStoreIndex, scanStore, type StoreIndexEntry } from 'agrune'
import { verifyPack, type VerifiedPack } from './pack.js'
import { runScenario } from '../scenario/runner.js'
import type { ScenarioReport } from '../scenario/report.js'

export interface CatalogItem {
  origin: string
  version: string
  /** Verified provenance when the pack passes the trust gate; otherwise `verified` is false. */
  verified: boolean
  name?: string
  signerKeyId?: string
  publishedAt?: string
  scenarioCount?: number
  reason?: string
}

/** Enumerate store packs (index if present, else a live scan) and verify each under root + keyset. */
export async function listCatalog(storeRoot: string, rootKey: KeyObject | null, keysetEnvelope: unknown): Promise<CatalogItem[]> {
  const index = readStoreIndex(storeRoot)
  const entries: StoreIndexEntry[] = index?.packs ?? scanStore(storeRoot)
  const items: CatalogItem[] = []
  for (const entry of entries) {
    const item: CatalogItem = { origin: entry.origin, version: entry.version, verified: false }
    try {
      const envelope = JSON.parse(await readFile(path.join(storeRoot, entry.path), 'utf8'))
      const result = verifyPack(envelope, rootKey, keysetEnvelope)
      if (result.ok) {
        item.verified = true
        item.name = result.value.pack.name
        item.scenarioCount = result.value.pack.scenarios.length
        if (result.value.signerKeyId) item.signerKeyId = result.value.signerKeyId
        if (result.value.provenance.publishedAt) item.publishedAt = result.value.provenance.publishedAt
      } else {
        item.reason = result.reason
      }
    } catch (err) {
      item.reason = `unreadable: ${(err as Error).message}`
    }
    items.push(item)
  }
  return items
}

/** Versions available for an origin, newest-string last (caller picks latest or pins one). */
export function versionsFor(items: CatalogItem[], origin: string): string[] {
  return items.filter((i) => i.origin === origin).map((i) => i.version)
}

export interface InstallResult {
  origin: string
  version: string
  dir: string
  manifestPath: string
  scenarioPaths: string[]
  signerKeyId?: string
  contentHash: string
}

/**
 * Consume a pack: verify under the pinned root + keyset, then PIN it locally — write the manifest +
 * scenarios + a `pinned.json` recording exactly what was installed (version, signer, contentHash).
 * A pack that fails the trust gate is never written.
 */
export async function installPack(
  storeRoot: string,
  origin: string,
  version: string,
  destRoot: string,
  rootKey: KeyObject | null,
  keysetEnvelope: unknown,
): Promise<InstallResult> {
  const entry = scanStore(storeRoot).find((e) => e.origin === origin && e.version === version)
  if (!entry) throw new Error(`pack not found in store: ${origin}@${version}`)
  const envelope = JSON.parse(await readFile(path.join(storeRoot, entry.path), 'utf8'))
  const result = verifyPack(envelope, rootKey, keysetEnvelope)
  if (!result.ok) throw new Error(`refusing to install — pack did not verify: ${result.reason}${result.detail ? ` (${result.detail})` : ''}`)

  const dir = path.join(destRoot, encodeURIComponent(origin))
  const scenariosDir = path.join(dir, 'scenarios')
  await mkdir(scenariosDir, { recursive: true })

  const manifestPath = path.join(dir, 'manifest.json')
  await writeFile(manifestPath, `${JSON.stringify(result.value.pack.manifest, null, 2)}\n`, 'utf8')

  const scenarioPaths: string[] = []
  for (const [i, scenario] of result.value.pack.scenarios.entries()) {
    const file = path.join(scenariosDir, `${String(i).padStart(2, '0')}-${slug(scenario.name)}.json`)
    await writeFile(file, `${JSON.stringify(scenario, null, 2)}\n`, 'utf8')
    scenarioPaths.push(file)
  }

  const pinned = {
    origin,
    version,
    contentHash: result.value.contentHash,
    signerKeyId: result.value.signerKeyId,
    installedFrom: storeRoot,
  }
  await writeFile(path.join(dir, 'pinned.json'), `${JSON.stringify(pinned, null, 2)}\n`, 'utf8')

  return {
    origin,
    version,
    dir,
    manifestPath,
    scenarioPaths,
    ...(result.value.signerKeyId ? { signerKeyId: result.value.signerKeyId } : {}),
    contentHash: result.value.contentHash,
  }
}

export interface CatalogRunResult {
  origin: string
  url: string
  reports: ScenarioReport[]
  passed: number
  failed: number
}

/** Run an installed pack's pinned scenarios against a live app, using the PINNED manifest as the
 *  resolver override so the suite stands on the map the pack shipped, not whatever the app serves. */
export async function runInstalled(installDir: string, url: string, headless = true): Promise<CatalogRunResult> {
  const origin = decodeURIComponent(path.basename(installDir))
  const manifest = JSON.parse(await readFile(path.join(installDir, 'manifest.json'), 'utf8'))
  const scenariosDir = path.join(installDir, 'scenarios')
  const files = (await readdir(scenariosDir)).filter((f) => f.endsWith('.json')).sort()

  const reports: ScenarioReport[] = []
  for (const file of files) {
    const scenario = JSON.parse(await readFile(path.join(scenariosDir, file), 'utf8'))
    reports.push(await runScenario(scenario, { url, headless, manifestOverride: manifest }))
  }
  return {
    origin,
    url,
    reports,
    passed: reports.filter((r) => r.status === 'pass').length,
    failed: reports.filter((r) => r.status === 'fail').length,
  }
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'scenario'
}

export type { VerifiedPack }
