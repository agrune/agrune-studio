# Flight Recorder (블랙박스) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** QA 모드를 켠 동안 Studio가 띄운 브라우저 창의 모든 행동·콘솔·네트워크·스크린샷을 타임라인 블랙박스로 캡처하고, 버그 순간을 북마크해 0초 재현하며, 그 트레일을 매니페스트 ref 기반 결정론적 회귀 시나리오로 추출한다.

**Architecture:** 기존 Studio 웹 서버에 `record` 서브시스템을 추가한다. 코어 `BrowserSession(headless=false)`를 띄우고 `context.addInitScript`+`context.exposeBinding`으로 인페이지 캡처 스크립트를 주입한다. 유저 클릭/입력은 page→binding→Node로 흘러 역매핑(코어 `resolveTargetLocator` 조합)·스크린샷·콘솔/네트워크 델타를 거쳐 타임라인에 쌓인다. 추출 단계가 트레일을 `agrune.scenario/v1`로 변환해 기존 Scenarios/Repair로 연결한다.

**Tech Stack:** TypeScript (NodeNext, ES2022, no DOM lib), pnpm, tsc 빌드, `node --test` (테스트는 `src/**/*.test.ts` → `dist/**/*.test.js`로 컴파일 후 실행), 코어 `agrune` 패키지(Playwright 엔진), 바닐라 JS 대시보드(`web/`).

## Global Constraints

- 빌드: `pnpm run build` (코어 빌드 + `tsc -p tsconfig.json`). 전체 테스트: `pnpm run test`.
- 단일 테스트 실행: 먼저 `pnpm run build`, 그다음 `node --test dist/record/<name>.test.js`. (테스트는 컴파일된 dist에서 돈다. 모듈이 없으면 tsc 컴파일 에러가 곧 RED다 — 그래서 각 태스크는 ① 시그니처 스텁(컴파일됨) → ② 실패 테스트 → ③ 구현 순서를 쓴다.)
- 의존성: Studio는 `agrune`(코어)를 `link:` 프로토콜로만 의존한다. **Playwright를 직접 의존하지 않는다** — 브라우저 구동은 전부 코어 `BrowserSession`을 통한다.
- 인바리언트(SPEC §1/§5): (a) 매니페스트 진실/셀렉터 정책은 코어 소유 — 역매핑은 코어 `resolveTargetLocator`/`findTargetLocator`/snapshot **조합만**, 셀렉터 로직 복제·코어 수정 금지. (b) AI는 실행에 안 들어감 — recorder는 순수 캡처, 재생은 결정론적. (c) 배포 아티팩트(추출 시나리오)는 순수 데이터 — 추출은 **ref-only**, unmapped 액션은 갭으로 표시하고 raw 셀렉터 스텝을 **절대 만들지 않는다**. (d) 단언은 닫힌 enum만.
- DOM 타입 사용 금지: Studio는 DOM lib이 없다. Node 측 코드에서 `document`/`HTMLElement` 등을 쓰지 말 것. 페이지 안 동작이 필요하면 ① 인페이지 캡처 스크립트(문자열)에서 처리하거나 ② Playwright Locator API(`.and()`/`.count()`/`.locator()`)로 처리한다.
- 결정론: `Math.random()` 금지(코어 규칙과 일관). nonce는 인페이지 단조 카운터로 만든다.
- 프라이버시: 캡처는 QA 모드(= 띄운 창의 수명) 동안에만. 상시 백그라운드 감시 없음. 창에 REC 오버레이로 가시화.
- 온디스크 포맷: `RecordingSession.version: 1` 고정. 추출물은 기존 `agrune.scenario/v1`.
- **커밋 게이팅(사용자 규칙):** "커밋은 내가 명시할 때만." 각 태스크의 Commit 스텝은 **사용자가 명시적으로 승인한 뒤에만** 실행한다. 승인 전에는 변경을 쌓아두고 보고한다.
- 저장 위치: 녹화 산출물은 `web/runs/recordings/<id>/`(기존 `.gitignore`의 `web/runs/`가 커버).

## File Structure

- `src/record/trail.ts` — RecordingSession/TimelineEntry 타입 + 영속화(writeTrail/readTrail) + 생성 헬퍼. (Task 1)
- `src/record/oracle.ts` — anomaly 감지(콘솔에러/네트워크실패/크래시). 순수 판정 함수 + 세션 폴 래퍼. (Task 2)
- `src/record/refmap.ts` — 역매핑(nonce 요소 → 매니페스트 ref), 코어 resolveTargetLocator + Locator.and/.count 조합. (Task 3)
- `src/record/inject.ts` — 인페이지 캡처 스크립트(문자열) + REC 오버레이 + 상수(BINDING 이름, HIT 속성). (Task 4)
- `src/record/extract.ts` — 트레일 구간 → `agrune.scenario/v1` 시나리오 + unmapped 갭 목록 + 단언 추론. (Task 5)
- `src/record/capture.ts` — RecordController: 헤디드 세션 기동·계기화·이벤트 인테이크·타임라인 조립·정지/영속화. (Task 6)
- `src/record/cli.ts` (+ `src/cli.ts` 수정) — `agrune-studio record --url ...`. (Task 7)
- `src/web/server.ts` 수정 — `/api/record/*` 라우트 + 컨트롤러 레지스트리. (Task 8)
- `web/app.js` 수정 — Recorder 패널 + NAV 항목. (Task 9)
- 테스트: `src/record/{trail,oracle,refmap,inject,extract,capture,cli}.test.ts`, `src/web/record-routes.test.ts`.

---

### Task 1: Trail 타입 + 영속화

**Files:**
- Create: `src/record/trail.ts`
- Test: `src/record/trail.test.ts`

**Interfaces:**
- Consumes: `agrune`의 `ConsoleMessageEntry`, `NetworkRequestSummary` 타입.
- Produces: `RecordingSession`, `TimelineEntry`, `RawTarget`, `OracleHit`, `EntryKind`, `ActionVerb`, `createRecordingSession(id,url,startedAt)`, `appendEntry(session, partial)`, `writeTrail(dir,session)`, `readTrail(dir)`.

- [ ] **Step 1: 시그니처 스텁 작성 (컴파일되게)**

Create `src/record/trail.ts`:

```ts
// 블랙박스 트레일: 로컬 진단 산출물 (배포물 아님). 모든 이벤트가 raw하게 쌓이며,
// 매니페스트 밖 클릭/디스크립터도 담는다. version 필드로 온디스크 포맷 진화를 대비한다.

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { ConsoleMessageEntry, NetworkRequestSummary } from 'agrune'

export type EntryKind = 'action' | 'nav' | 'bookmark' | 'checkpoint'
export type ActionVerb = 'click' | 'fill' | 'select' | 'check' | 'uncheck' | 'press'

/** 인페이지 캡처 스크립트가 만든, 클릭/입력된 요소의 raw 디스크립터(진단용). */
export interface RawTarget {
  tag: string
  role?: string
  name?: string
  testId?: string
  css?: string
}

export interface OracleHit {
  kind: 'console-error' | 'network-failure' | 'page-crash'
  detail: string
}

export interface TimelineEntry {
  index: number
  /** 세션 시작 기준 상대 ms. */
  t: number
  kind: EntryKind
  action?: { do: ActionVerb; value?: string; rawTarget: RawTarget }
  /** 네비게이션 엔트리(kind==='nav')의 도착 URL. */
  navUrl?: string
  /** 역매핑된 매니페스트 ref(agent 형식). 실패 시 null. */
  ref: string | null
  refMeta?: { rank: number }
  console: ConsoleMessageEntry[]
  network: NetworkRequestSummary[]
  screenshot?: string
  dom?: string
  anomalies?: OracleHit[]
  note?: string
}

export interface RecordingSession {
  version: 1
  id: string
  startedAt: number
  url: string
  manifest: { schemaVersion: 3; origin?: string; appVersion?: string }
  entries: TimelineEntry[]
  bookmarks: number[]
}

export function createRecordingSession(_id: string, _url: string, _startedAt: number): RecordingSession {
  throw new Error('not implemented')
}

/** 다음 인덱스/시간을 채워 엔트리를 추가하고, 그 엔트리를 반환한다. */
export function appendEntry(
  _session: RecordingSession,
  _partial: Omit<TimelineEntry, 'index' | 't'> & { t: number },
): TimelineEntry {
  throw new Error('not implemented')
}

export async function writeTrail(_dir: string, _session: RecordingSession): Promise<string> {
  throw new Error('not implemented')
}

export async function readTrail(_dir: string): Promise<RecordingSession> {
  throw new Error('not implemented')
}
```

- [ ] **Step 2: 실패 테스트 작성**

Create `src/record/trail.test.ts`:

```ts
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
```

- [ ] **Step 3: 빌드 + 실행 → RED**

Run: `pnpm run build && node --test dist/record/trail.test.js`
Expected: FAIL ("not implemented").

- [ ] **Step 4: 구현**

`src/record/trail.ts`의 함수 본문을 교체:

