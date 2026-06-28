import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import { hasSecret, resolveSecret, setSecret } from './secrets.js'

describe('secret vault', () => {
  it('stores and resolves a secret', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'sec-'))
    try {
      await setSecret(dir, 'rec1__pwd', 'hunter2')
      assert.equal(await resolveSecret(dir, 'rec1__pwd'), 'hunter2')
      assert.equal(await hasSecret(dir, 'rec1__pwd'), true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('merges multiple secrets and resolves each', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'sec-'))
    try {
      await setSecret(dir, 'a', '1')
      await setSecret(dir, 'b', '2')
      assert.equal(await resolveSecret(dir, 'a'), '1')
      assert.equal(await resolveSecret(dir, 'b'), '2')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('returns undefined / false for a missing secret', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'sec-'))
    try {
      assert.equal(await resolveSecret(dir, 'nope'), undefined)
      assert.equal(await hasSecret(dir, 'nope'), false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
