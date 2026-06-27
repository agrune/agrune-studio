// Scenario schema (Q2/Q4/Q5) — pure-data validation, no browser. The §5 security boundary:
// assertions are a CLOSED enum; arbitrary verbs / unknown fields are rejected.

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ASSERTION_KINDS, SCENARIO_SCHEMA_ID, createEmptyScenario, validateScenario } from './schema.js'

describe('validateScenario', () => {
  it('accepts a minimal valid scenario', () => {
    const r = validateScenario({
      schema: SCENARIO_SCHEMA_ID,
      name: 'login',
      manifest: { schemaVersion: 3 },
      steps: [
        { do: 'fill', ref: 'username', value: 'alice' },
        { do: 'click', ref: 'signin' },
        { assert: 'textPresent', value: 'Welcome' },
      ],
    })
    assert.equal(r.ok, true)
  })

  it('rejects an unknown assertion verb (closed enum — §5 security boundary)', () => {
    const r = validateScenario({
      schema: SCENARIO_SCHEMA_ID,
      name: 'x',
      manifest: { schemaVersion: 3 },
      steps: [{ assert: 'evalExpression', value: 'process.exit(1)' }],
    })
    assert.equal(r.ok, false)
  })

  it('rejects an unknown field on a step (strict — no smuggled code)', () => {
    const r = validateScenario({
      schema: SCENARIO_SCHEMA_ID,
      name: 'x',
      manifest: { schemaVersion: 3 },
      steps: [{ do: 'click', ref: 'signin', onClick: 'alert(1)' }],
    })
    assert.equal(r.ok, false)
  })

  it('rejects a wrong manifest schemaVersion (Q5 — can not target an incompatible map)', () => {
    const r = validateScenario({
      schema: SCENARIO_SCHEMA_ID,
      name: 'x',
      manifest: { schemaVersion: 2 },
      steps: [{ assert: 'urlContains', value: '/' }],
    })
    assert.equal(r.ok, false)
  })

  it('rejects the wrong schema id', () => {
    const r = validateScenario({
      schema: 'agrune.scenario/v999',
      name: 'x',
      manifest: { schemaVersion: 3 },
      steps: [{ assert: 'urlContains', value: '/' }],
    })
    assert.equal(r.ok, false)
  })

  it('createEmptyScenario produces a valid skeleton', () => {
    const r = validateScenario(createEmptyScenario('demo'))
    assert.equal(r.ok, true)
  })

  it('exposes the closed assertion vocabulary', () => {
    assert.ok(ASSERTION_KINDS.includes('textPresent'))
    assert.ok(ASSERTION_KINDS.includes('networkStatus'))
    assert.equal(ASSERTION_KINDS.length, 10)
  })
})
