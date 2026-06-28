# Recorder Hardening: Secret Vault + Graceful Close — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Stop sensitive field values (passwords, etc.) from leaking into the distributed extracted scenario by storing them in a local write-only secret vault and referencing them by name (`secretRef`); and give the web recorder a graceful stop+persist when the QA window is closed.

**Architecture:** A write-only vault (`src/record/secrets.ts`) keeps secrets on local disk under `web/runs/secrets/`; no API/UI/extract path ever returns a plaintext value (read-back is forbidden), only the deterministic runner resolves a secret at execution to inject it. The scenario `fill` step gains a typed `secretRef` (exactly one of `value`/`secretRef`). The recorder, on a `sensitive` target, stores the value in the vault and writes only `secretRef` to the trail; extraction emits a `secretRef` fill. Separately, the capture controller detects page close and runs the graceful stop, and the server removes the controller from its registry.

**Tech Stack:** TypeScript (NodeNext, ES2022, no DOM lib), pnpm, tsc, `node --test` (src → dist), core `agrune` engine.

## Global Constraints

- Build: `pnpm run build`. Full tests: `pnpm run test`. Single test: `pnpm run build && node --test dist/<path>.test.js`. (Missing module → tsc error = RED; use stub→test→impl order.)
- Studio does NOT import Playwright directly; browser via core `BrowserSession`. Do NOT modify the core `agrune` repo.
- INVARIANTS: (a) extracted scenario stays pure data over manifest refs + closed-enum assertions; `secretRef` is a typed string reference, never a raw selector and never a plaintext secret. (b) Execution stays deterministic; the runner resolves secrets from the local vault — no AI, no network. (c) **Read-back of secrets is forbidden**: no API route, UI, extract, export, list, or log returns a stored secret value. Only `resolveSecret` (runner-internal) reads, to inject.
- No DOM types in Node code; page-side work stays in the inject string or Playwright Locator APIs.
- Secret name convention: `` `${recordingId}__${ref}` `` (stable, collision-free across recordings).
- Commit policy (user rule): per-task commits directly on `main` are APPROVED for this execution; run each task's Commit step. Do NOT push or merge.
- Secrets + recordings live under `web/runs/` (already gitignored).

## File Structure

- `src/record/secrets.ts` (NEW) — write-only vault: `setSecret`/`resolveSecret`/`hasSecret`. (Task 1)
- `src/scenario/schema.ts` (MODIFY) — `FillStep` gains optional `value`+`secretRef` with an exactly-one refinement. (Task 2)
- `src/scenario/runner.ts` (MODIFY) — `RunOptions.secretsDir`; `executeStep`/`performAction` resolve `secretRef`; `summarizeStep` masks secrets. (Task 2)
- `src/record/trail.ts` (MODIFY) — `TimelineEntry.action.secretRef?`. (Task 3)
- `src/record/refmap.ts` (MODIFY) — `RefMatch.sensitive`. (Task 3)
- `src/record/capture.ts` (MODIFY) — sensitive fill → vault store + `secretRef` (no value); `StartOptions.secretsDir?`; page-close graceful stop + `onClosed?`. (Task 3 for secret, Task 4 for close)
- `src/record/extract.ts` (MODIFY) — sensitive fill → `secretRef` step. (Task 3)
- `src/web/server.ts` (MODIFY) — `SECRETS_DIR`; pass `secretsDir` to `startRecording` + `runScenario`; `/api/secret/set` (write-only); remove controller from registry on close. (Task 4)
- Tests: `src/record/secrets.test.ts`, schema+runner secret tests, capture/extract secret tests, a close test.

---

### Task 1: Write-only secret vault

**Files:**
- Create: `src/record/secrets.ts`
- Test: `src/record/secrets.test.ts`

**Interfaces:**
- Produces: `setSecret(dir, name, value): Promise<void>`, `resolveSecret(dir, name): Promise<string | undefined>`, `hasSecret(dir, name): Promise<boolean>`. Stored as `dir/secrets.json` (`{ [name]: value }`). NO function returns the full value map; `hasSecret` returns only a boolean.

- [ ] **Step 1: Stub (compiles)**

Create `src/record/secrets.ts`:

