// 트레일 구간 → agrune.scenario/v1. ref-only 순수(인바리언트): unmapped 액션은 스텝이 아니라 갭으로.
// 단언은 닫힌 enum만 추론한다.

import { SCENARIO_SCHEMA_ID, type AssertionStep, type Scenario, type Step } from '../scenario/schema.js'
import type { RawTarget, RecordingSession } from './trail.js'

export interface ExtractGap {
  index: number
  rawTarget?: RawTarget
  reason: string
}

export interface ExtractResult {
  scenario: Scenario
  gaps: ExtractGap[]
}

export interface ExtractOptions {
  /** 포함 시작 인덱스(기본 0). */
  from?: number
  /** 포함 끝 인덱스(기본 마지막). */
  to?: number
  /** 시나리오 이름(기본 'recorded flow'). */
  name?: string
}

export function extractScenario(session: RecordingSession, opts: ExtractOptions = {}): ExtractResult {
  const from = opts.from ?? 0
  const to = opts.to ?? session.entries.length - 1
  const slice = session.entries.filter((e) => e.index >= from && e.index <= to)

  const steps: Step[] = []
  const gaps: ExtractGap[] = []
  let lastActionRef: string | null = null

  for (const e of slice) {
    if (e.kind === 'action' && e.action) {
      if (e.ref) {
        steps.push(toActionStep(e.ref, e.action.do, e.action.value, e.action.secretRef))
        lastActionRef = e.ref
      } else {
        gaps.push({ index: e.index, rawTarget: e.action.rawTarget, reason: 'not declared in manifest' })
      }
    } else if (e.kind === 'nav' && e.navUrl) {
      const path = safePath(e.navUrl)
      if (path) steps.push({ assert: 'urlContains', value: path, label: 'navigated' })
    } else if (e.kind === 'checkpoint' && lastActionRef) {
      steps.push({ assert: 'targetVisible', ref: lastActionRef, label: 'checkpoint' })
    } else if (e.kind === 'bookmark' && e.anomalies && e.anomalies.length > 0) {
      steps.push({ assert: 'noConsoleErrors', label: `should not ${e.anomalies[0]!.kind}` })
    }
  }

  if (steps.length === 0) steps.push({ assert: 'noConsoleErrors' } as AssertionStep)

  const scenario: Scenario = {
    schema: SCENARIO_SCHEMA_ID,
    name: opts.name ?? 'recorded flow',
    manifest: { schemaVersion: 3 },
    url: session.url,
    steps,
  }
  return { scenario, gaps }
}

function toActionStep(ref: string, verb: string, value?: string, secretRef?: string): Step {
  switch (verb) {
    case 'fill':
      return secretRef ? { do: 'fill', ref, secretRef } : { do: 'fill', ref, value: value ?? '' }
    case 'select':
      return { do: 'select', ref, value: value ?? '' }
    case 'check':
      return { do: 'check', ref }
    case 'uncheck':
      return { do: 'uncheck', ref }
    default:
      return { do: 'click', ref }
  }
}

function safePath(url: string): string | null {
  try {
    const u = new URL(url)
    return u.pathname && u.pathname !== '/' ? u.pathname : (u.host || null)
  } catch {
    return null
  }
}
