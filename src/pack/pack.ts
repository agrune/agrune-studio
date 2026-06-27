// Site pack (PLAN Phase 6, Q5) — the distribution unit: a manifest (the self-healing map) + its
// scenarios (the verified QA suite), pinned together and SIGNED as ONE envelope (the generalized §12
// envelope, C4). A consumer pulls a pack and can QA the app immediately, not just automate it.
//
// Trust: the pack is signed by an admin and verified by the consumer under the pinned ROOT + keyset
// (Q3). The signature makes the whole pack inert data; on top of that, Studio validates the manifest
// (core `validateManifest`) and every scenario (closed-enum `validateScenario`) — pure data, no code.

import { z } from 'zod'
import {
  signPayload,
  verifyPayloadWithKeyset,
  validateManifest,
  type AgruneManifest,
  type KeysetEnvelope,
  type ManifestProvenance,
  type SignedEnvelope,
} from 'agrune'
import type { KeyObject } from 'node:crypto'
import { validateScenario, type Scenario } from '../scenario/schema.js'

export const PACK_SCHEMA_ID = 'agrune.pack/v1'

export interface SitePack {
  schema: typeof PACK_SCHEMA_ID
  name: string
  version: string
  origin?: string
  manifest: AgruneManifest
  scenarios: Scenario[]
}

const PackShape = z
  .object({
    schema: z.literal(PACK_SCHEMA_ID),
    name: z.string().min(1),
    version: z.string().min(1),
    origin: z.string().optional(),
    manifest: z.unknown(),
    scenarios: z.array(z.unknown()),
  })
  .strict()

export function createPack(input: {
  name: string
  version: string
  origin?: string
  manifest: AgruneManifest
  scenarios: Scenario[]
}): SitePack {
  return {
    schema: PACK_SCHEMA_ID,
    name: input.name,
    version: input.version,
    ...(input.origin ? { origin: input.origin } : {}),
    manifest: input.manifest,
    scenarios: input.scenarios,
  }
}

/** Sign a pack with an admin (or root) private key. Provenance travels under the signature. */
export function signPack(pack: SitePack, meta: ManifestProvenance | undefined, privateKey: KeyObject, keyId?: string): SignedEnvelope {
  return signPayload(pack, meta, privateKey, keyId)
}

export interface VerifiedPack {
  pack: SitePack
  provenance: ManifestProvenance
  signerKeyId?: string
  contentHash: string
}

export type PackVerifyResult = { ok: true; value: VerifiedPack } | { ok: false; reason: string; detail?: string }

/**
 * Verify a signed pack against the pinned ROOT + admin keyset, then validate its manifest and every
 * scenario. Mirrors the runtime trust gate: signature first (closed publish), schema second (pure
 * data). Any failure → rejected; a consumer never runs an unverified or schema-invalid pack.
 */
export function verifyPack(envelope: unknown, rootKey: KeyObject | null, keysetEnvelope: unknown): PackVerifyResult {
  const verified = verifyPayloadWithKeyset(envelope, rootKey, keysetEnvelope)
  if (!verified.ok) return { ok: false, reason: verified.reason, detail: verified.detail }

  const shape = PackShape.safeParse(verified.value.data)
  if (!shape.success) return { ok: false, reason: 'invalid-pack', detail: shape.error.issues[0]?.message }

  const manifest = validateManifest(shape.data.manifest)
  if (!manifest.ok) return { ok: false, reason: 'invalid-manifest', detail: manifest.errors[0]?.message }

  const scenarios: Scenario[] = []
  for (const [i, raw] of shape.data.scenarios.entries()) {
    const sc = validateScenario(raw)
    if (!sc.ok) return { ok: false, reason: 'invalid-scenario', detail: `scenarios[${i}]: ${sc.errors[0]?.message ?? 'invalid'}` }
    scenarios.push(sc.scenario)
  }

  return {
    ok: true,
    value: {
      pack: {
        schema: PACK_SCHEMA_ID,
        name: shape.data.name,
        version: shape.data.version,
        ...(shape.data.origin ? { origin: shape.data.origin } : {}),
        manifest: manifest.manifest,
        scenarios,
      },
      provenance: verified.value.provenance,
      ...(verified.value.keyId ? { signerKeyId: verified.value.keyId } : {}),
      contentHash: verified.value.contentHash,
    },
  }
}
