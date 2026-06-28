import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { validateScenario } from '../scenario/schema.js'
import { appendEntry, createRecordingSession } from './trail.js'
import { extractScenario } from './extract.js'

function fixture() {
  const s = createRecordingSession('rec1', 'http://app/', 0)
  appendEntry(s, { t: 1, kind: 'action', action: { do: 'click', rawTarget: { tag: 'button' } }, ref: 'boom', console: [], network: [] })
  appendEntry(s, { t: 2, kind: 'action', action: { do: 'fill', value: 'hi', rawTarget: { tag: 'input' } }, ref: 'note', console: [], network: [] })
  // unmapped action → must NOT become a step; becomes a gap
  appendEntry(s, { t: 3, kind: 'action', action: { do: 'click', rawTarget: { tag: 'div', css: '#x' } }, ref: null, console: [], network: [] })
  // checkpoint → targetVisible of the preceding mapped action's ref (note)
  appendEntry(s, { t: 4, kind: 'checkpoint', ref: null, console: [], network: [] })
  // nav → urlContains
  appendEntry(s, { t: 5, kind: 'nav', navUrl: 'http://app/board', ref: null, console: [], network: [] })
  // anomaly bookmark → noConsoleErrors
  const bm = appendEntry(s, { t: 6, kind: 'bookmark', ref: null, console: [], network: [], anomalies: [{ kind: 'console-error', detail: 'boom' }] })
  s.bookmarks.push(bm.index)
  return s
}

describe('extractScenario', () => {
  it('produces a valid ref-only scenario and flags unmapped actions as gaps', () => {
    const { scenario, gaps } = extractScenario(fixture(), { name: 'demo' })

    // valid against the closed schema
    const v = validateScenario(scenario)
    assert.ok(v.ok, 'extracted scenario must validate: ' + (v.ok ? '' : JSON.stringify(v.errors)))

    // mapped actions became ref steps; unmapped did NOT
    const actionSteps = scenario.steps.filter((s) => 'do' in s)
    assert.deepEqual(actionSteps.map((s) => (s as { ref?: string }).ref), ['boom', 'note'])

    // no raw selectors leaked into any step
    assert.ok(!JSON.stringify(scenario).includes('#x'), 'raw selector must not appear in the scenario')

    // inferred assertions
    const asserts = scenario.steps.filter((s) => 'assert' in s) as Array<Record<string, unknown>>
    assert.ok(asserts.some((a) => a.assert === 'targetVisible' && a.ref === 'note'), 'checkpoint → targetVisible note')
    assert.ok(asserts.some((a) => a.assert === 'urlContains'), 'nav → urlContains')
    assert.ok(asserts.some((a) => a.assert === 'noConsoleErrors'), 'anomaly → noConsoleErrors')

    // gap for the unmapped click
    assert.equal(gaps.length, 1)
    assert.equal(gaps[0]!.index, 2)
  })

  it('respects from/to slicing', () => {
    const { scenario } = extractScenario(fixture(), { from: 1, to: 1 })
    const actionSteps = scenario.steps.filter((s) => 'do' in s)
    assert.deepEqual(actionSteps.map((s) => (s as { ref?: string }).ref), ['note'])
  })

  it('always yields at least one step', () => {
    const s = createRecordingSession('rec1', 'http://app/', 0)
    appendEntry(s, { t: 1, kind: 'action', action: { do: 'click', rawTarget: { tag: 'div' } }, ref: null, console: [], network: [] })
    const { scenario } = extractScenario(s)
    assert.ok(scenario.steps.length >= 1)
    assert.ok(validateScenario(scenario).ok)
  })

  it('emits a secretRef fill (no value) for a sensitive-captured action', () => {
    const s = createRecordingSession('rec1', 'http://app/', 0)
    appendEntry(s, { t: 1, kind: 'action', action: { do: 'fill', secretRef: 'rec1__pwd', rawTarget: { tag: 'input' } }, ref: 'pwd', console: [], network: [] })
    const { scenario } = extractScenario(s)
    const fill = scenario.steps.find((st) => 'do' in st && st.do === 'fill') as Record<string, unknown>
    assert.equal(fill.secretRef, 'rec1__pwd')
    assert.equal(fill.value, undefined)
    assert.ok(!JSON.stringify(scenario).includes('hunter2')) // no plaintext anywhere
    assert.ok(validateScenario(scenario).ok)
  })
})