```ts
export function createRecordingSession(id: string, url: string, startedAt: number): RecordingSession {
  return { version: 1, id, startedAt, url, manifest: { schemaVersion: 3 }, entries: [], bookmarks: [] }
}

export function appendEntry(
  session: RecordingSession,
  partial: Omit<TimelineEntry, 'index' | 't'> & { t: number },
): TimelineEntry {
  const entry: TimelineEntry = { ...partial, index: session.entries.length }
  session.entries.push(entry)
  return entry
}

export async function writeTrail(dir: string, session: RecordingSession): Promise<string> {
  await mkdir(dir, { recursive: true })
  const file = path.join(dir, 'trail.json')
  await writeFile(file, JSON.stringify(session, null, 2), 'utf8')
  return file
}

export async function readTrail(dir: string): Promise<RecordingSession> {
  const raw = await readFile(path.join(dir, 'trail.json'), 'utf8')
  return JSON.parse(raw) as RecordingSession
}
```

- [ ] **Step 5: 빌드 + 실행 → GREEN**

Run: `pnpm run build && node --test dist/record/trail.test.js`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit (사용자 승인 후)**

```bash
git add src/record/trail.ts src/record/trail.test.ts
git commit -m "feat(record): trail types + persistence"
```

---

### Task 2: Oracle (anomaly 감지)

**Files:**
- Create: `src/record/oracle.ts`
- Test: `src/record/oracle.test.ts`

**Interfaces:**
- Consumes: `agrune`의 `BrowserSession`; `./trail.js`의 `OracleHit`.
- Produces: `OracleTracker`, `newTracker()`, `detectHits(errorCount, failureCount, tracker, crashed?)`, `countConsoleErrors(browser)`, `countNetworkFailures(browser)`, `pollOracle(browser, tracker, crashed?)`.

- [ ] **Step 1: 시그니처 스텁 작성**

Create `src/record/oracle.ts`:

```ts
// 블랙박스 anomaly 오라클: 콘솔 에러 / 네트워크 실패 / 페이지 크래시. monkey와 같은 신호 클래스.
// 판정은 순수 함수(detectHits)로 분리해 브라우저 없이 테스트한다.

import type { BrowserSession } from 'agrune'
import type { OracleHit } from './trail.js'

export interface OracleTracker {
  errors: number
  failures: number
}

export function newTracker(): OracleTracker {
  return { errors: 0, failures: 0 }
}

export function detectHits(
  _errorCount: number,
  _failureCount: number,
  _tracker: OracleTracker,
  _crashed?: string,
): OracleHit[] {
  throw new Error('not implemented')
}

export function countConsoleErrors(_browser: BrowserSession): number {
  throw new Error('not implemented')
}

export function countNetworkFailures(_browser: BrowserSession): number {
  throw new Error('not implemented')
}

export function pollOracle(browser: BrowserSession, tracker: OracleTracker, crashed?: string): OracleHit[] {
  return detectHits(countConsoleErrors(browser), countNetworkFailures(browser), tracker, crashed)
}
```

- [ ] **Step 2: 실패 테스트 작성**

Create `src/record/oracle.test.ts`:

```ts
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
```

- [ ] **Step 3: 빌드 + 실행 → RED**

Run: `pnpm run build && node --test dist/record/oracle.test.js`
Expected: FAIL ("not implemented").

- [ ] **Step 4: 구현**

본문 교체:

```ts
export function detectHits(
  errorCount: number,
  failureCount: number,
  tracker: OracleTracker,
  crashed?: string,
): OracleHit[] {
  const hits: OracleHit[] = []
  if (crashed) hits.push({ kind: 'page-crash', detail: crashed })
  if (errorCount > tracker.errors) {
    hits.push({ kind: 'console-error', detail: `${errorCount - tracker.errors} new console error(s)` })
  }
  if (failureCount > tracker.failures) {
    hits.push({ kind: 'network-failure', detail: `${failureCount - tracker.failures} new network failure(s)` })
  }
  tracker.errors = errorCount
  tracker.failures = failureCount
  return hits
}

export function countConsoleErrors(browser: BrowserSession): number {
  try {
    return browser.consoleMessages(undefined, { level: 'error', all: true }).length
  } catch {
    return 0
  }
}

export function countNetworkFailures(browser: BrowserSession): number {
  try {
    return browser
      .networkRequests(undefined, { all: true, includeStatic: true })
      .filter((r) => r.failureText || (typeof r.status === 'number' && r.status >= 500)).length
  } catch {
    return 0
  }
}
```

- [ ] **Step 5: 빌드 + 실행 → GREEN**

Run: `pnpm run build && node --test dist/record/oracle.test.js`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit (사용자 승인 후)**

```bash
git add src/record/oracle.ts src/record/oracle.test.ts
git commit -m "feat(record): anomaly oracle (console/network/crash)"
```

---

### Task 3: 역매핑 (nonce 요소 → 매니페스트 ref)

**Files:**
- Create: `src/record/refmap.ts`
- Test: `src/record/refmap.test.ts`

**Interfaces:**
- Consumes: `agrune`의 `BrowserSession`, `resolveTargetLocator`, `toAgentTargetRef`.
- Produces: `HIT_ATTR` (= `'data-agrune-hit'`), `RefMatch { ref: string; targetId: string; rank: number }`, `mapHitToRef(browser, nonce): Promise<RefMatch | null>`.

`mapHitToRef`는 nonce가 박힌 요소를, 매니페스트가 선언한 타깃 중 어느 것이 가리키는지 코어 resolver로 찾는다. `rank 0` = 클릭 요소가 곧 타깃, `rank 1` = 타깃이 클릭 요소의 조상(예: 버튼 안 span 클릭). 일치 없으면 null(unmapped). 셀렉터 권위는 코어 `resolveTargetLocator`에 있고, Studio는 Locator `.and()`/`.locator()`/`.count()`만 조합한다(DOM 타입·코어 수정 없음).

- [ ] **Step 1: 시그니처 스텁 작성**

Create `src/record/refmap.ts`:

```ts
// 역매핑: 클릭/입력으로 nonce가 박힌 요소 ↔ 매니페스트 ref. 코어 resolveTargetLocator로 각 선언
// 타깃의 Locator를 얻고, Locator.and(hit)로 정확 일치, target.locator(hit)로 조상 포함을 판정한다.
// 셀렉터 해석은 전부 코어 — Studio는 조합만 한다(인바리언트: 매니페스트 권위 = 코어 소유).

import { BrowserSession, resolveTargetLocator, toAgentTargetRef } from 'agrune'

export const HIT_ATTR = 'data-agrune-hit'

export interface RefMatch {
  ref: string
  targetId: string
  rank: number
}

export async function mapHitToRef(_browser: BrowserSession, _nonce: string): Promise<RefMatch | null> {
  throw new Error('not implemented')
}
```

- [ ] **Step 2: 실패 테스트 작성 (실 chromium + 로컬 서버)**

Create `src/record/refmap.test.ts`:

```ts
import assert from 'node:assert/strict'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { before, describe, it } from 'node:test'
import { BrowserSession } from 'agrune'
import { HIT_ATTR, mapHitToRef } from './refmap.js'

const manifest = {
  version: 3,
  groups: [
    {
      groupId: 'app',
      targets: [{ targetId: 'go', name: 'Go', actionKinds: ['click'], selector: { css: '#go' } }],
    },
  ],
}

function pageHtml(): string {
  return `<!doctype html><html><head><title>Refmap</title></head><body>
<button id="go"><span id="inner">Go</span></button>
<div id="plain">plain</div>
<script>window.__agrune_manifest__ = ${JSON.stringify(manifest)};</script>
</body></html>`
}

async function serve(): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end(pageHtml())
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return { url: `http://127.0.0.1:${port}/`, close: () => new Promise<void>((resolve) => server.close(() => resolve())) }
}

let available = true