```ts
// Write-only secret vault (local diagnostic infra). setSecret stores a value; resolveSecret is used
// ONLY by the deterministic runner to inject at execution. No code path returns a stored value to an
// API response, UI, extract, export, or log — read-back is forbidden by design. hasSecret returns a
// boolean only (presence, never the value).

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

export async function setSecret(_dir: string, _name: string, _value: string): Promise<void> {
  throw new Error('not implemented')
}

export async function resolveSecret(_dir: string, _name: string): Promise<string | undefined> {
  throw new Error('not implemented')
}

export async function hasSecret(_dir: string, _name: string): Promise<boolean> {
  throw new Error('not implemented')
}
```

- [ ] **Step 2: Failing test**

Create `src/record/secrets.test.ts`:

```ts
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
```

- [ ] **Step 3: Build + run → RED**

Run: `pnpm run build && node --test dist/record/secrets.test.js`
Expected: FAIL ("not implemented").

- [ ] **Step 4: Implement**

Replace the bodies:

```ts
async function load(dir: string): Promise<Record<string, string>> {
  try {
    return JSON.parse(await readFile(path.join(dir, 'secrets.json'), 'utf8')) as Record<string, string>
  } catch {
    return {}
  }
}

export async function setSecret(dir: string, name: string, value: string): Promise<void> {
  await mkdir(dir, { recursive: true })
  const all = await load(dir)
  all[name] = value
  await writeFile(path.join(dir, 'secrets.json'), JSON.stringify(all, null, 2), 'utf8')
}

export async function resolveSecret(dir: string, name: string): Promise<string | undefined> {
  const all = await load(dir)
  return all[name]
}

export async function hasSecret(dir: string, name: string): Promise<boolean> {
  const all = await load(dir)
  return Object.prototype.hasOwnProperty.call(all, name)
}
```

- [ ] **Step 5: Build + run → GREEN**

Run: `pnpm run build && node --test dist/record/secrets.test.js` → PASS (3).

- [ ] **Step 6: Commit (approved)**

```bash
git add src/record/secrets.ts src/record/secrets.test.ts
git commit -m "feat(record): write-only secret vault"
```

---

### Task 2: Scenario `secretRef` on fill + runner resolution

**Files:**
- Modify: `src/scenario/schema.ts` (FillStep)
- Modify: `src/scenario/runner.ts` (RunOptions, executeStep, performAction, summarizeStep)
- Test: `src/scenario/secret-fill.test.ts`

