// Coverage model for scenario discovery (Phase 5). Pure: given the declared manifest targets and the
// existing scenario suite, compute which declared refs are exercised and which are not. This is the
// measuring stick for "coverage delta" when a discovered flow is adopted.

import { normalizeAgentTargetId, parseRepeatedTargetId, type AgruneManifest } from 'agrune'
import { isAssertionStep, type Scenario } from '../scenario/schema.js'

/** Direct group targets that support an interactive verb (click/fill/…) — the discoverable surface.
 *  Repeat-template targets are addressed by key at runtime; v1 coverage tracks direct targets. */
export function actionableTargetIds(manifest: AgruneManifest): string[] {
  const ids: string[] = []
  for (const group of manifest.groups) {
    for (const t of group.targets) {
      if (t.actionKinds.length > 0) ids.push(t.targetId)
    }
  }
  return [...new Set(ids)]
}

/** Base targetId a scenario ref addresses (strips a repeat key: `r[key=a].x` → `x`). */
export function baseRef(ref: string): string {
  const normalized = normalizeAgentTargetId(ref)
  const repeat = parseRepeatedTargetId(normalized)
  return repeat ? repeat.baseTargetId : normalized
}

/** The declared refs a scenario exercises (its action steps' refs, as base targetIds). */
export function refsInScenario(scenario: Scenario): string[] {
  const refs: string[] = []
  for (const step of scenario.steps) {
    if (isAssertionStep(step)) continue
    if ('ref' in step && typeof step.ref === 'string') {
      try {
        refs.push(baseRef(step.ref))
      } catch {
        refs.push(step.ref)
      }
    }
  }
  return [...new Set(refs)]
}

export interface Coverage {
  declared: string[]
  covered: string[]
  uncovered: string[]
  /** covered / declared, 0..1 (1 when nothing is declared). */
  ratio: number
}

export function computeCoverage(manifest: AgruneManifest, scenarios: Scenario[]): Coverage {
  const declared = actionableTargetIds(manifest)
  const declaredSet = new Set(declared)
  const covered = new Set<string>()
  for (const s of scenarios) {
    for (const ref of refsInScenario(s)) {
      if (declaredSet.has(ref)) covered.add(ref)
    }
  }
  const uncovered = declared.filter((id) => !covered.has(id))
  return {
    declared,
    covered: [...covered],
    uncovered,
    ratio: declared.length === 0 ? 1 : covered.size / declared.length,
  }
}