describe('refmap (real chromium)', () => {
  before(async () => {
    const probe = new BrowserSession(true)
    try {
      await probe.start()
      await probe.stop()
    } catch {
      available = false
    }
  })

  it('maps a nonce on the declared element to its ref (rank 0)', async (t) => {
    if (!available) return t.skip('chromium unavailable')
    const app = await serve()
    const browser = new BrowserSession(true)
    try {
      await browser.start()
      await browser.open(app.url)
      // tag the declared button with a nonce, exactly as the capture script would
      await browser.page().locator('#go').evaluate((el, a) => el.setAttribute(a, 'N1'), HIT_ATTR)
      const m = await mapHitToRef(browser, 'N1')
      assert.ok(m, 'expected a match')
      assert.equal(m!.ref, 'go')
      assert.equal(m!.rank, 0)
    } finally {
      await browser.stop().catch(() => undefined)
      await app.close()
    }
  })

  it('maps a nonce on a child up to the ancestor target (rank 1)', async (t) => {
    if (!available) return t.skip('chromium unavailable')
    const app = await serve()
    const browser = new BrowserSession(true)
    try {
      await browser.start()
      await browser.open(app.url)
      await browser.page().locator('#inner').evaluate((el, a) => el.setAttribute(a, 'N2'), HIT_ATTR)
      const m = await mapHitToRef(browser, 'N2')
      assert.ok(m, 'expected a match')
      assert.equal(m!.ref, 'go')
      assert.equal(m!.rank, 1)
    } finally {
      await browser.stop().catch(() => undefined)
      await app.close()
    }
  })

  it('returns null for an undeclared element', async (t) => {
    if (!available) return t.skip('chromium unavailable')
    const app = await serve()
    const browser = new BrowserSession(true)
    try {
      await browser.start()
      await browser.open(app.url)
      await browser.page().locator('#plain').evaluate((el, a) => el.setAttribute(a, 'N3'), HIT_ATTR)
      const m = await mapHitToRef(browser, 'N3')
      assert.equal(m, null)
    } finally {
      await browser.stop().catch(() => undefined)
      await app.close()
    }
  })
})
```

> 참고: 위 테스트는 `locator.evaluate((el, a) => el.setAttribute(a, ...))`로 nonce를 심는다. 이 콜백은 **브라우저 안에서** 실행되므로 DOM을 써도 되고, `el`은 Playwright가 any 계열로 받는다(테스트 파일에 한해 허용). 프로덕션 Node 코드(refmap.ts)에는 DOM 참조가 없어야 한다.

- [ ] **Step 3: 빌드 + 실행 → RED**

Run: `pnpm run build && node --test dist/record/refmap.test.js`
Expected: FAIL ("not implemented") (또는 chromium 없으면 skip — 그 경우 가용 환경에서 재실행).

- [ ] **Step 4: 구현**

`mapHitToRef` 본문 교체:

```ts
export async function mapHitToRef(browser: BrowserSession, nonce: string): Promise<RefMatch | null> {
  const page = browser.page()
  let targets
  try {
    targets = (await browser.snapshot()).targets
  } catch {
    return null // no manifest / page gone
  }
  const hitSelector = `[${HIT_ATTR}="${nonce}"]`
  const hitLoc = page.locator(hitSelector)
  let best: RefMatch | null = null
  for (const t of targets) {
    const ref = toAgentTargetRef(t)
    let targetLoc
    try {
      targetLoc = await resolveTargetLocator(page, ref)
    } catch {
      continue // declared-but-unresolved / not declared → skip
    }
    // rank 0: the hit element IS the target element
    const exact = await targetLoc.and(hitLoc).count().catch(() => 0)
    if (exact > 0) return { ref, targetId: t.targetId, rank: 0 }
    // rank 1: the target contains the hit element (clicked a child of the target)
    if (!best) {
      const contains = await targetLoc.locator(hitSelector).count().catch(() => 0)
      if (contains > 0) best = { ref, targetId: t.targetId, rank: 1 }
    }
  }
  return best
}
```

- [ ] **Step 5: 빌드 + 실행 → GREEN**

Run: `pnpm run build && node --test dist/record/refmap.test.js`
Expected: PASS (3 tests; chromium 가용 시).

- [ ] **Step 6: Commit (사용자 승인 후)**

```bash
git add src/record/refmap.ts src/record/refmap.test.ts
git commit -m "feat(record): reverse-map element nonce to manifest ref via core resolver"
```

---

### Task 4: 인페이지 캡처 스크립트 + REC 오버레이

**Files:**
- Create: `src/record/inject.ts`
- Test: `src/record/inject.test.ts`

**Interfaces:**
- Consumes: `./refmap.js`의 `HIT_ATTR`.
- Produces: `BINDING` (= `'__agruneRecord'`), `OVERLAY_ID` (= `'__agrune_rec_overlay'`), `CAPTURE_SCRIPT` (브라우저에서 실행될 JS 문자열).

`CAPTURE_SCRIPT`는 tsc가 본문을 검사하지 않는 **문자열**이다(브라우저에서만 실행). 역할: ① 중복 주입 가드 ② document 캡처 단계에서 click/change 가로채기 ③ 맞은 요소에 `HIT_ATTR=nonce`(단조 카운터) 찍고 rawTarget 디스크립터 계산 ④ `window[BINDING]({type:'action', do, value?, nonce, rawTarget, t})` 호출 ⑤ history pushState/replaceState/popstate → `{type:'nav', url, t}` ⑥ REC 오버레이(버그다!/체크포인트 버튼) 그리고 오버레이 내부 이벤트는 무시.

- [ ] **Step 1: 모듈 작성 (상수 + 스크립트 문자열)**

Create `src/record/inject.ts`:

```ts
// 인페이지 캡처 스크립트(문자열) + REC 오버레이. 브라우저에서만 실행되므로 DOM을 자유롭게 쓴다.
// addInitScript로 모든 문서에 주입되며 네비게이션을 넘어 재적용된다. exposeBinding(BINDING)으로
// Node에 이벤트를 보낸다. nonce는 단조 카운터(결정론, Math.random 미사용).

import { HIT_ATTR } from './refmap.js'

export const BINDING = '__agruneRecord'
export const OVERLAY_ID = '__agrune_rec_overlay'

export const CAPTURE_SCRIPT = `(() => {
  if (window.__agruneRecInjected) return;
  window.__agruneRecInjected = true;
  var HIT = ${JSON.stringify(HIT_ATTR)};
  var BINDING = ${JSON.stringify(BINDING)};
  var OVERLAY_ID = ${JSON.stringify(OVERLAY_ID)};
  var seq = 0;
  function send(payload) { try { if (window[BINDING]) window[BINDING](payload); } catch (e) {} }
  function now() { try { return Math.round(performance.now()); } catch (e) { return 0; } }
  function inOverlay(el) { return !!(el && el.closest && el.closest('#' + OVERLAY_ID)); }
  function describe(el) {
    var d = { tag: (el.tagName || '').toLowerCase() };
    var role = el.getAttribute && el.getAttribute('role'); if (role) d.role = role;
    var tid = el.getAttribute && (el.getAttribute('data-testid') || el.getAttribute('data-test-id')); if (tid) d.testId = tid;
    var name = (el.getAttribute && el.getAttribute('aria-label')) || (el.textContent || '').trim().slice(0, 80); if (name) d.name = name;
    if (el.id) d.css = '#' + el.id;
    else if (el.className && typeof el.className === 'string') d.css = d.tag + '.' + el.className.trim().split(/\\s+/).join('.');
    else d.css = d.tag;
    return d;
  }
  function tag(el) { var n = 'n' + (++seq); try { el.setAttribute(HIT, n); } catch (e) {} return n; }
  function verbFor(el, type) {
    var t = (el.tagName || '').toLowerCase();
    if (type === 'click') return 'click';
    if (t === 'select') return 'select';
    if (t === 'input' && (el.type === 'checkbox')) return el.checked ? 'check' : 'uncheck';
    return 'fill';
  }
  document.addEventListener('click', function (e) {
    var el = e.target; if (!el || inOverlay(el)) return;
    send({ type: 'action', do: 'click', nonce: tag(el), rawTarget: describe(el), t: now() });
  }, true);
  document.addEventListener('change', function (e) {
    var el = e.target; if (!el || inOverlay(el)) return;
    var v = verbFor(el, 'change');
    var value = (v === 'fill' || v === 'select') ? String(el.value == null ? '' : el.value) : undefined;
    send({ type: 'action', do: v, value: value, nonce: tag(el), rawTarget: describe(el), t: now() });
  }, true);
  function navHook(url) { send({ type: 'nav', url: url || location.href, t: now() }); }
  var _ps = history.pushState; history.pushState = function () { var r = _ps.apply(this, arguments); navHook(location.href); return r; };
  var _rs = history.replaceState; history.replaceState = function () { var r = _rs.apply(this, arguments); navHook(location.href); return r; };
  window.addEventListener('popstate', function () { navHook(location.href); });
  function overlay() {
    if (document.getElementById(OVERLAY_ID)) return;
    var box = document.createElement('div'); box.id = OVERLAY_ID;
    box.setAttribute('style', 'position:fixed;z-index:2147483647;right:14px;bottom:14px;display:flex;gap:8px;align-items:center;font:600 12px -apple-system,system-ui,sans-serif;background:#161b22;color:#e6edf3;border:1px solid #2a323d;border-radius:10px;padding:8px 12px;box-shadow:0 6px 24px rgba(0,0,0,.4)');
    var dot = document.createElement('span'); dot.setAttribute('style', 'width:9px;height:9px;border-radius:50%;background:#f85149;display:inline-block');
    var label = document.createElement('span'); label.textContent = 'REC';
    var bug = document.createElement('button'); bug.textContent = '버그다!';
    bug.setAttribute('style', 'cursor:pointer;border:none;border-radius:7px;padding:5px 10px;font:inherit;background:#f85149;color:#fff');
    bug.addEventListener('click', function () { send({ type: 'bug', t: now() }); });
    var cp = document.createElement('button'); cp.textContent = '체크포인트';
    cp.setAttribute('style', 'cursor:pointer;border:1px solid #2a323d;border-radius:7px;padding:5px 10px;font:inherit;background:#1c232d;color:#e6edf3');
    cp.addEventListener('click', function () { send({ type: 'checkpoint', t: now() }); });
    box.appendChild(dot); box.appendChild(label); box.appendChild(bug); box.appendChild(cp);
    (document.body || document.documentElement).appendChild(box);
  }
  if (document.body) overlay(); else document.addEventListener('DOMContentLoaded', overlay);
})();`
```

- [ ] **Step 2: 실패 테스트 작성 (문자열 모양 검증)**

Create `src/record/inject.test.ts`:

```ts
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
```

- [ ] **Step 3: 빌드 + 실행 → RED 또는 GREEN 확인**

Run: `pnpm run build && node --test dist/record/inject.test.js`
Expected: 스크립트를 Step 1에서 이미 채웠으므로 PASS (2 tests). 만약 상수/문자열 누락이면 FAIL → 수정.

- [ ] **Step 4: (해당 없음 — 스크립트는 데이터)**

이 태스크는 실제 동작 검증을 Task 6 통합 테스트에 위임한다. 여기서는 상수·문자열 계약만 고정.

- [ ] **Step 5: 빌드 + 실행 → GREEN**

Run: `pnpm run build && node --test dist/record/inject.test.js`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit (사용자 승인 후)**

```bash
git add src/record/inject.ts src/record/inject.test.ts
git commit -m "feat(record): in-page capture script + REC overlay"
```

---

### Task 5: 시나리오 추출 (트레일 → 테스트)

**Files:**
- Create: `src/record/extract.ts`
- Test: `src/record/extract.test.ts`

**Interfaces:**
- Consumes: `./trail.js`의 `RecordingSession`, `RawTarget`, `TimelineEntry`; `../scenario/schema.js`의 `Scenario`, `validateScenario`, `SCENARIO_SCHEMA_ID`.
- Produces: `ExtractGap { index: number; rawTarget?: RawTarget; reason: string }`, `ExtractResult { scenario: Scenario; gaps: ExtractGap[] }`, `extractScenario(session, opts?)`.

추출 규칙(v1): 매핑된 액션(`ref!==null`) → ref 스텝. **unmapped 액션 → 스텝 금지, 갭 목록에 추가**(인바리언트: raw 셀렉터 절대 안 박음). 단언 추론: nav 엔트리 → `urlContains`(경로), checkpoint → 직전 액션 ref의 `targetVisible`, anomaly 북마크 → `noConsoleErrors`. 스텝이 비면 마지막에 `noConsoleErrors` 추가(스키마 min 1 충족). 산출물은 `validateScenario`를 통과해야 한다.

- [ ] **Step 1: 시그니처 스텁 작성**

Create `src/record/extract.ts`:

```ts
// 트레일 구간 → agrune.scenario/v1. ref-only 순수(인바리언트): unmapped 액션은 스텝이 아니라 갭으로.
// 단언은 닫힌 enum만 추론한다.

