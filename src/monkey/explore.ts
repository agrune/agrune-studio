// AI ② monkey testing (SPEC §4, PLAN Phase 4). A BOUNDED explorer: it only ever actuates targets
// the manifest DECLARES (it enumerates them from the snapshot, which is manifest-derived), so it can
// never click off-manifest — the §8.8 strict-mode cage, enforced here by construction. The oracle is
// the cheap, reliable v1 class: console errors, uncaught page errors, and network failures. When the
// oracle fires, the action sequence that triggered it is captured as a reproducible CANDIDATE
// SCENARIO a human can adopt.
//
// Reproducible by design: target selection is driven by a SEEDED PRNG and a coverage-first policy
// (unvisited targets first), so a (url, seed) pair always produces the same trail — the whole point
// is that a finding can be replayed deterministically.

import { BrowserSession, toAgentTargetRef, type PageTarget } from 'agrune'
import { executeStep } from '../scenario/runner.js'
import { SCENARIO_SCHEMA_ID, type ActionStep, type Scenario } from '../scenario/schema.js'

export type FindingKind = 'console-error' | 'network-failure' | 'page-crash'

export interface MonkeyFinding {
  kind: FindingKind
  detail: string
  /** The step index (0-based) at which the oracle fired. */
  atStep: number
  /** The action sequence that triggered it. */
  steps: ActionStep[]
  /** A reproducible scenario (the trail + a guarding assertion) a human can adopt. */
  candidate: Scenario
}

export interface MonkeyOptions {
  url: string
  headless?: boolean
  /** Max actions to attempt. Default 25. */
  maxSteps?: number
  /** PRNG seed for reproducible exploration. Default 1. */
  seed?: number
  /** Stop at the first finding (default false → keep exploring up to maxSteps). */
  stopOnFirst?: boolean
}

export interface MonkeyReport {
  url: string
  seed: number
  stepsAttempted: number
  /** Distinct refs the monkey actuated (agent form). */
  visited: string[]
  findings: MonkeyFinding[]
}

/** Deterministic PRNG (mulberry32) — no Math.random, so a seed fully determines the run. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const MONKEY_VALUES = ['monkey', "a'\"<>&", '0', '   ', 'x'.repeat(256)]

export async function runMonkey(opts: MonkeyOptions): Promise<MonkeyReport> {
  const seed = opts.seed ?? 1
  const maxSteps = opts.maxSteps ?? 25
  const rng = mulberry32(seed)
  const report: MonkeyReport = { url: opts.url, seed, stepsAttempted: 0, visited: [], findings: [] }
  const trail: ActionStep[] = []
  const visited = new Set<string>()
  let prevErrors = 0
  let prevFailures = 0

  const session = new BrowserSession(opts.headless ?? true)
  try {
    await session.start()
    await session.open(opts.url)
    // Baseline: ignore errors present on initial load (we hunt for errors our actions CAUSE).
    prevErrors = countConsoleErrors(session)
    prevFailures = countNetworkFailures(session)

    for (let step = 0; step < maxSteps; step += 1) {
      let actionable: PageTarget[]
      try {
        const snap = await session.snapshot()
        actionable = snap.targets.filter(isActuatable)
      } catch {
        break // no manifest / page gone
      }
      if (actionable.length === 0) break

      const target = pick(actionable, visited, rng)
      const action = buildAction(target, rng)
      const ref = action.do === 'wait' ? '' : (action as { ref?: string }).ref ?? ''
      if (ref) visited.add(ref)
      trail.push(action)
      report.stepsAttempted = step + 1

      let crashed: string | undefined
      try {
        await executeStep(session, action)
      } catch (err) {
        // A resolve/timeout error is not itself a bug (the page may have changed); a closed page is.
        if (session.page().isClosed?.()) crashed = `page closed after ${describe(action)}`
      }

      const finding = checkOracle(session, step, trail, opts.url, prevErrors, prevFailures, crashed)
      if (finding) {
        report.findings.push(finding.finding)
        prevErrors = finding.errors
        prevFailures = finding.failures
        if (opts.stopOnFirst) break
      }
    }
  } finally {
    await session.stop().catch(() => undefined)
  }

  report.visited = [...visited]
  return report
}

// ---- oracle ----------------------------------------------------------------

function countConsoleErrors(session: BrowserSession): number {
  try {
    return session.consoleMessages(undefined, { level: 'error', all: true }).length
  } catch {
    return 0
  }
}

function countNetworkFailures(session: BrowserSession): number {
  try {
    return session
      .networkRequests(undefined, { all: true, includeStatic: true })
      .filter((r) => r.failureText || (typeof r.status === 'number' && r.status >= 500)).length
  } catch {
    return 0
  }
}

function checkOracle(
  session: BrowserSession,
  step: number,
  trail: ActionStep[],
  url: string,
  prevErrors: number,
  prevFailures: number,
  crashed: string | undefined,
): { finding: MonkeyFinding; errors: number; failures: number } | null {
  const errors = countConsoleErrors(session)
  const failures = countNetworkFailures(session)

  let kind: FindingKind | undefined
  let detail = ''
  if (crashed) {
    kind = 'page-crash'
    detail = crashed
  } else if (errors > prevErrors) {
    kind = 'console-error'
    const msgs = session.consoleMessages(undefined, { level: 'error', all: true })
    detail = msgs[msgs.length - 1]?.text ?? 'console error'
  } else if (failures > prevFailures) {
    kind = 'network-failure'
    const f = session
      .networkRequests(undefined, { all: true, includeStatic: true })
      .filter((r) => r.failureText || (typeof r.status === 'number' && r.status >= 500))
    const last = f[f.length - 1]
    detail = last ? `${last.status ?? ''} ${last.failureText ?? ''} ${last.url}`.trim() : 'network failure'
  }
  if (!kind) return null

  const steps = [...trail]
  return {
    errors,
    failures,
    finding: {
      kind,
      detail,
      atStep: step,
      steps,
      candidate: buildCandidate(url, steps, kind),
    },
  }
}

// ---- exploration policy ----------------------------------------------------

/** A target is actuatable if it is declared, currently actionable, non-sensitive, and supports a
 *  safe verb (click/fill). Sensitive targets (passwords) are never touched. */
