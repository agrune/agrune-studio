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
  action?: { do: ActionVerb; value?: string; secretRef?: string; rawTarget: RawTarget }
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

export function createRecordingSession(id: string, url: string, startedAt: number): RecordingSession {
  return { version: 1, id, startedAt, url, manifest: { schemaVersion: 3 }, entries: [], bookmarks: [] }
}

/** 다음 인덱스/시간을 채워 엔트리를 추가하고, 그 엔트리를 반환한다. */
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