import { SCENARIO_SCHEMA_ID, type Scenario } from '../scenario/schema.js'
import type { RawTarget, RecordingSession } from './trail.js'

export interface ExtractGap {
  index: number
  rawTarget?: RawTarget
  reason: string
}

export interface ExtractResult {
  scenario: Scenario
  gaps: ExtractGap[]
}

export interface ExtractOptions {
  /** 포함 시작 인덱스(기본 0). */
  from?: number
  /** 포함 끝 인덱스(기본 마지막). */
  to?: number
  /** 시나리오 이름(기본 'recorded flow'). */
  name?: string
}

export function extractScenario(_session: RecordingSession, _opts: ExtractOptions = {}): ExtractResult {
  throw new Error('not implemented')
}
```

- [ ] **Step 2: 실패 테스트 작성**

Create `src/record/extract.test.ts`:

```ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { validateScenario } from '../scenario/schema.js'
import { appendEntry, createRecordingSession } from './trail.js'
import { extractScenario } from './extract.js'

function fixture() {
  const s = createRecordingSession('rec1', 'http://app/', 0)
  appendEntry(s, { t: 1, kind: 'action', action: { do: 'click', rawTarget: { tag: 'button' } }, ref: 'boom', console: [], network: [] })
  appendEntry(s, { t: 2, kind: 'action', action: { do: 'fill', value: 'hi', rawTarget: { tag: 'input' } }, ref: 'note', console: [], network: [] })
  // unmapped action → must NOT become a step; becomes a gap
  appendEntry(s, { t: 3, kind: 'action', action: { do: 'click', rawTarget: { tag: 'div', css: '#x' } }, ref: null, console: [], network: [] })
  // checkpoint → targetVisible of the preceding mapped action's ref (note)
  appendEntry(s, { t: 4, kind: 'checkpoint', ref: null, console: [], network: [] })
  // nav → urlContains
  appendEntry(s, { t: 5, kind: 'nav', navUrl: 'http://app/board', ref: null, console: [], network: [] })
  // anomaly bookmark → noConsoleErrors
  const bm = appendEntry(s, { t: 6, kind: 'bookmark', ref: null, console: [], network: [], anomalies: [{ kind: 'console-error', detail: 'boom' }] })
  s.bookmarks.push(bm.index)
  return s
}

describe('extractScenario', () => {
  it('produces a valid ref-only scenario and flags unmapped actions as gaps', () => {
    const { scenario, gaps } = extractScenario(fixture(), { name: 'demo' })

    // valid against the closed schema
    const v = validateScenario(scenario)
    assert.ok(v.ok, 'extracted scenario must validate: ' + (v.ok ? '' : JSON.stringify(v.errors)))

    // mapped actions became ref steps; unmapped did NOT
    const actionSteps = scenario.steps.filter((s) => 'do' in s)
    assert.deepEqual(actionSteps.map((s) => (s as { ref?: string }).ref), ['boom', 'note'])

    // no raw selectors leaked into any step
    assert.ok(!JSON.stringify(scenario).includes('#x'), 'raw selector must not appear in the scenario')

    // inferred assertions
    const asserts = scenario.steps.filter((s) => 'assert' in s) as Array<Record<string, unknown>>
    assert.ok(asserts.some((a) => a.assert === 'targetVisible' && a.ref === 'note'), 'checkpoint → targetVisible note')
    assert.ok(asserts.some((a) => a.assert === 'urlContains'), 'nav → urlContains')
    assert.ok(asserts.some((a) => a.assert === 'noConsoleErrors'), 'anomaly → noConsoleErrors')

    // gap for the unmapped click
    assert.equal(gaps.length, 1)
    assert.equal(gaps[0]!.index, 2)
  })

  it('respects from/to slicing', () => {
    const { scenario } = extractScenario(fixture(), { from: 1, to: 1 })
    const actionSteps = scenario.steps.filter((s) => 'do' in s)
    assert.deepEqual(actionSteps.map((s) => (s as { ref?: string }).ref), ['note'])
  })

  it('always yields at least one step', () => {
    const s = createRecordingSession('rec1', 'http://app/', 0)
    appendEntry(s, { t: 1, kind: 'action', action: { do: 'click', rawTarget: { tag: 'div' } }, ref: null, console: [], network: [] })
    const { scenario } = extractScenario(s)
    assert.ok(scenario.steps.length >= 1)
    assert.ok(validateScenario(scenario).ok)
  })
})
```

- [ ] **Step 3: 빌드 + 실행 → RED**

Run: `pnpm run build && node --test dist/record/extract.test.js`
Expected: FAIL ("not implemented").

- [ ] **Step 4: 구현**

`extractScenario` 본문 교체:

```ts
import type { AssertionStep, Step } from '../scenario/schema.js'

export function extractScenario(session: RecordingSession, opts: ExtractOptions = {}): ExtractResult {
  const from = opts.from ?? 0
  const to = opts.to ?? session.entries.length - 1
  const slice = session.entries.filter((e) => e.index >= from && e.index <= to)

  const steps: Step[] = []
  const gaps: ExtractGap[] = []
  let lastActionRef: string | null = null

  for (const e of slice) {
    if (e.kind === 'action' && e.action) {
      if (e.ref) {
        steps.push(toActionStep(e.ref, e.action.do, e.action.value))
        lastActionRef = e.ref
      } else {
        gaps.push({ index: e.index, rawTarget: e.action.rawTarget, reason: 'not declared in manifest' })
      }
    } else if (e.kind === 'nav' && e.navUrl) {
      const path = safePath(e.navUrl)
      if (path) steps.push({ assert: 'urlContains', value: path, label: 'navigated' })
    } else if (e.kind === 'checkpoint' && lastActionRef) {
      steps.push({ assert: 'targetVisible', ref: lastActionRef, label: 'checkpoint' })
    } else if (e.kind === 'bookmark' && e.anomalies && e.anomalies.length > 0) {
      steps.push({ assert: 'noConsoleErrors', label: `should not ${e.anomalies[0]!.kind}` })
    }
  }

  if (steps.length === 0) steps.push({ assert: 'noConsoleErrors' } as AssertionStep)

  const scenario: Scenario = {
    schema: SCENARIO_SCHEMA_ID,
    name: opts.name ?? 'recorded flow',
    manifest: { schemaVersion: 3 },
    url: session.url,
    steps,
  }
  return { scenario, gaps }
}