function isActuatable(t: PageTarget): boolean {
  if (t.sensitive) return false
  if (!t.actionableNow || !t.visible) return false
  return t.actionKinds.includes('click') || t.actionKinds.includes('fill')
}

/** Coverage-first: prefer targets not yet visited; among the chosen pool pick with the seeded PRNG. */
function pick(candidates: PageTarget[], visited: Set<string>, rng: () => number): PageTarget {
  const fresh = candidates.filter((t) => !visited.has(toAgentTargetRef(t)))
  const pool = fresh.length > 0 ? fresh : candidates
  return pool[Math.floor(rng() * pool.length)] ?? pool[0]!
}

function buildAction(target: PageTarget, rng: () => number): ActionStep {
  const ref = toAgentTargetRef(target)
  if (target.actionKinds.includes('fill')) {
    const value = MONKEY_VALUES[Math.floor(rng() * MONKEY_VALUES.length)] ?? 'monkey'
    return { do: 'fill', ref, value }
  }
  return { do: 'click', ref }
}

function buildCandidate(url: string, steps: ActionStep[], kind: FindingKind): Scenario {
  return {
    schema: SCENARIO_SCHEMA_ID,
    name: `monkey repro (${kind})`,
    description: `Auto-captured by the monkey explorer; reproduces a ${kind}. Adopt + refine into a regression test.`,
    manifest: { schemaVersion: 3 },
    url,
    // The guard asserts the healthy state; with the bug present it fails at this step (the repro).
    steps: [...steps, { assert: 'noConsoleErrors', label: `should not ${kind}` }],
  }
}

function describe(action: ActionStep): string {
  return action.do === 'wait' ? `wait ${action.ms}ms` : `${action.do} ${(action as { ref?: string }).ref ?? ''}`
}

/** Render a monkey report as human-readable text. */
export function formatMonkeyReport(report: MonkeyReport): string {
  const lines: string[] = []
  lines.push(`monkey ${report.url}  (seed ${report.seed}, ${report.stepsAttempted} steps, ${report.visited.length} targets)`)
  if (report.findings.length === 0) {
    lines.push('  no findings — no crash/console/network errors surfaced.')
    return lines.join('\n')
  }
  lines.push(`  ${report.findings.length} finding(s):`)
  for (const f of report.findings) {
    lines.push(`  ✗ [${f.kind}] at step ${f.atStep + 1}: ${f.detail}`)
    lines.push(`      repro: ${f.steps.map(describe).join(' → ')}`)
  }
  return lines.join('\n')
}
