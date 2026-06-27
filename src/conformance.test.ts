// Shared manifest conformance vector — run against STUDIO's validator (PLAN Phase 0 "Done").
//
// The SAME vector runs in the core (test/manifest-conformance.test.ts). Studio's validateManifest
// is re-exported straight from @agrune/manifest (no Studio re-implementation), so passing the same
// cases the core passes proves a manifest valid in Studio is byte-identically accepted by the
// runtime — the Phase 0 done-criterion.

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { CONFORMANCE_CASES, runConformance, assertConformance } from '@agrune/manifest'
import { validateManifest } from './validator.js'

describe('manifest conformance vector (Studio validator)', () => {
  it('the full vector passes', () => {
    assert.doesNotThrow(() => assertConformance(validateManifest))
  })

  for (const result of runConformance(validateManifest)) {
    it(`case: ${result.case.name}`, () => {
      assert.equal(result.pass, true, result.detail)
    })
  }

  it('covers every case', () => {
    assert.equal(runConformance(validateManifest).length, CONFORMANCE_CASES.length)
  })
})
