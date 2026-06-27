import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { detectHits, newTracker } from './oracle.js'

describe('oracle.detectHits', () => {
  it('emits nothing when counts are unchanged', () => {
    const tr = newTracker()
    assert.deepEqual(detectHits(0, 0, tr), [])
  })

  it('emits a console-error hit when error count rises, and advances the tracker', () => {
    const tr = newTracker()
    const hits = detectHits(2, 0, tr)
    assert.equal(hits.length, 1)
    assert.equal(hits[0]!.kind, 'console-error')
    assert.equal(tr.errors, 2)
    // second poll at the same total → no new hit
    assert.deepEqual(detectHits(2, 0, tr), [])
  })

  it('emits a network-failure hit when failure count rises', () => {
    const tr = newTracker()
    const hits = detectHits(0, 1, tr)
    assert.equal(hits.length, 1)
    assert.equal(hits[0]!.kind, 'network-failure')
    assert.equal(tr.failures, 1)
  })

  it('emits page-crash when crashed is set', () => {
    const tr = newTracker()
    const hits = detectHits(0, 0, tr, 'page closed')
    assert.equal(hits.length, 1)
    assert.equal(hits[0]!.kind, 'page-crash')
    assert.equal(hits[0]!.detail, 'page closed')
  })
})