**Interfaces:**
- `FillStep`: `value?: string`, `secretRef?: string`, with a refine requiring EXACTLY ONE of them.
- `RunOptions.secretsDir?: string`.
- `executeStep(session, step, opts?: { secretsDir?: string })` (3rd arg optional — monkey's 2-arg calls keep working).
- Consumes: `resolveSecret` from `../record/secrets.js` (Task 1).

- [ ] **Step 1: Failing test**

Create `src/scenario/secret-fill.test.ts`:

```ts
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
```

- [ ] **Step 2: Build + run → RED**

Run: `pnpm run build && node --test dist/scenario/secret-fill.test.js`
Expected: FAIL — the "both" / "neither" cases currently behave wrong (value is required today), and `secretRef` is an unknown key under `.strict()`.

- [ ] **Step 3: Implement schema** — `src/scenario/schema.ts`

Replace the `FillStep` definition:

```ts
const FillStep = z
  .object({
    do: z.literal('fill'),
    ref: z.string().min(1),
    value: z.string().optional(),
    secretRef: z.string().min(1).optional(),
    clear: z.boolean().optional(),
    ...Label,
  })
  .strict()
  .refine((s) => (s.value === undefined) !== (s.secretRef === undefined), {
    message: 'fill requires exactly one of value or secretRef',
  })
```

- [ ] **Step 4: Implement runner** — `src/scenario/runner.ts`

(a) Add the import (merge into the top imports):

```ts
import { resolveSecret } from '../record/secrets.js'
```

(b) `RunOptions`: add the field:

```ts
  /** Directory of the write-only secret vault; fills with `secretRef` resolve from here. */
  secretsDir?: string
```

(c) `executeStep`: thread options through:

```ts
export async function executeStep(
  session: BrowserSession,
  step: Step,
  opts: { secretsDir?: string } = {},
): Promise<{ changed?: boolean }> {
  if (isAssertionStep(step)) {
    await evaluateAssertion(session, step)
    return {}
  }
  return { changed: await performAction(session, step, opts.secretsDir) }
}
```

(d) In `runScenario`, pass secretsDir at the call site (replace `await executeStep(session, step)`):

```ts
        const out = await executeStep(session, step, { secretsDir: opts.secretsDir })
```

(e) `performAction`: signature + fill case resolve secret:

```ts
async function performAction(session: BrowserSession, step: ActionStep, secretsDir?: string): Promise<boolean | undefined> {
```

Replace the `case 'fill':` block:

```ts
    case 'fill': {
      let value = step.value
      if (step.secretRef !== undefined) {
        if (!secretsDir) throw new StepFailure(`fill "${step.ref}" needs a secret "${step.secretRef}" but no secrets vault is configured`)
        const resolved = await resolveSecret(secretsDir, step.secretRef)
        if (resolved === undefined) throw new StepFailure(`secret not set: "${step.secretRef}"`)
        value = resolved
      }
      const res = await session.fill(undefined, step.ref, value ?? '', step.clear ?? true)
      return res.changed
    }
```

(f) `summarizeStep` fill case — mask secrets (replace the `case 'fill':` in summarizeStep):

```ts
    case 'fill':
      return `fill ${step.ref} = ${step.secretRef ? `<secret ${step.secretRef}>` : `"${step.value}"`}${label}`
```

- [ ] **Step 5: Build + run → GREEN**

Run: `pnpm run build && node --test dist/scenario/secret-fill.test.js` → PASS (4).
Then confirm no regression in the existing runner/monkey tests:
`node --test dist/scenario/runner.test.js dist/monkey/explore.test.js` → all PASS (chromium permitting).

- [ ] **Step 6: Commit (approved)**

```bash
git add src/scenario/schema.ts src/scenario/runner.ts src/scenario/secret-fill.test.ts
git commit -m "feat(scenario): typed secretRef on fill; runner resolves from vault (deterministic)"
```

---

### Task 3: Recorder integration — sensitive fills → vault + secretRef

**Files:**
- Modify: `src/record/trail.ts` (`TimelineEntry.action.secretRef?`)
- Modify: `src/record/refmap.ts` (`RefMatch.sensitive`)
- Modify: `src/record/capture.ts` (`StartOptions.secretsDir?`; sensitive fill → vault + secretRef, no value)
- Modify: `src/record/extract.ts` (sensitive fill → `secretRef` step)
- Test: extend `src/record/extract.test.ts`; extend `src/record/capture.test.ts`

**Interfaces:**
- `TimelineEntry.action`: add `secretRef?: string`.
- `RefMatch`: add `sensitive: boolean`.
- `StartOptions`: add `secretsDir?: string`.
- Secret name: `` `${recording.id}__${ref}` ``.

- [ ] **Step 1: trail type** — `src/record/trail.ts`

Change the `action?` field of `TimelineEntry`:

```ts
  action?: { do: ActionVerb; value?: string; secretRef?: string; rawTarget: RawTarget }
```

- [ ] **Step 2: refmap surfaces sensitive** — `src/record/refmap.ts`

(a) `RefMatch` gains the flag:

```ts
export interface RefMatch {
  ref: string
  targetId: string
  rank: number
  sensitive: boolean
}
```

(b) In `mapHitToRef`, read `t.sensitive` (core `PageTarget.sensitive`) when constructing each match. Replace the two return/assignment sites:

```ts
    if (exact > 0) return { ref, targetId: t.targetId, rank: 0, sensitive: t.sensitive === true }
```

```ts
      if (contains > 0) best = { ref, targetId: t.targetId, rank: 1, sensitive: t.sensitive === true }
```

- [ ] **Step 3: extract emits secretRef** — `src/record/extract.ts`

In the action branch, branch on `secretRef` before building the step. Replace the mapped-action push:

```ts
      if (e.ref) {
        steps.push(toActionStep(e.ref, e.action.do, e.action.value, e.action.secretRef))
        lastActionRef = e.ref
      } else {
```

And extend `toActionStep` to accept + honor `secretRef`:

```ts
function toActionStep(ref: string, verb: string, value?: string, secretRef?: string): Step {
  switch (verb) {
    case 'fill':
      return secretRef ? { do: 'fill', ref, secretRef } : { do: 'fill', ref, value: value ?? '' }
    case 'select':
      return { do: 'select', ref, value: value ?? '' }
    case 'check':
      return { do: 'check', ref }
    case 'uncheck':
      return { do: 'uncheck', ref }
    default:
      return { do: 'click', ref }
  }
}
```

- [ ] **Step 4: extract test for secretRef** — extend `src/record/extract.test.ts`

Add a test (append inside the existing `describe`):

```ts
  it('emits a secretRef fill (no value) for a sensitive-captured action', () => {
    const s = createRecordingSession('rec1', 'http://app/', 0)
    appendEntry(s, { t: 1, kind: 'action', action: { do: 'fill', secretRef: 'rec1__pwd', rawTarget: { tag: 'input' } }, ref: 'pwd', console: [], network: [] })
    const { scenario } = extractScenario(s)
    const fill = scenario.steps.find((st) => 'do' in st && st.do === 'fill') as Record<string, unknown>
    assert.equal(fill.secretRef, 'rec1__pwd')
    assert.equal(fill.value, undefined)
    assert.ok(!JSON.stringify(scenario).includes('hunter2')) // no plaintext anywhere
    assert.ok(validateScenario(scenario).ok)
  })
```

- [ ] **Step 5: capture stores sensitive value in vault** — `src/record/capture.ts`

(a) `StartOptions`: add the field:

```ts
  /** Directory of the write-only secret vault; sensitive fills store their value here. */
  secretsDir?: string
```

(b) Add the import (merge with existing record imports):

```ts
import { setSecret } from './secrets.js'
```

(c) In `handleAction`, after computing `match`, special-case a sensitive fill. Replace the entry-append block so that a sensitive fill stores the value in the vault and records only `secretRef`:

```ts
  async function handleAction(p: { do: ActionVerb; value?: string; nonce: string; rawTarget: RawTarget; t: number }): Promise<void> {
    const match = await mapHitToRef(browser, p.nonce).catch(() => null)
    const screenshot = await shot()
    const { console: c, network: n } = deltas()

    let value = p.value
    let secretRef: string | undefined
    if (match?.sensitive && p.do === 'fill') {
      secretRef = `${recording.id}__${match.ref}`
      if (opts.secretsDir && p.value !== undefined) await setSecret(opts.secretsDir, secretRef, p.value).catch(() => undefined)
      value = undefined // never store the plaintext in the trail
    }

    const entry = appendEntry(recording, {
      t: p.t,
      kind: 'action',
      action: { do: p.do, value, secretRef, rawTarget: p.rawTarget },
      ref: match?.ref ?? null,
      refMeta: match ? { rank: match.rank } : undefined,
      console: c,
      network: n,
      screenshot,
    })
    const crashed = browser.page().isClosed?.() ? 'page closed' : undefined
    const hits = pollOracle(browser, tracker, crashed)
    if (hits.length > 0) {
      entry.anomalies = hits
      recording.bookmarks.push(entry.index)
    }
  }
```

- [ ] **Step 6: capture test for sensitive fill** — extend `src/record/capture.test.ts`

In the test's local `manifest`, add a sensitive password target and an input in the page HTML. Add to the manifest `targets` array:

```ts
        { targetId: 'pwd', name: 'Password', sensitive: true, actionKinds: ['fill'], selector: { css: '#pwd' } },
```

Add to `pageHtml`'s body (before the `<script>`):

```ts
<input id="pwd" type="password" />
```

Add a new `it` (real chromium) inside the describe — pass a `secretsDir`, type into the sensitive field, assert the trail records `secretRef` and NO value, and the vault holds the value:

```ts
  it('routes a sensitive field value into the vault, not the trail', async (t) => {
    if (!available) return t.skip('chromium unavailable')
    const app = await serve()
    const dir = await mkdtemp(path.join(tmpdir(), 'rec-'))
    const secdir = await mkdtemp(path.join(tmpdir(), 'sec-'))
    const ctrl = await startRecording({ url: app.url, artifactsDir: dir, secretsDir: secdir, headless: true })
    try {
      await ctrl.browser.page().locator('#pwd').fill('hunter2')
      await ctrl.browser.page().locator('#pwd').blur() // fire change
      await waitFor(() => ctrl.recording.entries.some((e) => e.action?.do === 'fill' && e.ref === 'pwd'))
      const entry = ctrl.recording.entries.find((e) => e.ref === 'pwd')!
      assert.equal(entry.action!.value, undefined, 'plaintext must not be in the trail')
      assert.equal(entry.action!.secretRef, 'rec1__pwd'.replace('rec1', ctrl.recording.id))
      const { resolveSecret } = await import('./secrets.js')
      assert.equal(await resolveSecret(secdir, entry.action!.secretRef!), 'hunter2')
    } finally {
      await ctrl.stop().catch(() => undefined)
      await rm(dir, { recursive: true, force: true })
      await rm(secdir, { recursive: true, force: true })
      await app.close()
    }
  })
```

> Note: `mkdtemp`/`rm`/`tmpdir` are already imported in capture.test.ts from Task 6; reuse them. If `blur()` does not reliably fire `change` in headless, use `ctrl.browser.page().locator('#pwd').press('Tab')` instead.

- [ ] **Step 7: Build + run → GREEN**

Run: `pnpm run build && node --test dist/record/extract.test.js dist/record/capture.test.js`
Expected: PASS (extract +1, capture +1; chromium permitting).

- [ ] **Step 8: Commit (approved)**

```bash
git add src/record/trail.ts src/record/refmap.ts src/record/extract.ts src/record/capture.ts src/record/extract.test.ts src/record/capture.test.ts
git commit -m "feat(record): route sensitive fills to the vault; extract emits secretRef"
```

---

### Task 4: Server wiring + graceful close

**Files:**
- Modify: `src/record/capture.ts` (`StartOptions.onClosed?`; page-close → graceful stop)
- Modify: `src/web/server.ts` (`SECRETS_DIR`; pass `secretsDir` to start + scenario run; `/api/secret/set`; registry cleanup on close)
- Test: `src/web/record-close.test.ts`

**Interfaces:**
- `StartOptions.onClosed?: () => void` — invoked after an auto-stop triggered by the page/window closing.
- Server: `SECRETS_DIR = join(RUNS_DIR, 'secrets')`; `/api/secret/set {name, value}` → `{ ok: true }` (NEVER returns the value); `/api/record/start` passes `secretsDir` + `onClosed`; `/api/scenario/run` passes `secretsDir`.

- [ ] **Step 1: capture graceful close** — `src/record/capture.ts`

(a) `StartOptions`: add:

```ts
  /** Called after an auto-stop triggered by the QA window/page closing. */
  onClosed?: () => void
```

(b) Refactor `stop()` so the same logic is reachable from a close handler. Where the controller object is returned, define a shared `doStop` and use it for both `stop` and the close handler. Replace the returned object's `stop` and add the close wiring just before `return`:

```ts
  let closedHandled = false
  const doStop = async (): Promise<RecordingSession> => {
    if (stopping) {
      await queue
      return recording
    }
    stopping = true
    await queue
    await writeTrail(opts.artifactsDir, recording)
    await browser.stop().catch(() => undefined)
    return recording
  }

  // QA mode = window lifetime: if the user closes the page/window, persist + clean up gracefully.
  browser.page().on('close', () => {
    if (closedHandled) return
    closedHandled = true
    void doStop().then(() => opts.onClosed?.())
  })

  return {
    id,
    url: opts.url,
    recording,
    browser,
    bug: (note?: string) => enqueue(() => addBookmark('bookmark', elapsed(), note)),
    checkpoint: () => enqueue(() => addBookmark('checkpoint', elapsed())),
    stop: doStop,
  }
```

> Remove the previous inline `async stop()` definition (its body now lives in `doStop`). Keep the `stopping` flag declared earlier in the closure. `browser.page()` returns the Playwright `Page`; `.on('close', …)` fires when the tab/window closes.

- [ ] **Step 2: failing close test** — `src/web/record-close.test.ts`

```ts
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import { before, describe, it } from 'node:test'
import { BrowserSession } from 'agrune'
import { startRecording } from '../record/capture.js'

const manifest = { version: 3, groups: [{ groupId: 'app', targets: [{ targetId: 'go', actionKinds: ['click'], selector: { css: '#go' } }] }] }
function pageHtml(): string {
  return `<!doctype html><html><head><title>Close</title></head><body><button id="go">Go</button>
<script>window.__agrune_manifest__ = ${JSON.stringify(manifest)};</script></body></html>`
}
async function serve() {
  const server = http.createServer((_q, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(pageHtml()) })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const { port } = server.address() as AddressInfo
  return { url: `http://127.0.0.1:${port}/`, close: () => new Promise<void>((r) => server.close(() => r())) }
}
async function waitFor(pred: () => boolean | Promise<boolean>, ms = 5000) {
  const t0 = Date.now()
  while (!(await pred())) { if (Date.now() - t0 > ms) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 50)) }
}

