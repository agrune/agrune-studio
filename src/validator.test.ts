import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { validateManifest } from './validator.js'

describe('validateManifest', () => {
  it('accepts a minimal valid manifest', () => {
    const result = validateManifest({
      version: 3,
      groups: [
        {
          groupId: 'page',
          targets: [
            {
              targetId: 'signin',
              actionKinds: ['click'],
              selector: { role: { name: 'button' }, text: 'Sign in' },
            },
          ],
        },
      ],
    })

    assert.equal(result.ok, true)
  })

  it('rejects targets without selectors', () => {
    const result = validateManifest({
      version: 3,
      groups: [{ groupId: 'page', targets: [{ targetId: 'empty', actionKinds: ['click'], selector: {} }] }],
    })

    assert.equal(result.ok, false)
    if (!result.ok) {
      assert.match(result.errors[0].message, /at least one/)
    }
  })

  it('rejects sensitive false', () => {
    const result = validateManifest({
      version: 3,
      groups: [
        {
          groupId: 'login',
          targets: [
            {
              targetId: 'password',
              actionKinds: ['fill'],
              selector: { css: 'input[type="password"]' },
              sensitive: false,
            },
          ],
        },
      ],
    })

    assert.equal(result.ok, false)
    if (!result.ok) {
      assert.match(result.errors.map((error) => error.message).join('\n'), /sensitive:false/)
    }
  })

  it('rejects hash classes and nth-child selectors', () => {
    const result = validateManifest({
      version: 3,
      groups: [
        {
          groupId: 'page',
          targets: [
            { targetId: 'hashy', actionKinds: ['click'], selector: { css: '.a1b2c3d4' } },
            { targetId: 'positional', actionKinds: ['click'], selector: { attr: 'ul > li:nth-child(2)' } },
          ],
        },
      ],
    })

    assert.equal(result.ok, false)
    if (!result.ok) {
      const messages = result.errors.map((error) => error.message).join('\n')
      assert.match(messages, /hash class/)
      assert.match(messages, /:nth-child/)
    }
  })
})