function toActionStep(ref: string, verb: string, value?: string): Step {
  switch (verb) {
    case 'fill':
      return { do: 'fill', ref, value: value ?? '' }
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

function safePath(url: string): string | null {
  try {
    const u = new URL(url)
    return u.pathname && u.pathname !== '/' ? u.pathname : (u.host || null)
  } catch {
    return null
  }
}
```

> 주의: `import type { AssertionStep, Step }`는 파일 상단의 기존 import에 합친다(별도 줄로 두지 말 것). `Step` 유니온이 `fill`/`select`에 `value` 필수, `check`/`uncheck`에 `ref`만 받는 것은 `../scenario/schema.ts` 정의와 일치한다.

- [ ] **Step 5: 빌드 + 실행 → GREEN**

Run: `pnpm run build && node --test dist/record/extract.test.js`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit (사용자 승인 후)**

```bash
git add src/record/extract.ts src/record/extract.test.ts
git commit -m "feat(record): extract ref-only scenario from trail (unmapped → gaps)"
```

---

### Task 6: 캡처 컨트롤러 (오케스트레이터)

**Files:**
- Create: `src/record/capture.ts`
- Test: `src/record/capture.test.ts`

**Interfaces:**
- Consumes: `agrune`의 `BrowserSession`; `./inject.js`의 `BINDING`/`CAPTURE_SCRIPT`; `./refmap.js`의 `mapHitToRef`; `./oracle.js`의 `newTracker`/`pollOracle`; `./trail.js`의 `createRecordingSession`/`appendEntry`/`writeTrail` + 타입.
- Produces: `StartOptions { url; artifactsDir; headless? }`, `RecordController { id; url; recording; browser; bug(note?); checkpoint(); stop() }`, `startRecording(opts): Promise<RecordController>`.

컨트롤러는 헤디드 `BrowserSession`을 띄우고(`headless` 미지정 시 false), `context.exposeBinding`+`context.addInitScript`로 계기화한 뒤 URL로 이동한다. 바인딩 이벤트는 직렬 큐로 처리해 스크린샷 레이스를 막는다. `bug`/`checkpoint`는 오버레이/서버/테스트 어디서든 부를 수 있다. `stop`은 큐를 비우고 `trail.json`을 저장한 뒤 브라우저를 닫는다.

- [ ] **Step 1: 시그니처 스텁 작성**

Create `src/record/capture.ts`:

```ts
// QA 모드 세션 = 띄운 창의 수명. 캡처는 이 동안에만 일어난다(상시 감시 아님).
// 코어 BrowserSession을 통해서만 브라우저를 다룬다. 이벤트 path: 페이지 → exposeBinding → 직렬 큐 처리.

import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { BrowserSession } from 'agrune'
import { BINDING, CAPTURE_SCRIPT } from './inject.js'
import { mapHitToRef } from './refmap.js'
import { newTracker, pollOracle, type OracleTracker } from './oracle.js'
import { appendEntry, createRecordingSession, writeTrail, type ActionVerb, type RawTarget, type RecordingSession } from './trail.js'

export interface StartOptions {
  url: string
  artifactsDir: string
  /** 기본 false(헤디드 — 유저가 보는 QA 창). 테스트는 true. */
  headless?: boolean
}

export interface RecordController {
  id: string
  url: string
  recording: RecordingSession
  browser: BrowserSession
  bug(note?: string): Promise<void>
  checkpoint(): Promise<void>
  stop(): Promise<RecordingSession>
}

export async function startRecording(_opts: StartOptions): Promise<RecordController> {
  throw new Error('not implemented')
}
```

- [ ] **Step 2: 실패 테스트 작성 (실 chromium + 로컬 서버)**

Create `src/record/capture.test.ts`:

```ts
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import { before, describe, it } from 'node:test'
import { BrowserSession } from 'agrune'
import { startRecording } from './capture.js'
import { readTrail } from './trail.js'

const manifest = {
  version: 3,
  groups: [{ groupId: 'app', targets: [{ targetId: 'go', name: 'Go', actionKinds: ['click'], selector: { css: '#go' } }] }],
}

function pageHtml(): string {
  return `<!doctype html><html><head><title>Capture</title></head><body>
<button id="go">Go</button>
<div id="plain">plain</div>
<script>window.__agrune_manifest__ = ${JSON.stringify(manifest)};</script>
</body></html>`
}

async function serve(): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end(pageHtml())
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return { url: `http://127.0.0.1:${port}/`, close: () => new Promise<void>((resolve) => server.close(() => resolve())) }
}

async function waitFor(pred: () => boolean, ms = 5000): Promise<void> {
  const t0 = Date.now()
  while (!pred()) {
    if (Date.now() - t0 > ms) throw new Error('waitFor timed out')
    await new Promise((r) => setTimeout(r, 50))
  }
}

let available = true

describe('capture controller (real chromium)', () => {
  before(async () => {
    const probe = new BrowserSession(true)
    try {
      await probe.start()
      await probe.stop()
    } catch {
      available = false
    }
  })

  it('captures clicks, maps declared targets, flags undeclared, and persists the trail', async (t) => {
    if (!available) return t.skip('chromium unavailable')
    const app = await serve()
    const dir = await mkdtemp(path.join(tmpdir(), 'rec-'))
    const ctrl = await startRecording({ url: app.url, artifactsDir: dir, headless: true })
    try {
      // a real click on the declared button → mapped to ref 'go'
      await ctrl.browser.page().locator('#go').click()
      await waitFor(() => ctrl.recording.entries.some((e) => e.action?.do === 'click' && e.ref === 'go'))
      const mapped = ctrl.recording.entries.find((e) => e.ref === 'go')!
      assert.ok(mapped.screenshot, 'a screenshot should be captured')
      await stat(mapped.screenshot!) // file exists

      // a click on an undeclared element → recorded but ref null (unmapped)
      await ctrl.browser.page().locator('#plain').click()
      await waitFor(() => ctrl.recording.entries.some((e) => e.action?.rawTarget?.css === '#plain'))
      const unmapped = ctrl.recording.entries.find((e) => e.action?.rawTarget?.css === '#plain')!
      assert.equal(unmapped.ref, null)

      // manual bug bookmark
      await ctrl.bug('looks wrong')
      assert.ok(ctrl.recording.bookmarks.length >= 1)

      const final = await ctrl.stop()
      const back = await readTrail(dir)
      assert.equal(back.version, 1)
      assert.equal(back.entries.length, final.entries.length)
    } finally {
      await ctrl.stop().catch(() => undefined)
      await rm(dir, { recursive: true, force: true })
      await app.close()
    }
  })
})
```

- [ ] **Step 3: 빌드 + 실행 → RED**

Run: `pnpm run build && node --test dist/record/capture.test.js`
Expected: FAIL ("not implemented").

- [ ] **Step 4: 구현**

`startRecording` 본문 교체:

```ts
export async function startRecording(opts: StartOptions): Promise<RecordController> {
  await mkdir(opts.artifactsDir, { recursive: true })
  const id = path.basename(opts.artifactsDir)
  const browser = new BrowserSession(opts.headless ?? false)
  await browser.start()
  await browser.open('about:blank')

  const startedAt = Date.now()
  const recording = createRecordingSession(id, opts.url, startedAt)
  const tracker: OracleTracker = newTracker()
  let lastConsoleLen = 0
  let lastNetLen = 0

  // serialize event handling so screenshots/deltas never race
  let queue: Promise<void> = Promise.resolve()
  const enqueue = (fn: () => Promise<void>): Promise<void> => {
    queue = queue.then(fn).catch(() => undefined)
    return queue
  }

  function deltas(): { console: RecordingSession['entries'][number]['console']; network: RecordingSession['entries'][number]['network'] } {
    let allC: ReturnType<BrowserSession['consoleMessages']> = []
    let allN: ReturnType<BrowserSession['networkRequests']> = []
    try {
      allC = browser.consoleMessages(undefined, { all: true })
    } catch {
      allC = []
    }
    try {
      allN = browser.networkRequests(undefined, { all: true, includeStatic: true })
    } catch {
      allN = []
    }
    const c = allC.slice(lastConsoleLen)
    const n = allN.slice(lastNetLen)
    lastConsoleLen = allC.length
    lastNetLen = allN.length
    return { console: c, network: n }
  }

  async function shot(): Promise<string | undefined> {
    const file = path.join(opts.artifactsDir, `step-${String(recording.entries.length + 1).padStart(3, '0')}.png`)
    return browser.screenshot(undefined, file).catch(() => undefined)
  }

  async function handleAction(p: { do: ActionVerb; value?: string; nonce: string; rawTarget: RawTarget; t: number }): Promise<void> {
    const match = await mapHitToRef(browser, p.nonce).catch(() => null)
    const screenshot = await shot()
    const { console: c, network: n } = deltas()
    const entry = appendEntry(recording, {
      t: p.t,
      kind: 'action',
      action: { do: p.do, value: p.value, rawTarget: p.rawTarget },
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

  async function handleNav(p: { url: string; t: number }): Promise<void> {
    const screenshot = await shot()
    const { console: c, network: n } = deltas()
    appendEntry(recording, { t: p.t, kind: 'nav', navUrl: p.url, ref: null, console: c, network: n, screenshot })
  }

  async function addBookmark(kind: 'bookmark' | 'checkpoint', t: number, note?: string): Promise<void> {
    const screenshot = await shot()
    const { console: c, network: n } = deltas()
    const entry = appendEntry(recording, { t, kind, ref: null, console: c, network: n, screenshot, note })
    recording.bookmarks.push(entry.index)
  }

  const elapsed = (): number => Date.now() - startedAt

  await browser.page().context().exposeBinding(BINDING, (_src: unknown, payload: Record<string, unknown>) => {
    const type = payload?.type
    if (type === 'action') {
      void enqueue(() =>
        handleAction({
          do: payload.do as ActionVerb,
          value: payload.value as string | undefined,
          nonce: String(payload.nonce),
          rawTarget: payload.rawTarget as RawTarget,
          t: Number(payload.t ?? elapsed()),
        }),
      )
    } else if (type === 'nav') {
      void enqueue(() => handleNav({ url: String(payload.url), t: Number(payload.t ?? elapsed()) }))
    } else if (type === 'bug') {
      void enqueue(() => addBookmark('bookmark', Number(payload.t ?? elapsed()), payload.note as string | undefined))
    } else if (type === 'checkpoint') {
      void enqueue(() => addBookmark('checkpoint', Number(payload.t ?? elapsed())))
    }
  })
  await browser.page().context().addInitScript({ content: CAPTURE_SCRIPT })
  await browser.navigate(opts.url)
  // baseline: ignore console/network present on initial load
  deltas()
  tracker.errors = 0
  tracker.failures = 0

  return {
    id,
    url: opts.url,
    recording,
    browser,
    bug: (note?: string) => enqueue(() => addBookmark('bookmark', elapsed(), note)),
    checkpoint: () => enqueue(() => addBookmark('checkpoint', elapsed())),
    async stop(): Promise<RecordingSession> {
      await queue // drain in-flight events
      await writeTrail(opts.artifactsDir, recording)
      await browser.stop().catch(() => undefined)
      return recording
    },
  }
}
```

> 주의: `browser.page().context()`는 Playwright `BrowserContext`다. `exposeBinding`/`addInitScript`는 about:blank 오픈 직후·navigate 전에 등록해야 앱 로드에 캡처 스크립트가 적용된다. `addInitScript`는 네비게이션마다 재적용되어 SPA에서도 생존한다. 같은 세션에서 `exposeBinding`은 한 번만 등록한다(중복 등록은 throw).

- [ ] **Step 5: 빌드 + 실행 → GREEN**

Run: `pnpm run build && node --test dist/record/capture.test.js`
Expected: PASS (1 test; chromium 가용 시).

- [ ] **Step 6: Commit (사용자 승인 후)**

```bash
git add src/record/capture.ts src/record/capture.test.ts
git commit -m "feat(record): capture controller — instrument headed session, assemble timeline"
```

---

### Task 7: `record` CLI

**Files:**
- Create: `src/record/cli.ts`
- Create: `src/record/cli.test.ts`
- Modify: `src/cli.ts` (USAGE에 한 줄 추가, dispatch에 `record` 분기 추가, import 추가)

**Interfaces:**
- Consumes: `./capture.js`의 `startRecording`; `./extract.js`의 `extractScenario`.
- Produces: `parseRecordArgs(argv): { url: string; out?: string; headless: boolean }`, `runRecordCli(argv): Promise<number>`.

`agrune-studio record --url <app> [--out <dir>] [--headless]` — 헤디드 창을 띄워 QA 모드 캡처를 시작하고, 유저가 Ctrl+C로 멈출 때까지 살아 있다가, 종료 시 트레일을 저장하고 추출 시나리오를 stdout에 출력한다. `parseRecordArgs`만 단위 테스트한다(인터랙티브 캡처는 Task 6에서 검증됨).

- [ ] **Step 1: 시그니처 스텁 작성**

Create `src/record/cli.ts`:

```ts
// `agrune-studio record` — 헤디드 QA 모드 캡처를 시작한다. Ctrl+C로 종료하면 트레일 저장 + 추출.

import path from 'node:path'
import { startRecording } from './capture.js'
import { extractScenario } from './extract.js'

export interface RecordArgs {
  url: string
  out?: string
  headless: boolean
}

export function parseRecordArgs(_argv: string[]): RecordArgs {
  throw new Error('not implemented')
}

export async function runRecordCli(argv: string[]): Promise<number> {
  const args = parseRecordArgs(argv)
  const dir = args.out ?? path.join(process.cwd(), 'web', 'runs', 'recordings', `${Date.now()}`)
  const ctrl = await startRecording({ url: args.url, artifactsDir: dir, headless: args.headless })
  console.log(`Recording ${args.url} → ${dir}`)
  console.log('QA 모드 창에서 앱을 조작하세요. Ctrl+C로 종료하면 트레일을 저장하고 시나리오를 출력합니다.')
  await new Promise<void>((resolve) => {
    const finish = () => resolve()
    process.once('SIGINT', finish)
    process.once('SIGTERM', finish)
  })
  const recording = await ctrl.stop()
  const { scenario, gaps } = extractScenario(recording, { name: 'recorded flow' })
  console.log(JSON.stringify(scenario, null, 2))
  if (gaps.length > 0) {
    console.error(`\n${gaps.length} unmapped action(s) — 매니페스트에 추가해야 테스트로 박힙니다:`)
    for (const g of gaps) console.error(`  - entry #${g.index}: ${g.rawTarget?.css ?? g.rawTarget?.tag ?? '?'} (${g.reason})`)
  }
  return 0
}
```

- [ ] **Step 2: 실패 테스트 작성**

Create `src/record/cli.test.ts`:

```ts
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
```

- [ ] **Step 3: 빌드 + 실행 → RED**

Run: `pnpm run build && node --test dist/record/cli.test.js`
Expected: FAIL ("not implemented").

- [ ] **Step 4: 구현**

`parseRecordArgs` 본문 교체:

```ts
export function parseRecordArgs(argv: string[]): RecordArgs {
  let url: string | undefined
  let out: string | undefined
  let headless = false
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!
    if (arg === '--url') {
      url = argv[i + 1]
      i += 1
    } else if (arg === '--out') {
      out = argv[i + 1]
      i += 1
    } else if (arg === '--headless') {
      headless = true
    }
  }
  if (!url || url.startsWith('--')) throw new Error('missing --url <app>')
  return out ? { url, out, headless } : { url, headless }
}
```

- [ ] **Step 5: `src/cli.ts` 배선**

`src/cli.ts`에서 import 블록에 추가:

```ts
import { runRecordCli } from './record/cli.js'
```

USAGE 문자열에서 `serve` 줄 위에 추가:

```ts
  agrune-studio record --url <app> [--out <dir>] [--headless]   # flight recorder
```

dispatch에서 `if (command === 'serve') ...` 위에 추가:

```ts
    if (command === 'record') return await runRecordCli(rest)
```

- [ ] **Step 6: 빌드 + 실행 → GREEN**

Run: `pnpm run build && node --test dist/record/cli.test.js`
Expected: PASS (3 tests). 또한 `node dist/cli.js --help`에 record 줄이 보이는지 확인.

- [ ] **Step 7: Commit (사용자 승인 후)**

```bash
git add src/record/cli.ts src/record/cli.test.ts src/cli.ts
git commit -m "feat(record): record CLI command"
```

---

### Task 8: 웹 서버 `record` 라우트

**Files:**
- Modify: `src/web/server.ts` (import 추가, 컨트롤러 레지스트리, RECORDINGS_DIR, route() 분기 추가)
- Create: `src/web/record-routes.test.ts`

**Interfaces:**
- Consumes: `../record/capture.js`의 `startRecording`/`RecordController`; `../record/extract.js`의 `extractScenario`; `../record/trail.js`의 `readTrail`/`RecordingSession`.
- Produces (HTTP, 전부 POST except 없음): `/api/record/start {url, headless?}` → `{id, url}`; `/api/record/status {id}` → `{recording}`; `/api/record/bug {id, note?}`; `/api/record/checkpoint {id}`; `/api/record/stop {id}` → `{recording}`; `/api/record/extract {id, from?, to?}` → `{scenario, gaps}`; `/api/record/list` → `{items}`; `/api/record/get {id}` → `{recording}`. 스크린샷 경로는 `/runs/recordings/<id>/...`로 재작성.

- [ ] **Step 1: 서버 배선 (컴파일되게)**

`src/web/server.ts` 상단 import 블록에 추가:

```ts
import { startRecording, type RecordController } from '../record/capture.js'
import { extractScenario } from '../record/extract.js'
import { readTrail, type RecordingSession } from '../record/trail.js'
```

`RUNS_DIR` 선언 아래에 추가:

```ts
const RECORDINGS_DIR = join(RUNS_DIR, 'recordings')
const recorders = new Map<string, RecordController>()

function rewriteRecShots(recording: RecordingSession): RecordingSession {
  for (const e of recording.entries) {
    if (e.screenshot) e.screenshot = `/runs/recordings/${recording.id}/${basename(e.screenshot)}`
  }
  return recording
}
```

`route()`의 `switch`에서 `default:` 위에 분기 추가:

```ts
      case '/api/record/start': {
        const id = nextRunId()
        const controller = await startRecording({
          url: String(body.url ?? ''),
          artifactsDir: join(RECORDINGS_DIR, id),
          ...(body.headless === true ? { headless: true } : {}),
        })
        recorders.set(id, controller)
        return { status: 200, body: { id, url: controller.url } }
      }
      case '/api/record/status': {
        const c = recorders.get(String(body.id))
        if (!c) return { status: 404, body: { error: 'no such recording (stopped?)' } }
        return { status: 200, body: { recording: rewriteRecShots(structuredClone(c.recording)) } }
      }
      case '/api/record/bug': {
        const c = recorders.get(String(body.id))
        if (!c) return { status: 404, body: { error: 'no such recording' } }
        await c.bug(typeof body.note === 'string' ? body.note : undefined)
        return { status: 200, body: { ok: true } }
      }
      case '/api/record/checkpoint': {
        const c = recorders.get(String(body.id))
        if (!c) return { status: 404, body: { error: 'no such recording' } }
        await c.checkpoint()
        return { status: 200, body: { ok: true } }
      }
      case '/api/record/stop': {
        const c = recorders.get(String(body.id))
        if (!c) return { status: 404, body: { error: 'no such recording' } }
        const recording = await c.stop()
        recorders.delete(String(body.id))
        return { status: 200, body: { recording: rewriteRecShots(structuredClone(recording)) } }
      }
      case '/api/record/extract': {
        const recording = await loadRecording(String(body.id))
        if (!recording) return { status: 404, body: { error: 'no such recording' } }
        const result = extractScenario(recording, {
          ...(typeof body.from === 'number' ? { from: body.from } : {}),
          ...(typeof body.to === 'number' ? { to: body.to } : {}),
        })
        return { status: 200, body: result }
      }
      case '/api/record/get': {
        const recording = await loadRecording(String(body.id))
        if (!recording) return { status: 404, body: { error: 'no such recording' } }
        return { status: 200, body: { recording: rewriteRecShots(recording) } }
      }
      case '/api/record/list': {
        const items = await listRecordings()
        return { status: 200, body: { items } }
      }
```

파일 하단(헬퍼 영역)에 추가:

```ts
async function loadRecording(id: string): Promise<RecordingSession | null> {
  const live = recorders.get(id)
  if (live) return structuredClone(live.recording)
  try {
    return await readTrail(join(RECORDINGS_DIR, id))
  } catch {
    return null
  }
}

async function listRecordings(): Promise<Array<{ id: string; url: string; startedAt: number; entries: number; bookmarks: number }>> {
  const { readdir } = await import('node:fs/promises')
  let ids: string[]
  try {
    ids = await readdir(RECORDINGS_DIR)
  } catch {
    return []
  }
  const out: Array<{ id: string; url: string; startedAt: number; entries: number; bookmarks: number }> = []
  for (const id of ids) {
    try {
      const r = await readTrail(join(RECORDINGS_DIR, id))
      out.push({ id: r.id, url: r.url, startedAt: r.startedAt, entries: r.entries.length, bookmarks: r.bookmarks.length })
    } catch {
      // skip dirs without a trail.json
    }
  }
  return out.sort((a, b) => b.startedAt - a.startedAt)
}
```

> 주의: `structuredClone`은 Node ≥17 전역. `basename`/`join`은 server.ts 상단에서 이미 import됨(현재 `import { basename, extname, join, normalize } from 'node:path'`). `RECORDINGS_DIR`는 기존 정적 서빙 `/runs/`(이미 `RUNS_DIR` 아래를 서빙)로 스크린샷이 그대로 제공된다. `startServer`의 `mkdir(RUNS_DIR, ...)` 다음 줄에 `await mkdir(RECORDINGS_DIR, { recursive: true })`를 추가한다.

`startServer` 안의 `await mkdir(RUNS_DIR, { recursive: true })` 아래에 추가:

```ts
  await mkdir(RECORDINGS_DIR, { recursive: true })
```

- [ ] **Step 2: 실패 테스트 작성 (HTTP e2e, headless + 자동 클릭 페이지)**

Create `src/web/record-routes.test.ts`:

```ts
import assert from 'node:assert/strict'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { before, describe, it } from 'node:test'
import { BrowserSession } from 'agrune'
import { startServer } from './server.js'

const manifest = {
  version: 3,
  groups: [{ groupId: 'app', targets: [{ targetId: 'go', name: 'Go', actionKinds: ['click'], selector: { css: '#go' } }] }],
}

// the page auto-clicks #go shortly after load, so the recorder captures an entry with no external input
function pageHtml(): string {
  return `<!doctype html><html><head><title>Auto</title></head><body>
<button id="go">Go</button>
<script>window.__agrune_manifest__ = ${JSON.stringify(manifest)};
setTimeout(function(){ document.getElementById('go').click(); }, 300);</script>
</body></html>`
}

async function serveApp(): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end(pageHtml())
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return { url: `http://127.0.0.1:${port}/`, close: () => new Promise<void>((resolve) => server.close(() => resolve())) }
}

async function post(base: string, path: string, body: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return { status: res.status, json: await res.json().catch(() => ({})) }
}

let available = true

describe('record routes (real chromium)', () => {
  before(async () => {
    const probe = new BrowserSession(true)
    try {
      await probe.start()
      await probe.stop()
    } catch {
      available = false
    }
  })

  it('start → status (captures auto-click) → extract → stop', async (t) => {
    if (!available) return t.skip('chromium unavailable')
    const app = await serveApp()
    const studio = await startServer({ port: 0 })
    try {
      const started = await post(studio.url, '/api/record/start', { url: app.url, headless: true })
      assert.equal(started.status, 200)
      const id = started.json.id as string
      assert.ok(id)

      // poll status until the auto-click is captured and mapped
      let mapped = false
      for (let i = 0; i < 60 && !mapped; i += 1) {
        const st = await post(studio.url, '/api/record/status', { id })
        mapped = (st.json.recording?.entries ?? []).some((e: any) => e.ref === 'go')
        if (!mapped) await new Promise((r) => setTimeout(r, 100))
      }
      assert.ok(mapped, 'expected the auto-click to be captured and mapped to ref "go"')

      const ex = await post(studio.url, '/api/record/extract', { id })
      assert.equal(ex.status, 200)
      assert.ok(ex.json.scenario, 'extract returns a scenario')

      const stopped = await post(studio.url, '/api/record/stop', { id })
      assert.equal(stopped.status, 200)
      assert.equal(stopped.json.recording.version, 1)
    } finally {
      await studio.close()
      await app.close()
    }
  })
})
```

> 참고: `startServer({ port: 0 })`는 임의 포트로 뜬다. 현재 `startServer`는 `opts.port ?? 4180`을 쓰므로 `port: 0`이면 OS가 빈 포트를 배정하고, 반환된 `url`은 `http://127.0.0.1:0`이 되어 잘못된다. **이 테스트가 통과하려면** `startServer`가 실제 바인드된 주소를 반환해야 한다 — Step 1에서 `startServer`의 url 계산을 `const addr = server.address(); const actualPort = typeof addr === 'object' && addr ? addr.port : port; const url = \`http://${host}:${actualPort}\`` 로 바꾼다(아래 보강 스텝).

- [ ] **Step 3: `startServer` 실제 포트 반환 보강**

`src/web/server.ts`의 `startServer`에서 url 계산부를 교체:

```ts
  await new Promise<void>((resolve) => server.listen(port, host, resolve))
  const addr = server.address()
  const actualPort = typeof addr === 'object' && addr ? addr.port : port
  const url = `http://${host}:${actualPort}`
```

- [ ] **Step 4: 빌드 + 실행 → RED**

Run: `pnpm run build && node --test dist/web/record-routes.test.js`
Expected: FAIL (라우트 미구현 시 404, 또는 포트 보강 전 연결 실패). Step 1·3 구현 후 진행.

- [ ] **Step 5: 빌드 + 실행 → GREEN**

Run: `pnpm run build && node --test dist/web/record-routes.test.js`
Expected: PASS (1 test; chromium 가용 시).

- [ ] **Step 6: 전체 회귀 확인**

Run: `pnpm run test`
Expected: 기존 + 신규 테스트 전부 PASS(또는 chromium 없으면 해당 통합 테스트 skip).

- [ ] **Step 7: Commit (사용자 승인 후)**

```bash
git add src/web/server.ts src/web/record-routes.test.ts
git commit -m "feat(record): web API routes for recording (start/status/bug/checkpoint/stop/extract/list/get)"
```

---

### Task 9: 웹 UI — Recorder 패널

**Files:**
- Modify: `web/app.js` (NAV 항목 추가, `panels.recorder` 추가, 폴링 헬퍼)

**Interfaces:**
- Consumes (HTTP): Task 8의 `/api/record/*`.
- Produces: 사이드바 Recorder 패널 — URL + [녹화 시작] → 라이브 타임라인(폴링) + [버그다!]/[체크포인트]/[정지] + 각 엔트리 진단(콘솔/네트워크/스크린샷) + [시나리오 추출] → 추출 결과를 Scenarios 패널 텍스트박스로 보냄.

> 참고: `web/app.js`는 바닐라 JS이며 이 저장소에 자동 테스트가 없다(기존 패턴 일치). 검증은 수동 단계로 한다.

- [ ] **Step 1: NAV에 Recorder 추가**

`web/app.js`의 `NAV` 배열에서 `['scenarios', ...]` 다음 줄에 추가:

```js
  ['recorder', '⏺', 'Recorder'],
```

- [ ] **Step 2: 폴링 헬퍼 + Recorder 패널 추가**

`web/app.js`의 `const panels = {` 안, `scenarios: {...},` 블록 바로 다음에 추가:

```js
  recorder: {
    title: 'Flight Recorder',
    desc: 'QA 모드 창을 띄워 행동·콘솔·네트워크·스크린샷을 블랙박스로 캡처하고, 버그 순간을 박제해 시나리오로 추출합니다.',
    render(c) {
      const out = h('div', {})
      const startBtn = h('button', { class: 'btn' }, '녹화 시작')
      startBtn.onclick = async () => {
        busy(startBtn, true)
        try {
          const r = await api('/api/record/start', { url: state.url })
          recorderSession(out, r.id)
        } catch (e) { out.replaceChildren(h('div', { class: 'err' }, e.message)) }
        finally { busy(startBtn, false) }
      }
      c.append(
        h('div', { class: 'card' },
          h('div', { class: 'row' }, urlField(), h('div', { style: 'align-self:flex-end' }, startBtn)),
          h('p', { class: 'muted', style: 'margin:10px 0 0' }, '시작하면 QA 모드 브라우저 창이 뜹니다. 그 창에서 평소처럼 앱을 조작하세요. 캡처는 이 창 동안에만 일어납니다.'),
        ),
        h('div', { class: 'card', style: 'margin-top:20px' }, out),
      )
    },
  },
```

`// ---- helpers ---------------------------------------------------------------` 위(패널 객체 닫는 `}` 다음)에 세션 컨트롤러 함수 추가:

```js
// ---- recorder session (live polling) --------------------------------------
function recorderSession(out, id) {
  let polling = true
  const timeline = h('div', { class: 'steps' })
  const status = h('div', { class: 'muted' }, 'recording… (창에서 앱을 조작하세요)')
  const bugBtn = h('button', { class: 'btn sm', style: 'background:#f85149' }, '버그다!')
  const cpBtn = h('button', { class: 'btn sm ghost' }, '체크포인트')
  const stopBtn = h('button', { class: 'btn sm ghost' }, '정지')
  const extractBtn = h('button', { class: 'btn' }, '시나리오 추출')
  const extractOut = h('div', {})

  bugBtn.onclick = () => api('/api/record/bug', { id }).catch(() => {})
  cpBtn.onclick = () => api('/api/record/checkpoint', { id }).catch(() => {})
  stopBtn.onclick = async () => { polling = false; await api('/api/record/stop', { id }).catch(() => {}); status.textContent = 'stopped.' }
  extractBtn.onclick = async () => {
    busy(extractBtn, true)
    try {
      const r = await api('/api/record/extract', { id })
      extractOut.replaceChildren(
        h('div', { class: 'banner pass' }, h('b', {}, '추출됨'), ` ${r.scenario.steps.length} steps`),
        r.gaps.length ? h('div', { class: 'banner warn', style: 'margin-top:8px' }, `${r.gaps.length} unmapped — 매니페스트에 추가해야 테스트로 박힙니다`) : null,
        h('div', { class: 'row', style: 'margin-top:10px' }, h('button', { class: 'btn sm', onclick: () => sendToScenarios(r.scenario) }, 'Scenarios로 보내기')),
        h('pre', { class: 'json', style: 'margin-top:10px' }, JSON.stringify(r.scenario, null, 2)),
      )
    } catch (e) { extractOut.replaceChildren(h('div', { class: 'err' }, e.message)) }
    finally { busy(extractBtn, false) }
  }

  out.replaceChildren(
    h('div', { class: 'row', style: 'justify-content:space-between' }, status, h('div', { class: 'row' }, bugBtn, cpBtn, stopBtn)),
    timeline,
    h('div', { class: 'row', style: 'margin-top:14px' }, extractBtn),
    extractOut,
  )

  async function tick() {
    if (!polling) return
    try {
      const r = await api('/api/record/status', { id })
      renderTimeline(timeline, r.recording)
    } catch { /* stopped */ }
    if (polling) setTimeout(tick, 1000)
  }
  tick()
}

