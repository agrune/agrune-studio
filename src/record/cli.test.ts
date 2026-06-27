import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseRecordArgs } from './cli.js'

describe('parseRecordArgs', () => {
  it('parses --url and defaults headless to false', () => {
    const a = parseRecordArgs(['--url', 'http://app/'])
    assert.equal(a.url, 'http://app/')
    assert.equal(a.headless, false)
    assert.equal(a.out, undefined)
  })

  it('parses --out and --headless', () => {
    const a = parseRecordArgs(['--url', 'http://app/', '--out', '/tmp/x', '--headless'])
    assert.equal(a.out, '/tmp/x')
    assert.equal(a.headless, true)
  })

  it('throws when --url is missing', () => {
    assert.throws(() => parseRecordArgs([]))
  })
})
