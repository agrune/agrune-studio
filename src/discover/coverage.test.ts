// Coverage model (Phase 5) — pure, no browser.

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { AgruneManifest } from 'agrune'
import { actionableTargetIds, computeCoverage, refsInScenario } from './coverage.js'
import { SCENARIO_SCHEMA_ID, type Scenario } from '../scenario/schema.js'

const manifest: AgruneManifest = {
  version: 3,
  groups: [
    {
      groupId: 'login',
      targets: [
        { targetId: 'user', actionKinds: ['fill'], selector: { css: '#user' } },
        { targetId: 'signin', actionKinds: ['click'], selector: { css: '#signin' } },
      ],
    },
    {
      groupId: 'search',
      targets: [
        { targetId: 'query', actionKinds: ['fill'], selector: { css: '#q' } },
        { targetId: 'go', actionKinds: ['click'], selector: { css: '#go' } },
      ],
    },
  ],
}

function scenario(refs: string[]): Scenario {
  return {
    schema: SCENARIO_SCHEMA_ID,
    name: 'x',
    manifest: { schemaVersion: 3 },
    steps: refs.map((ref) => ({ do: 'click', ref })),
  }
}

describe('coverage', () => {
  it('lists all actionable declared targets', () => {
    assert.deepEqual(actionableTargetIds(manifest).sort(), ['go', 'query', 'signin', 'user'])
  })

  it('extracts base refs from a scenario (including repeat keys)', () => {
    const s = scenario(['user', 'signin'])
    s.steps.push({ do: 'click', ref: 'items[key=a1].toggle' })
    assert.deepEqual(refsInScenario(s).sort(), ['signin', 'toggle', 'user'])
  })

  it('computes covered / uncovered against the suite', () => {
    const cov = computeCoverage(manifest, [scenario(['user', 'signin'])])
    assert.deepEqual(cov.covered.sort(), ['signin', 'user'])
    assert.deepEqual(cov.uncovered.sort(), ['go', 'query'])
    assert.equal(cov.ratio, 0.5)
  })

  it('full coverage → ratio 1', () => {
    const cov = computeCoverage(manifest, [scenario(['user', 'signin', 'query', 'go'])])
    assert.equal(cov.ratio, 1)
    assert.deepEqual(cov.uncovered, [])
  })
})