function renderTimeline(container, recording) {
  const isBookmark = (i) => recording.bookmarks.includes(i)
  container.replaceChildren(...recording.entries.map((e) => {
    const mark = e.kind === 'action' ? (e.ref ? '✓' : '⚠') : e.kind === 'nav' ? '↪' : '★'
    const label = e.kind === 'action'
      ? `${e.action.do} ${e.ref ? e.ref : '(unmapped: ' + (e.action.rawTarget.css || e.action.rawTarget.tag) + ')'}${e.action.value ? ' = "' + e.action.value + '"' : ''}`
      : e.kind === 'nav' ? `nav → ${e.navUrl}` : e.kind === 'checkpoint' ? 'checkpoint' : (e.note || 'bookmark')
    const cls = e.kind === 'action' && !e.ref ? 'step skipped' : isBookmark(e.index) || (e.anomalies && e.anomalies.length) ? 'step fail' : 'step pass'
    const anomaly = e.anomalies && e.anomalies.length ? h('div', { class: 'detail' }, e.anomalies.map((a) => `${a.kind}: ${a.detail}`).join('; ')) : null
    const thumb = e.screenshot ? h('img', { src: e.screenshot, alt: label, style: 'width:90px;height:56px;object-fit:cover;object-position:top;border:1px solid var(--border);border-radius:6px;cursor:zoom-in', onclick: () => openLightbox(e.screenshot) }) : null
    return h('div', { class: cls },
      h('span', { class: 'mark' }, mark),
      h('div', { style: 'flex:1' }, h('div', { class: 'summary' }, `${e.index + 1}. ${label}`), anomaly),
      thumb,
    )
  }))
}