let available = true
describe('graceful close (real chromium)', () => {
  before(async () => { const p = new BrowserSession(true); try { await p.start(); await p.stop() } catch { available = false } })

  it('closing the page persists the trail and fires onClosed', async (t) => {
    if (!available) return t.skip('chromium unavailable')
    const app = await serve()
    const dir = await mkdtemp(path.join(tmpdir(), 'rec-'))
    let closed = false
    const ctrl = await startRecording({ url: app.url, artifactsDir: dir, headless: true, onClosed: () => { closed = true } })
    try {
      await ctrl.browser.page().close() // simulate the user closing the QA window
      await waitFor(() => closed)
      const raw = await readFile(path.join(dir, 'trail.json'), 'utf8') // trail persisted on close
      assert.ok(JSON.parse(raw).version === 1)
    } finally {
      await ctrl.stop().catch(() => undefined)
      await rm(dir, { recursive: true, force: true })
      await app.close()
    }
  })
})
```

- [ ] **Step 3: Build + run → RED**

Run: `pnpm run build && node --test dist/web/record-close.test.js`
Expected: FAIL until the close handler is wired (Step 1). If Step 1 is already done, this is GREEN — that's fine for this lifecycle task.

- [ ] **Step 4: server wiring** — `src/web/server.ts`

(a) Imports — add `setSecret` (merge into a record import group):

```ts
import { setSecret } from '../record/secrets.js'
```

(b) Below `RECORDINGS_DIR`:

```ts
const SECRETS_DIR = join(RUNS_DIR, 'secrets')
```

(c) In `startServer`, after the `mkdir(RECORDINGS_DIR…)` line:

```ts
  await mkdir(SECRETS_DIR, { recursive: true })
