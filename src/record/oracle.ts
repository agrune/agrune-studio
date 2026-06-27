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

export function pollOracle(browser: BrowserSession, tracker: OracleTracker, crashed?: string): OracleHit[] {
  return detectHits(countConsoleErrors(browser), countNetworkFailures(browser), tracker, crashed)
}