function sendToScenarios(scenario) {
  state.pendingScenario = scenario
  select('scenarios')
}
```

- [ ] **Step 3: Scenarios 패널이 보내진 시나리오를 받게 보강**

`web/app.js`의 `sampleScenario()` 함수를 수정 — 보내진 시나리오가 있으면 그것을 우선 사용:

```js
function sampleScenario() {
  if (state.pendingScenario) {
    const p = state.pendingScenario
    state.pendingScenario = null
    return p
  }
  const s = state.meta?.sample ? structuredClone(state.meta.sample) : { schema: 'agrune.scenario/v1', name: 'my scenario', manifest: { schemaVersion: 3 }, steps: [] }
  s.url = state.url
  s.name = 'demo flow'
  s.steps = [
    { do: 'click', ref: 'nav_board_tab', label: 'open board' },
    { do: 'click', ref: 'board_new_task_button', label: 'new task' },
    { do: 'fill', ref: 'wizard_title_input', value: 'Ship the catalog' },
    { assert: 'targetVisible', ref: 'wizard_title_input', label: 'wizard open' },
    { assert: 'noConsoleErrors' },
  ]
  return s
}
```

`state` 초기화에 `pendingScenario: null` 추가:

```js
const state = { url: 'http://127.0.0.1:4178', meta: null, panel: 'scenarios', pendingScenario: null }
```

- [ ] **Step 4: 수동 검증**

```bash
pnpm run build
# 데모 대상 앱
( cd ../demo && node demo-server.mjs & )
# 스튜디오
node dist/cli.js serve --port 4180
```
브라우저에서 `http://127.0.0.1:4180` → Recorder 패널 → URL `http://127.0.0.1:4178` → [녹화 시작].
확인:
1. QA 모드 Chrome 창이 뜨고 우하단에 REC 오버레이([버그다!]/[체크포인트])가 보인다.
2. 그 창에서 보드 탭·새 태스크 등을 클릭하면 대시보드 타임라인에 ✓(매핑됨)/⚠(unmapped) 엔트리 + 썸네일이 1초 폴링으로 쌓인다.
3. 오버레이 [버그다!] 클릭 → 타임라인에 ★ 북마크가 생긴다.
4. [시나리오 추출] → ref-only 시나리오 JSON + (있으면) unmapped 경고. raw 셀렉터(예: `#x`)가 스텝에 없어야 한다.
5. [Scenarios로 보내기] → Scenarios 패널 텍스트박스가 그 시나리오로 채워지고 Run하면 PASS/FAIL 리포트가 나온다.
6. [정지] → 캡처가 멈추고 `web/runs/recordings/<id>/trail.json`이 생긴다.

