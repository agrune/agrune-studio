// Deterministic scenario runner (SPEC Phase 1). Drives the agrune core engine step-by-step over
// manifest refs, evaluates declarative assertions, captures per-step artifacts, and returns a
// deterministic pass/fail report. NO AI is involved — execution is pure and repeatable (SPEC §1).

import path from 'node:path'
import { BrowserSession, normalizeAgentTargetId, type AgruneManifest, type PageSnapshot, type PageTarget } from 'agrune'
import { isAssertionStep, type ActionStep, type AssertionStep, type Scenario, type Step } from './schema.js'
import type { ScenarioReport, StepResult } from './report.js'

export interface RunOptions {
  /** Overrides scenario.url (the `--url <app>` flag). */
  url?: string
  /** Default true; set false to watch the run. */
  headless?: boolean
  /** When set, a screenshot is written per step under this dir. */
  artifactsDir?: string
  /** Capture a screenshot per step (requires artifactsDir). Default false. */
  screenshots?: boolean
  /**
   * Resolve refs against THIS manifest instead of the page's own `window.__agrune_manifest__`.
   * Used by auto-repair to replay a scenario against the healed map (Phase 2). Re-injected after
   * every navigation so it survives page loads.
   */
  manifestOverride?: AgruneManifest
}

/** Step ref for action steps (drives repair targeting); undefined for assertions / navigate / wait. */
export function stepRef(step: Step): string | undefined {
  if (isAssertionStep(step)) return undefined
  return 'ref' in step ? step.ref : undefined
}

/** Overwrite the page's manifest so refs resolve against `manifest` (auto-repair re-run). Runs
 *  AFTER page scripts so it wins over an inline `window.__agrune_manifest__`. */
export async function injectManifestOverride(session: BrowserSession, manifest: AgruneManifest): Promise<void> {
  await session
    .page()
    .evaluate((m) => {
      ;(globalThis as unknown as { __agrune_manifest__: unknown }).__agrune_manifest__ = m
    }, manifest)
    .catch(() => undefined)
}

/** Execute one step; throws on action/assertion failure. Returns the changed-bit when available. */
export async function executeStep(session: BrowserSession, step: Step): Promise<{ changed?: boolean }> {
  if (isAssertionStep(step)) {
    await evaluateAssertion(session, step)
    return {}
  }
  return { changed: await performAction(session, step) }
}

class StepFailure extends Error {}

/** Run a validated scenario, returning a deterministic report. Never throws for step failures —
 *  only a setup error (no URL, browser launch) sets report.error. */
export async function runScenario(scenario: Scenario, opts: RunOptions = {}): Promise<ScenarioReport> {
  const startUrl = opts.url ?? scenario.url ?? null
  const startedAt = Date.now()
  const steps: StepResult[] = []
  const report: ScenarioReport = {
    scenario: scenario.name,
    url: startUrl ?? '(from steps)',
    startedAt,
    durationMs: 0,
    status: 'fail',
    steps,
    passed: 0,
    failed: 0,
    skipped: 0,
  }

  const session = new BrowserSession(opts.headless ?? true)
  let started = false
  try {
    await session.start()
    started = true
    await session.open(startUrl ?? 'about:blank')
    if (opts.manifestOverride) await injectManifestOverride(session, opts.manifestOverride)

    let aborted = false
    for (let i = 0; i < scenario.steps.length; i += 1) {
      const step = scenario.steps[i]!
      const summary = summarizeStep(step)
      const ref = stepRef(step)
      if (aborted) {
        const skipped: StepResult = { index: i, kind: isAssertionStep(step) ? 'assertion' : 'action', summary, status: 'skipped', durationMs: 0 }
        if (ref) skipped.ref = ref
        steps.push(skipped)
        report.skipped += 1
        continue
      }

      const t0 = Date.now()
      let status: 'pass' | 'fail' = 'pass'
      let detail: string | undefined
      let changed: boolean | undefined
      try {
        const out = await executeStep(session, step)
        changed = out.changed
        // re-assert the healed map after a navigation reset it
        if (opts.manifestOverride && !isAssertionStep(step) && step.do === 'navigate') {
          await injectManifestOverride(session, opts.manifestOverride)
        }
      } catch (err) {
        status = 'fail'
        detail = err instanceof Error ? err.message : String(err)
      }
      const durationMs = Date.now() - t0

      const result: StepResult = {
        index: i,
        kind: isAssertionStep(step) ? 'assertion' : 'action',
        summary,
        status,
        durationMs,
      }
      if (ref) result.ref = ref
      if (detail) result.detail = detail
      if (changed !== undefined) result.changed = changed
      result.consoleErrors = safeConsoleErrorCount(session)
      if (opts.screenshots && opts.artifactsDir) {
        result.screenshot = await captureShot(session, opts.artifactsDir, i).catch(() => undefined)
      }
      steps.push(result)

      if (status === 'pass') report.passed += 1
      else {
        report.failed += 1
        aborted = true // stop-on-first-failure; remaining steps marked skipped
      }
    }

    report.status = report.failed === 0 ? 'pass' : 'fail'
  } catch (err) {
    report.error = err instanceof Error ? err.message : String(err)
    report.status = 'fail'
  } finally {
    if (started) await session.stop().catch(() => undefined)
  }

  report.durationMs = Date.now() - startedAt
  return report
}

