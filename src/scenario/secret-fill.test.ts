import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { validateScenario } from './schema.js'

describe('fill secretRef schema', () => {
  it('accepts a fill with secretRef and no value', () => {
    const r = validateScenario({
      schema: 'agrune.scenario/v1',
      name: 's',
      manifest: { schemaVersion: 3 },
      steps: [{ do: 'fill', ref: 'pwd', secretRef: 'rec1__pwd' }],
    })
    assert.ok(r.ok, r.ok ? '' : JSON.stringify(r.errors))
  })

  it('accepts a fill with value and no secretRef', () => {
    const r = validateScenario({
      schema: 'agrune.scenario/v1',
      name: 's',
      manifest: { schemaVersion: 3 },
      steps: [{ do: 'fill', ref: 'name', value: 'x' }],
    })
    assert.ok(r.ok)
  })

  it('rejects a fill with BOTH value and secretRef', () => {
    const r = validateScenario({
      schema: 'agrune.scenario/v1',
      name: 's',
      manifest: { schemaVersion: 3 },
      steps: [{ do: 'fill', ref: 'pwd', value: 'x', secretRef: 'y' }],
    })
    assert.equal(r.ok, false)
  })

  it('rejects a fill with NEITHER value nor secretRef', () => {
    const r = validateScenario({
      schema: 'agrune.scenario/v1',
      name: 's',
      manifest: { schemaVersion: 3 },
      steps: [{ do: 'fill', ref: 'pwd' }],
    })
    assert.equal(r.ok, false)
  })
})
