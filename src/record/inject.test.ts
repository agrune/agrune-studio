import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { BINDING, CAPTURE_SCRIPT, OVERLAY_ID } from './inject.js'
import { HIT_ATTR } from './refmap.js'

describe('inject capture script', () => {
  it('exports stable binding + overlay constants', () => {
    assert.equal(BINDING, '__agruneRecord')
    assert.equal(OVERLAY_ID, '__agrune_rec_overlay')
  })

  it('references the binding, hit attr, and the manual buttons', () => {
    assert.ok(CAPTURE_SCRIPT.includes(BINDING))
    assert.ok(CAPTURE_SCRIPT.includes(HIT_ATTR))
    assert.ok(CAPTURE_SCRIPT.includes("type: 'bug'"))
    assert.ok(CAPTURE_SCRIPT.includes("type: 'checkpoint'"))
    assert.ok(CAPTURE_SCRIPT.includes("addEventListener('click'"))
    assert.ok(CAPTURE_SCRIPT.includes('__agruneRecInjected')) // double-injection guard
  })
})