- [ ] **Step 5: Commit (사용자 승인 후)**

```bash
git add web/app.js
git commit -m "feat(record): Recorder dashboard panel (live timeline, extract → Scenarios)"
```

---

## Self-Review

**1. Spec coverage** (스펙 §3 목표 A/B/C/D 대응):
- A 항상 켜진 캡처(QA 모드): Task 6 capture.ts(헤디드 세션 계기화, addInitScript/exposeBinding) + Task 4 인페이지 스크립트. ✓
- B 버그 순간 북마크(자동+수동): Task 2 oracle(자동) + Task 4 오버레이 버튼/Task 6 bug()·checkpoint()(수동). ✓
- C 진단 뷰어: Task 9 타임라인 + 콘솔/네트워크/스크린샷 표시. ✓ (스크럽/상세 심화는 §15 가역 항목)
- D 시나리오 추출: Task 5 extract + Task 8 /api/record/extract + Task 9 [추출]/[Scenarios로 보내기]. ✓
- 비가역 ① ref-only(raw 금지): Task 5 + 테스트가 raw 셀렉터 부재를 단언. ✓
- 비가역 ② 코어 무변경 역매핑: Task 3 resolveTargetLocator 조합, 코어 파일 수정 없음. ✓
- 비가역 ③ version:1: Task 1 + 라운드트립 테스트. ✓
- 프라이버시(QA 모드 경계): Task 6 창 수명 = 세션, Task 9 안내 문구, REC 오버레이. ✓

**2. Placeholder scan:** 모든 스텝에 실제 코드/명령/기대출력 포함. "TODO/TBD" 없음. ✓

**3. Type consistency:** `RecordingSession`/`TimelineEntry`(Task 1)가 oracle/refmap/extract/capture/server에서 동일 이름으로 사용됨. `RefMatch.ref`(Task 3) → capture가 `match.ref`로 소비(Task 6). `ExtractResult{scenario,gaps}`(Task 5) → server `/extract`(Task 8) → UI(Task 9). `BINDING`/`CAPTURE_SCRIPT`(Task 4) → capture(Task 6). `startRecording`/`RecordController`(Task 6) → server(Task 8)·cli(Task 7). 일치 확인. ✓

**알려진 가역 한계(§15):** monkey 오라클과 record 오라클의 소폭 중복(추후 공유 모듈로 통합), 진단 뷰어 심화 UX, 폴링(1s) → SSE 전환, 캡처 정책(스크린샷/DOM 빈도) 튜닝, repeat-instance 타깃 역매핑 정밀화. 모두 만들면서 조정.