// ---- actions ---------------------------------------------------------------

/** Execute one action step; returns the changed-bit when the engine surfaces it. */
async function performAction(session: BrowserSession, step: ActionStep): Promise<boolean | undefined> {
  switch (step.do) {
    case 'navigate':
      await session.navigate(step.url)
      return undefined
    case 'click':
    case 'dblclick':
    case 'contextmenu':
    case 'hover':
    case 'longpress': {
      const res = await session.click(undefined, step.ref, step.do)
      return res.changed
    }
    case 'fill': {
      const res = await session.fill(undefined, step.ref, step.value, step.clear ?? true)
      return res.changed
    }
    case 'type':
      await session.type(undefined, step.ref, step.text, undefined, step.submit ?? false)
      return undefined
    case 'press':
      await session.press(undefined, step.key, step.ref)
      return undefined
    case 'select':
      await session.select(undefined, step.ref, [{ value: step.value }])
      return undefined
    case 'check':
      await session.check(undefined, step.ref)
      return undefined
    case 'uncheck':
      await session.uncheck(undefined, step.ref)
      return undefined
    case 'wait':
      await session.waitForTime(undefined, step.ms)
      return undefined
    case 'waitFor':
      await session.waitForTarget(undefined, step.ref, step.state, step.timeoutMs ?? 10_000)
      return undefined
  }
}

// ---- assertions (closed declarative enum) ----------------------------------

async function evaluateAssertion(session: BrowserSession, step: AssertionStep): Promise<void> {
  const page = session.page()
  switch (step.assert) {
    case 'urlContains': {
      const url = page.url()
      if (!url.includes(step.value)) throw new StepFailure(`url "${url}" does not contain "${step.value}"`)
      return
    }
    case 'urlEquals': {
      const url = page.url()
      if (url !== step.value) throw new StepFailure(`url "${url}" !== "${step.value}"`)
      return
    }
    case 'titleContains': {
      const title = await page.title()
      if (!title.includes(step.value)) throw new StepFailure(`title "${title}" does not contain "${step.value}"`)
      return
    }
    case 'textPresent': {
      const text = await readBodyText(session)
      if (!text.includes(step.value)) throw new StepFailure(`page text does not contain "${step.value}"`)
      return
    }
    case 'textAbsent': {
      const text = await readBodyText(session)
      if (text.includes(step.value)) throw new StepFailure(`page text unexpectedly contains "${step.value}"`)
      return
    }
    case 'targetVisible': {
      const t = await findSnapshotTarget(session, step.ref)
      if (!t) throw new StepFailure(`target "${step.ref}" not present in snapshot`)
      if (!t.visible) throw new StepFailure(`target "${step.ref}" is present but not visible (reason: ${t.reason})`)
      return
    }
    case 'targetHidden': {
      const t = await findSnapshotTarget(session, step.ref)
      if (!t) throw new StepFailure(`target "${step.ref}" not present in snapshot (cannot assert hidden)`)
      if (t.visible) throw new StepFailure(`target "${step.ref}" is visible (expected hidden)`)
      return
    }
    case 'targetCount': {
      const actual = await countRepeatInstances(session, step.repeat)
      if (actual !== step.count) throw new StepFailure(`repeat "${step.repeat}" has ${actual} instance(s), expected ${step.count}`)
      return
    }
    case 'noConsoleErrors': {
      const errors = session.consoleMessages(undefined, { level: 'error', all: true })
      if (errors.length > 0) {
        const first = errors[0]
        throw new StepFailure(`${errors.length} console error(s); first: ${first?.text ?? '(no text)'}`)
      }
      return
    }
    case 'networkStatus': {
      const matches = session
        .networkRequests(undefined, { all: true, includeStatic: true })
        .filter((r) => r.url.includes(step.urlContains))
      if (matches.length === 0) throw new StepFailure(`no request URL contained "${step.urlContains}"`)
      const ok = matches.some((r) => r.status === step.status)
      if (!ok) {
        const seen = matches.map((r) => r.status ?? '(pending)').join(', ')
        throw new StepFailure(`no request to "${step.urlContains}" returned ${step.status} (saw: ${seen})`)
      }
      return
    }
  }
}

