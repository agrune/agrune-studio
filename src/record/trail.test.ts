import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import { appendEntry, createRecordingSession, readTrail, writeTrail } from './trail.js'

describe('trail', () => {
  it('creates a versioned session', () => {
    const s = createRecordingSession('rec1', 'http://x/', 1000)
    assert.equal(s.version, 1)
    assert.equal(s.id, 'rec1')
    assert.equal(s.url, 'http://x/')
    assert.deepEqual(s.entries, [])
    assert.deepEqual(s.bookmarks, [])
    assert.equal(s.manifest.schemaVersion, 3)
  })

  it('appends entries with monotonic index', () => {
    const s = createRecordingSession('rec1', 'http://x/', 1000)
    const a = appendEntry(s, { t: 5, kind: 'action', ref: 'boom', console: [], network: [] })
    const b = appendEntry(s, { t: 9, kind: 'nav', navUrl: 'http://x/p', ref: null, console: [], network: [] })
    assert.equal(a.index, 0)
    assert.equal(b.index, 1)
    assert.equal(s.entries.length, 2)
  })

  it('round-trips to disk as trail.json', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'trail-'))
    try {
      const s = createRecordingSession('rec1', 'http://x/', 1000)
      appendEntry(s, { t: 5, kind: 'action', ref: 'boom', console: [], network: [] })
      const file = await writeTrail(dir, s)
      assert.ok(file.endsWith('trail.json'))
      const back = await readTrail(dir)
      assert.deepEqual(back, s)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
