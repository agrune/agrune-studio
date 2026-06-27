// AI ③ scenario discovery (SPEC §4, PLAN Phase 5). The AI walks the app and PROPOSES uncovered
// flows; a human REVIEWS and adopts a proposal into a deterministic scenario (proposal = AI, adoption
// = human — the same split as repair). Proposals are deduped against the existing suite's coverage,
// and the coverage delta is measured. The proposer is the only AI seam; the default is a
// deterministic heuristic so the pipeline is testable without an LLM.

import { BrowserSession, loadManifestFromPage, type AgruneManifest, type PageSnapshot } from 'agrune'
import { SCENARIO_SCHEMA_ID, type ActionStep, type Scenario } from '../scenario/schema.js'
import { computeCoverage, type Coverage } from './coverage.js'

export interface FlowProposal {
  name: string
  rationale: string
  /** Declared targetIds this flow newly exercises. */
  newRefs: string[]
  scenario: Scenario
}

export type ProposeFlows = (ctx: {
  manifest: AgruneManifest
  snapshot: PageSnapshot
  uncovered: string[]
  url: string
}) => FlowProposal[]

export interface DiscoveryOptions {
  url: string
  existing?: Scenario[]
  headless?: boolean
  /** The AI seam. Default: group-based heuristic over uncovered actionable targets. */
  propose?: ProposeFlows
}

export interface DiscoveryReport {
  url: string
  before: Coverage
  /** Coverage if every proposal were adopted. */
  projected: Coverage
  proposals: FlowProposal[]
  error?: string
}

export async function runDiscovery(opts: DiscoveryOptions): Promise<DiscoveryReport> {
  const existing = opts.existing ?? []
  const session = new BrowserSession(opts.headless ?? true)
  try {
    await session.start()
    await session.open(opts.url)
    const manifest = await loadManifestFromPage(session.page()).catch(() => null)
    if (!manifest) {
      return {
        url: opts.url,
        before: emptyCoverage(),
        projected: emptyCoverage(),
        proposals: [],
        error: 'no manifest exposed on the page (cannot discover)',
      }
    }
    const snapshot = await session.snapshot()
    const before = computeCoverage(manifest, existing)

    const proposer = opts.propose ?? heuristicPropose
    const raw = proposer({ manifest, snapshot, uncovered: before.uncovered, url: opts.url })

    // Dedup: drop proposals that add nothing new vs. the existing suite, and refs already proposed.
    const seen = new Set(before.covered)
    const proposals: FlowProposal[] = []
    for (const p of raw) {
      const fresh = p.newRefs.filter((r) => !seen.has(r))
      if (fresh.length === 0) continue
      fresh.forEach((r) => seen.add(r))
      proposals.push({ ...p, newRefs: fresh })
    }

    const projected = computeCoverage(manifest, [...existing, ...proposals.map((p) => p.scenario)])
    return { url: opts.url, before, projected, proposals }
  } finally {
    await session.stop().catch(() => undefined)
  }
}

// ---- default heuristic proposer --------------------------------------------

/** One flow per group that has uncovered actionable targets: fill its uncovered inputs, click its
 *  uncovered primary action, and guard with `noConsoleErrors`. Deterministic + green on a healthy app. */
export const heuristicPropose: ProposeFlows = ({ manifest, snapshot, uncovered, url }) => {
  const uncoveredSet = new Set(uncovered)
  const actionableNow = new Set(snapshot.targets.filter((t) => t.actionableNow && t.visible).map((t) => t.targetId))
  const proposals: FlowProposal[] = []

  for (const group of manifest.groups) {
    const targets = group.targets.filter((t) => uncoveredSet.has(t.targetId) && actionableNow.has(t.targetId) && !t.sensitive)
    if (targets.length === 0) continue

    const steps: ActionStep[] = []
    const newRefs: string[] = []
    for (const t of targets.filter((t) => t.actionKinds.includes('fill'))) {
      steps.push({ do: 'fill', ref: t.targetId, value: 'discovery' })
      newRefs.push(t.targetId)
    }
    const clickable = targets.find((t) => t.actionKinds.includes('click'))
    if (clickable) {
      steps.push({ do: 'click', ref: clickable.targetId })
      newRefs.push(clickable.targetId)
    }
    if (steps.length === 0) continue

    proposals.push({
      name: `${group.groupId} flow`,
      rationale: `exercises ${newRefs.length} uncovered target(s) in group "${group.groupId}"`,
      newRefs: [...new Set(newRefs)],
      scenario: {
        schema: SCENARIO_SCHEMA_ID,
        name: `${group.groupId} flow (discovered)`,
        description: `AI-proposed flow for group "${group.groupId}". Review + adopt as a regression test.`,
        manifest: { schemaVersion: 3 },
        url,
        steps: [...steps, { assert: 'noConsoleErrors', label: 'flow should not error' }],
      },
    })
  }
  return proposals
}

function emptyCoverage(): Coverage {
  return { declared: [], covered: [], uncovered: [], ratio: 1 }
}

function pct(ratio: number): string {
  return `${Math.round(ratio * 100)}%`
}

/** Render a discovery report as human-readable text. */
export function formatDiscoveryReport(report: DiscoveryReport): string {
  const lines: string[] = []
  lines.push(`discover ${report.url}`)
  if (report.error) {
    lines.push(`  error: ${report.error}`)
    return lines.join('\n')
  }
  lines.push(
    `  coverage: ${report.before.covered.length}/${report.before.declared.length} (${pct(report.before.ratio)})` +
      ` → projected ${report.projected.covered.length}/${report.projected.declared.length} (${pct(report.projected.ratio)}) if all adopted`,
  )
  if (report.proposals.length === 0) {
    lines.push('  no new flows proposed (coverage is complete or nothing actionable is uncovered).')
    return lines.join('\n')
  }
  lines.push(`  ${report.proposals.length} proposal(s):`)
  report.proposals.forEach((p, i) => {
    lines.push(`  [${i}] ${p.name} — ${p.rationale}`)
    lines.push(`       new: ${p.newRefs.join(', ')}`)
  })
  lines.push('')
  lines.push('  adopt one with:  agrune-studio discover <url> --scenarios <dir> --adopt <i> --out <file>')
  return lines.join('\n')
}
