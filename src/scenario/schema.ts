// Scenario format (Q2 typed step list · Q4 declarative assertion enum · Q5 manifest version pin).
//
// A scenario is PURE DATA (SPEC §5): an ordered list of steps over manifest refs plus declarative
// assertions. There is NO arbitrary code anywhere — actions name a manifest target, assertions are a
// CLOSED enum with typed params. That is the load-bearing security property: a signed scenario is
// safe to distribute because the signature alone makes it inert data, never a `keyFrom`-class RCE.

import { z } from 'zod'

export const SCENARIO_SCHEMA_ID = 'agrune.scenario/v1'

const Label = { label: z.string().optional() }

// ---- action steps (drive the engine over manifest refs) --------------------
// `ref` is a manifest targetId, optionally a repeat key form: `repeatId[key=K].baseTargetId`.

const NavigateStep = z.object({ do: z.literal('navigate'), url: z.string().min(1), ...Label }).strict()
const ClickStep = z
  .object({ do: z.enum(['click', 'dblclick', 'contextmenu', 'hover', 'longpress']), ref: z.string().min(1), ...Label })
  .strict()
const FillStep = z
  .object({
    do: z.literal('fill'),
    ref: z.string().min(1),
    value: z.string().optional(),
    secretRef: z.string().min(1).optional(),
    clear: z.boolean().optional(),
    ...Label,
  })
  .strict()
  .refine((s) => (s.value === undefined) !== (s.secretRef === undefined), {
    message: 'fill requires exactly one of value or secretRef',
  })
const TypeStep = z
  .object({ do: z.literal('type'), ref: z.string().min(1), text: z.string(), submit: z.boolean().optional(), ...Label })
  .strict()
const PressStep = z.object({ do: z.literal('press'), key: z.string().min(1), ref: z.string().optional(), ...Label }).strict()
const SelectStep = z.object({ do: z.literal('select'), ref: z.string().min(1), value: z.string(), ...Label }).strict()
const CheckStep = z.object({ do: z.enum(['check', 'uncheck']), ref: z.string().min(1), ...Label }).strict()
const WaitStep = z.object({ do: z.literal('wait'), ms: z.number().int().positive().max(30_000), ...Label }).strict()
const WaitForStep = z
  .object({
    do: z.literal('waitFor'),
    ref: z.string().min(1),
    state: z.enum(['visible', 'hidden']),
    timeoutMs: z.number().int().positive().max(30_000).optional(),
    ...Label,
  })
  .strict()

export const ActionStepSchema = z.union([
  NavigateStep,
  ClickStep,
  FillStep,
  TypeStep,
  PressStep,
  SelectStep,
  CheckStep,
  WaitStep,
  WaitForStep,
])
export type ActionStep = z.infer<typeof ActionStepSchema>

// ---- assertion steps (CLOSED declarative enum — the §5 security boundary) ---

const UrlContains = z.object({ assert: z.literal('urlContains'), value: z.string().min(1), ...Label }).strict()
const UrlEquals = z.object({ assert: z.literal('urlEquals'), value: z.string().min(1), ...Label }).strict()
const TitleContains = z.object({ assert: z.literal('titleContains'), value: z.string().min(1), ...Label }).strict()
const TextPresent = z.object({ assert: z.literal('textPresent'), value: z.string().min(1), ...Label }).strict()
const TextAbsent = z.object({ assert: z.literal('textAbsent'), value: z.string().min(1), ...Label }).strict()
const TargetVisible = z.object({ assert: z.literal('targetVisible'), ref: z.string().min(1), ...Label }).strict()
const TargetHidden = z.object({ assert: z.literal('targetHidden'), ref: z.string().min(1), ...Label }).strict()
const TargetCount = z
  .object({ assert: z.literal('targetCount'), repeat: z.string().min(1), count: z.number().int().nonnegative(), ...Label })
  .strict()
const NoConsoleErrors = z.object({ assert: z.literal('noConsoleErrors'), ...Label }).strict()
const NetworkStatus = z
  .object({ assert: z.literal('networkStatus'), urlContains: z.string().min(1), status: z.number().int(), ...Label })
  .strict()

export const AssertionStepSchema = z.union([
  UrlContains,
  UrlEquals,
  TitleContains,
  TextPresent,
  TextAbsent,
  TargetVisible,
  TargetHidden,
  TargetCount,
  NoConsoleErrors,
  NetworkStatus,
])
export type AssertionStep = z.infer<typeof AssertionStepSchema>

/** The closed set of assertion verbs — the distributable security vocabulary (Q4). */
export const ASSERTION_KINDS = [
  'urlContains',
  'urlEquals',
  'titleContains',
  'textPresent',
  'textAbsent',
  'targetVisible',
  'targetHidden',
  'targetCount',
  'noConsoleErrors',
  'networkStatus',
] as const

export const StepSchema = z.union([ActionStepSchema, AssertionStepSchema])
export type Step = z.infer<typeof StepSchema>

export function isAssertionStep(step: Step): step is AssertionStep {
  return 'assert' in step
}

// ---- the scenario document -------------------------------------------------

export const ScenarioSchema = z
  .object({
    schema: z.literal(SCENARIO_SCHEMA_ID),
    name: z.string().min(1),
    description: z.string().optional(),
    // Q5: the manifest this scenario stands on. A consumed scenario can't run against an
    // incompatible map — schemaVersion must match the engine, origin/appVersion pin provenance.
    manifest: z
      .object({
        schemaVersion: z.literal(3),
        origin: z.string().optional(),
        appVersion: z.string().optional(),
      })
      .strict(),
    url: z.string().optional(),
    steps: z.array(StepSchema).min(1),
  })
  .strict()
export type Scenario = z.infer<typeof ScenarioSchema>

export interface ScenarioValidateOk {
  ok: true
  scenario: Scenario
}
export interface ScenarioValidateFail {
  ok: false
  errors: Array<{ path: string; message: string }>
}
export type ScenarioValidateResult = ScenarioValidateOk | ScenarioValidateFail

/** Validate a scenario document (shape + closed enums). Pure-data gate, mirrors validateManifest. */
export function validateScenario(input: unknown): ScenarioValidateResult {
  const parsed = ScenarioSchema.safeParse(input)
  if (parsed.success) return { ok: true, scenario: parsed.data }
  return {
    ok: false,
    errors: parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
  }
}

/** A blank scenario skeleton for `scenario new`. */
export function createEmptyScenario(name: string): Scenario {
  return {
    schema: SCENARIO_SCHEMA_ID,
    name,
    manifest: { schemaVersion: 3 },
    steps: [
      { do: 'navigate', url: 'https://example.test/app', label: 'open the app' },
      { assert: 'titleContains', value: 'App', label: 'sanity check' },
    ],
  }
}
