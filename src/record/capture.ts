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
