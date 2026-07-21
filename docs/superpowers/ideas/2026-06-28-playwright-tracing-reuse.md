# Idea: Playwright tracing 재활용 (블랙박스 진단 레이어)

상태: **아이디어만 보류** (2026-06-28). 구현/플랜 미착수.

## 한 줄 결론
Flight Recorder의 진단 절반(개발자가 버그 원인 파헤치는 쪽)을 직접 만들지 말고
Playwright `context.tracing` + Trace Viewer에 위임. 추출·UI·리포팅은 자체 유지.

## 재활용 판정
- **Trace Viewer / `tracing` API — ✅ 강력 후보.** DOM 스냅샷 타임트래블 + 필름스트립 +
  네트워크 워터폴 + 소스 매핑을 `context.tracing.start({snapshots,screenshots,sources})`
  한 줄로 획득. 지금 우리가 *못* 하는 시간여행 재생이 공짜로 생김.
- **codegen — △ 개념만.** 셀렉터 랭킹(role>text>testId>css)은 코어 resolver 사다리와
  같은 아이디어라 이미 보유. 기계 자체는 raw 셀렉터에 묶여 ref 목표와 충돌 → 차용 안 함.
- **UI Mode — ❌.** `@playwright/test` 러너 종속. 원하는 슬라이버(시나리오 watch)는 자체 제작이 쌈.
- **HTML Reporter — ❌.** 러너 종속. 빌릴 건 "아티팩트 첨부" 개념뿐(trace.zip 첨부로 자연 해결).

## 잠금 결정과의 정합성
- 추출은 여전히 ref-only (결정①). trace.zip은 추출 소스가 아니라 버그 첨부 진단물.
- tracing은 context 레벨 → 코어 BrowserSession이 context 소유 → Studio가
  `browser.page().context().tracing` 조합. **"Studio 조합, 코어 무변경"(결정②) 패턴 그대로.**
- QA 무설치/프라이버시 유지: trace.zip을 *보는* 건 개발자, QA는 "버그다!"만 누름.

## 설계 메모: 2계층 캡처
- **상시 경량** = 현 JSON 트레일 (싸고 extraction + Studio 타임라인용; 사실상 우리 링버퍼 역할).
- **무거운 풀피델리티** = trace.zip (QA 모드 한정; stop 시 저장 또는 `startChunk/stopChunk`로
  "버그다!" 북마크당 청크 1개 = trace.zip 1개).
- 비용 긴장(snapshots 무겁고 Playwright엔 링버퍼 없음 → 원인은 보통 북마크보다 앞)은
  이 2계층으로 해소: 경량은 상시, 무거운 건 세션/북마크 경계에서만.

## 다음에 진행할 때
스펙 → 플랜으로 떠서 역매핑 때처럼 Studio 조합 / 코어 무변경으로 작업.
