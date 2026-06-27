// Scenario report: per-step status + failure artifacts. Deterministic pass/fail (SPEC Phase 1).

export type StepStatus = 'pass' | 'fail' | 'skipped'

export interface StepResult {
  index: number
  kind: 'action' | 'assertion'
  /** The manifest ref this step addressed (action steps only) — drives auto-repair targeting. */
  ref?: string
  /** Human summary, e.g. `click submit` or `assert textPresent "Welcome"`. */
  summary: string
  status: StepStatus
  /** Failure reason when status === 'fail'. */
  detail?: string
  durationMs: number
  /** Action changed-bit (when the feedback signal is available). */
  changed?: boolean
  /** Cumulative console-error count observed up to this step. */
  consoleErrors?: number
  /** Screenshot path captured for this step, if artifacts were enabled. */
  screenshot?: string
}

export interface ScenarioReport {
  scenario: string
  url: string
  startedAt: number
  durationMs: number
  status: 'pass' | 'fail'
  steps: StepResult[]
  passed: number
  failed: number
  skipped: number
  /** Set when the run aborted before steps (e.g. browser launch failed, manifest mismatch). */
  error?: string
}

/** Render a report as a human-readable text block. */
export function formatReport(report: ScenarioReport): string {
  const lines: string[] = []
  const mark = report.status === 'pass' ? 'PASS' : 'FAIL'
  lines.push(`[${mark}] ${report.scenario}  (${report.url})`)
  lines.push(`  ${report.passed} passed, ${report.failed} failed, ${report.skipped} skipped — ${report.durationMs}ms`)
  if (report.error) lines.push(`  error: ${report.error}`)
  lines.push('')
  for (const step of report.steps) {
    const icon = step.status === 'pass' ? '✓' : step.status === 'fail' ? '✗' : '·'
    lines.push(`  ${icon} ${String(step.index + 1).padStart(2, ' ')}. ${step.summary}  (${step.durationMs}ms)`)
    if (step.detail) lines.push(`       → ${step.detail}`)
    if (step.screenshot) lines.push(`       shot: ${step.screenshot}`)
  }
  return lines.join('\n')
}
