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
