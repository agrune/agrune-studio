// AI ① auto-repair (SPEC §4, PLAN Phase 2). When a scenario breaks because a ref DRIFTED (the
// element moved/renamed and the manifest selector no longer resolves), re-ground it WITHOUT touching
// the scenario: propose a new selector → the core's mechanical verify gate → replay against the
// healed map. The propose step is the only AI seam; everything else is deterministic.
//
// The load-bearing guarantee is the core's gate (`runRepair` → `verifyRepair`): a proposal is
// adopted ONLY if it (a) names a declared target, (b) keeps the manifest valid, and (c) actually
// resolves on the live page. A WRONG proposal cannot resolve, so it can never make a red scenario
// go green — "needs human," never a false heal.

import { writeFile } from 'node:fs/promises'
import {
  BrowserSession,
  loadManifestFromPage,
  runRepair,
  type AgruneManifest,
  type ManifestTarget,
  type ProposeSelector,
  type RepairOracle,
  type RepairVerdict,
  type TargetPatch,
} from 'agrune'
import type { Scenario } from './schema.js'
import { executeStep, runScenario, type RunOptions } from './runner.js'
import type { ScenarioReport } from './report.js'

export interface RepairOptions extends RunOptions {
  /** The AI seam: propose a new selector for a drifted target. Default: re-ground by visible name. */
  propose?: ProposeSelector
  /** Optional effect oracle passed to the core gate (act → expected effect). */
  oracle?: RepairOracle
  /** When set, the healed manifest is written here (for review / Phase 3 publishing). */
  writeMergedTo?: string
}

export type RepairStatus = 'already-green' | 'healed' | 'needs-human'

export interface RepairReport {
  scenario: string
  url: string
  status: RepairStatus
  /** The original (failing or passing) run. */
  before: ScenarioReport
  /** The replay against the healed map (only when a repair was attempted + verified). */
  after?: ScenarioReport
  driftedRef?: string
  proposed?: TargetPatch[]
  verdicts?: RepairVerdict[]
  mergedManifest?: AgruneManifest
  mergedPath?: string
  detail?: string
}

/** Default propose: re-ground the drifted target by its visible name (the most common stable
 *  identity that survives a selector change). Best-effort — the verify gate is the safety net. */
export const heuristicPropose: ProposeSelector = async (target) => {
  if (target.name && target.name.trim()) return { text: target.name }
  if (target.desc && target.desc.trim()) return { text: target.desc }
  return null
}

export async function repairScenario(scenario: Scenario, opts: RepairOptions = {}): Promise<RepairReport> {
  const url = opts.url ?? scenario.url
  const before = await runScenario(scenario, opts)
  const report: RepairReport = { scenario: scenario.name, url: url ?? '(from steps)', status: 'needs-human', before }

  if (before.status === 'pass') {
    report.status = 'already-green'
    return report
  }

  // Find the first failing ACTION step that addressed a ref — that's the drift candidate.
  const failingStep = before.steps.find((s) => s.status === 'fail')
  if (!failingStep || failingStep.kind !== 'action' || !failingStep.ref) {
    report.detail = 'the failure is not a target drift (no resolvable ref to repair)'
    return report
  }
  const driftedRef = failingStep.ref
  report.driftedRef = driftedRef
  if (!url) {
    report.detail = 'no app URL to repair against'
    return report
  }

  // Replay the successful prefix to reach the page state where the drift bites, then repair there.
  const session = new BrowserSession(opts.headless ?? true)
  let outcome
  try {
    await session.start()
    await session.open(url)
    for (let i = 0; i < failingStep.index; i += 1) {
      await executeStep(session, scenario.steps[i]!)
    }
    const page = session.page()
    const base = await loadManifestFromPage(page).catch(() => null)
    if (!base) {
      report.detail = 'no manifest exposed on the page (cannot repair)'
      return report
    }
    const drifted = findDriftedTarget(base, driftedRef)
    if (!drifted) {
      report.detail = `ref "${driftedRef}" is not a direct manifest target (repeat-target repair is out of scope)`
      return report
    }
    const ariaFallback = await page.locator('body').ariaSnapshot().catch(() => '')
    outcome = await runRepair({
      page,
      base,
      drifted: [drifted],
      ariaFallback,
      propose: opts.propose ?? heuristicPropose,
      ...(opts.oracle ? { oracle: opts.oracle } : {}),
    })
  } finally {
    await session.stop().catch(() => undefined)
  }

  report.proposed = outcome.proposed
  report.verdicts = outcome.result.verdicts
  if (!outcome.publishable) {
    report.detail = 'no proposal passed the verify gate (wrong fixes cannot go green)'
    return report
  }

  // A repair was verified — replay the WHOLE scenario against the healed map.
  const merged = outcome.result.merged
  const after = await runScenario(scenario, { ...opts, manifestOverride: merged })
  report.after = after
  report.mergedManifest = merged
  if (after.status === 'pass') {
    report.status = 'healed'
    if (opts.writeMergedTo) {
      await writeFile(opts.writeMergedTo, `${JSON.stringify(merged, null, 2)}\n`, 'utf8')
      report.mergedPath = opts.writeMergedTo
    }
  } else {
    report.detail = 'the drifted ref was repaired but the scenario is still red (another failure remains)'
  }
  return report
}

/** Find a DIRECT group target by ref (the scope the core repair gate accepts). */
function findDriftedTarget(base: AgruneManifest, ref: string): { groupId: string; target: ManifestTarget } | undefined {
  for (const group of base.groups) {
    const target = group.targets.find((t) => t.targetId === ref)
    if (target) return { groupId: group.groupId, target }
  }
  return undefined
}

/** Format a repair report as human-readable text. */
export function formatRepairReport(report: RepairReport): string {
  const lines: string[] = []
  const head =
    report.status === 'healed' ? 'HEALED' : report.status === 'already-green' ? 'ALREADY GREEN' : 'NEEDS HUMAN'
  lines.push(`[${head}] ${report.scenario}  (${report.url})`)
  if (report.driftedRef) lines.push(`  drifted ref: ${report.driftedRef}`)
  if (report.proposed?.length) {
    for (const p of report.proposed) lines.push(`  proposed: ${p.targetId} -> ${JSON.stringify(p.selector)}`)
  }
  if (report.verdicts?.length) {
    for (const v of report.verdicts) {
      lines.push(`  verdict ${v.targetId}: ${v.eligible ? 'ELIGIBLE' : `rejected (${v.reason ?? 'n/a'})`}`)
    }
  }
  if (report.detail) lines.push(`  ${report.detail}`)
  if (report.mergedPath) lines.push(`  healed manifest written: ${report.mergedPath}`)
  if (report.status === 'healed' && report.after) {
    lines.push(`  replay: ${report.after.passed}/${report.after.steps.length} steps green`)
  }
  return lines.join('\n')
}