// ---- helpers ---------------------------------------------------------------

async function readBodyText(session: BrowserSession): Promise<string> {
  try {
    return await session.page().locator('body').innerText()
  } catch {
    return ''
  }
}

async function snapshotOrThrow(session: BrowserSession): Promise<PageSnapshot> {
  try {
    return await session.snapshot()
  } catch (err) {
    throw new StepFailure(`snapshot failed (is a manifest exposed on the page?): ${err instanceof Error ? err.message : String(err)}`)
  }
}

async function findSnapshotTarget(session: BrowserSession, ref: string): Promise<PageTarget | undefined> {
  const snap = await snapshotOrThrow(session)
  const normalized = safeNormalize(ref)
  return snap.targets.find((t) => t.targetId === normalized || t.targetId === ref)
}

async function countRepeatInstances(session: BrowserSession, repeatId: string): Promise<number> {
  const snap = await snapshotOrThrow(session)
  const keys = new Set<string>()
  for (const t of snap.targets) {
    if (t.repeatInstance?.repeatId === repeatId) keys.add(t.repeatInstance.key)
  }
  return keys.size
}

function safeNormalize(ref: string): string {
  try {
    return normalizeAgentTargetId(ref)
  } catch {
    return ref
  }
}

function safeConsoleErrorCount(session: BrowserSession): number {
  try {
    return session.consoleMessages(undefined, { level: 'error', all: true }).length
  } catch {
    return 0
  }
}

async function captureShot(session: BrowserSession, dir: string, index: number): Promise<string> {
  const file = path.join(dir, `step-${String(index + 1).padStart(2, '0')}.png`)
  return session.screenshot(undefined, file)
}

function summarizeStep(step: Step): string {
  if (isAssertionStep(step)) {
    const label = step.label ? ` — ${step.label}` : ''
    switch (step.assert) {
      case 'urlContains':
      case 'urlEquals':
      case 'titleContains':
      case 'textPresent':
      case 'textAbsent':
        return `assert ${step.assert} "${step.value}"${label}`
      case 'targetVisible':
      case 'targetHidden':
        return `assert ${step.assert} ${step.ref}${label}`
      case 'targetCount':
        return `assert targetCount ${step.repeat} == ${step.count}${label}`
      case 'noConsoleErrors':
        return `assert noConsoleErrors${label}`
      case 'networkStatus':
        return `assert networkStatus ${step.urlContains} -> ${step.status}${label}`
    }
  }
  const label = step.label ? ` — ${step.label}` : ''
  switch (step.do) {
    case 'navigate':
      return `navigate ${step.url}${label}`
    case 'fill':
      return `fill ${step.ref} = "${step.value}"${label}`
    case 'type':
      return `type ${step.ref} "${step.text}"${label}`
    case 'press':
      return `press ${step.key}${step.ref ? ` on ${step.ref}` : ''}${label}`
    case 'select':
      return `select ${step.ref} = "${step.value}"${label}`
    case 'wait':
      return `wait ${step.ms}ms${label}`
    case 'waitFor':
      return `waitFor ${step.ref} ${step.state}${label}`
    default:
      return `${step.do} ${step.ref}${label}`
  }
}