```

(d) `/api/record/start` — pass secretsDir + onClosed (replace the `startRecording({...})` call):

```ts
        const id = nextRunId()
        const controller = await startRecording({
          url: String(body.url ?? ''),
          artifactsDir: join(RECORDINGS_DIR, id),
          secretsDir: SECRETS_DIR,
          onClosed: () => recorders.delete(id),
          ...(body.headless === true ? { headless: true } : {}),
        })
        recorders.set(id, controller)
        return { status: 200, body: { id, url: controller.url } }
```

(e) `/api/scenario/run` — pass secretsDir so extracted scenarios resolve secrets (add to the existing `runScenario` opts object):

```ts
          secretsDir: SECRETS_DIR,
```

(f) Add a write-only secret-set route (before `default:`):

```ts
      case '/api/secret/set': {
        const name = String(body.name ?? '')
        const value = String(body.value ?? '')
        if (!name) return { status: 400, body: { error: 'missing name' } }
        await setSecret(SECRETS_DIR, name, value)
        return { status: 200, body: { ok: true } } // never echo the value back
      }
```

- [ ] **Step 5: Build + full suite → GREEN**

Run: `pnpm run build && node --test dist/web/record-close.test.js` → PASS (1).
Then `pnpm run test` → whole suite green (no regression).

- [ ] **Step 6: Commit (approved)**

```bash
git add src/record/capture.ts src/web/server.ts src/web/record-close.test.ts
git commit -m "feat(record): graceful stop on window close; wire secrets vault into server"
```

---

## Self-Review

**Spec coverage:** Final-review Important #1 (sensitive leak) → Tasks 1–3 (vault + secretRef + recorder routing; extract emits secretRef, plaintext never in trail or scenario). Important #2 (window close) → Task 4 (page-close graceful stop + registry cleanup). Read-back-forbidden invariant: no route/UI/extract returns a value; `/api/secret/set` echoes only `{ok}`; `summarizeStep` masks secrets; only `resolveSecret` (runner) reads.

**Placeholder scan:** none — every step has concrete code/commands.

**Type consistency:** `secretRef` is consistent across `FillStep` (schema), `TimelineEntry.action` (trail), `toActionStep`/extract, capture, and runner resolution. `RefMatch.sensitive` (refmap) → capture `match.sensitive`. `StartOptions.secretsDir`/`onClosed` (capture) → server start call. `RunOptions.secretsDir` (runner) → server scenario-run + recorder-extracted scenarios. Secret name `${id}__${ref}` is produced in capture and consumed (by name) wherever the scenario runs.
