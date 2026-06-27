# Agrune Studio — Flight Recorder (블랙박스) 설계

- 상태: 설계 승인 대기 (브레인스토밍 산출물)
- 날짜: 2026-06-27
- 관련: Studio SPEC §10 오픈 퀘스천 #2 ("typed step list vs. live-session recorder vs. both — decide before Phase 1"), PLAN.md Q2("recorder later"), PLAN.md "repro capture → candidate scenario"

## 1. 한 줄 요약

QA 모드를 켠 동안에만, Studio가 띄운 계기판 브라우저 창에서 일어나는 모든 행동·콘솔·네트워크·스크린샷을 타임라인 블랙박스로 캡처한다. 버그를 만난 순간(자동 오라클 또는 수동 버튼)을 북마크하면, 그 직전까지의 전 과정이 이미 잡혀 있어 **0초 재현**이 된다. 캡처한 트레일은 매니페스트 ref 기반의 **결정론적 회귀 시나리오**로 추출해 기존 Scenarios/Repair로 연결한다.

## 2. 문제 / 동기

- 손으로 ref를 적어 시나리오를 작성하는 현재 흐름은 가치가 낮다.
- 진짜 통증: QA·개발 중 "어? 버그다" 하고 만난 버그를 **재현하느라 시간을 태운다**. 어떻게 발동됐는지 기억이 안 난다.
- 해법: 버그가 터질 당시의 액션열 + 개발자도구(콘솔)·네트워크·DOM·스크린샷 상태를 **블랙박스처럼 계속 들고 있다가** 그 순간을 박제한다.
- "녹화 → 테스트"는 이 블랙박스의 특수 케이스(세션 전체를 테스트로 추출)일 뿐이다.

## 3. 목표 / 비목표

**목표 (v1, 빅뱅)**
- A. 항상 켜진 캡처 엔진 — 액션(+ref) · 콘솔 · 네트워크 · 스크린샷/DOM을 타임라인 버퍼링 (QA 모드 한정)
- B. 버그 순간 북마크 — 오라클 자동 + 수동 "버그다!" 버튼
- C. 진단 뷰어 — 타임라인 스크럽, 각 시점의 콘솔/네트워크/DOM/스크린샷 (0초 재현)
- D. 시나리오 추출 — 트레일 구간 → 결정론적 ref 시나리오 + 단언 → 기존 Scenarios/Repair 연결

**비목표 (나중)**
- 두 번째 표면: 유저 자신의 Chrome 확장 (v1은 Studio가 띄운 창 한 표면만)
- 의미론적 정확성 오라클 (v1은 크래시/콘솔/네트워크 오라클만)
- 실시간 협업 편집, 트레일 원격 공유

## 4. QA 모드 (1급 개념 · 프라이버시 경계)

- 캡처는 **명시적 QA 모드 세션 동안에만** 일어난다. 설치만으로 도는 백그라운드 감시는 없다.
- v1에서 **Studio가 띄운 계기판 창의 수명 = QA 모드 세션**. 창이 곧 경계라 캡처가 자연히 창 수명에 묶인다.
- 계기판 창에는 **REC 오버레이**가 떠서 캡처 중임이 항상 눈에 보인다(몰래 캡처 금지).
- QA 모드 종료(창 닫기/정지) → 캡처 중단, 트레일을 녹화 아티팩트로 저장.
- 미래의 확장 표면에서도 QA 모드는 **명시적 토글**이지 상시 감시가 아니다.

## 5. 아키텍처 / 데이터 흐름

```
Studio 웹 서버 (기존 Node http)
   │  POST /api/record/start {url}
   ▼
core BrowserSession (headless=false → 데스크톱에 실제 창)
   │  ① addInitScript: 모든 페이지에 캡처 스크립트 + REC 오버레이 주입 (네비게이션마다 재주입)
   │  ② exposeBinding: __agruneRecord(evt) → Node 콜백
   ▼
유저가 그 창에서 평소처럼 클릭/입력  ←─ QA 모드 동안 항상 캡처
   │  캡처 스크립트: click/input/change/submit/navigation 가로채기
   │     → 맞은 요소에 nonce(data-attr) 찍고 → 디스크립터를 binding으로 전송
   ▼
서버 이벤트 인테이크 (매 이벤트):
   · session.snapshot() → 선언 타깃 목록
   · refmap: nonce 요소 ↔ 매니페스트 ref 역매핑 (코어 resolveTargetLocator 조합)
   · console/network 델타 수집 (BrowserSession이 이미 추적)
   · 스크린샷 1장
   · TimelineEntry append
   ├─ 오라클: 콘솔에러/pageerror/네트워크실패/크래시 → 자동 북마크
   └─ 오버레이 [버그다!]/[체크포인트] 버튼 → 수동 북마크/단언
   ▼
대시보드 Recorder 패널 (폴링/SSE):
   라이브 타임라인 + 북마크 + 진단 뷰어 + [시나리오 추출] → 기존 Scenarios 패널로
```

**두 갈래 데이터**
1. 블랙박스(진단): 모든 이벤트가 raw하게 타임라인에 쌓임(매니페스트 밖 클릭 포함). **로컬 진단 산출물**, 배포물 아님.
2. 추출(테스트): 타임라인 구간 → 매니페스트 ref 기반 결정론적 시나리오. **배포 가능한 순수 데이터**.

**왜 이 구조**
- 헤디드 창은 기존 `BrowserSession(headless=false)` 재사용 → 새 인프라 0.
- `addInitScript`+`exposeBinding`이라 SPA 라우팅/네비게이션을 넘어 캡처가 살아남음.
- 콘솔/네트워크는 코어가 이미 잡음(§5.6 per-page recorders).
- 두 번째 표면(Chrome 확장)은 "이벤트→refmap→timeline" 코어에 어댑터만 갈아끼우면 됨.

## 6. 데이터 모델

블랙박스 = `RecordingSession` (로컬 진단 산출물):

```
RecordingSession {
  version: 1,                       // ← 온디스크 포맷 진화 대비 (비가역 변동점 ③ 해소)
  id, startedAt, url,
  manifest: { schemaVersion, origin?, appVersion? },   // 추출 시 핀
  entries: TimelineEntry[],
  bookmarks: number[],              // anomaly/수동 인덱스
}

TimelineEntry {
  index, t,                         // 세션 시작 기준 상대 ms
  kind: 'action' | 'nav' | 'bookmark' | 'checkpoint',
  action?: { do, value?, rawTarget },  // rawTarget = tag/role/name/text/testid/csspath
  ref: string | null,               // 역매핑된 targetId (실패 시 null)
  refMeta?: { rung, confidence },   // 어느 셀렉터 사다리 단으로 잡혔나
  console: ConsoleMessageEntry[],   // 직전 이후 델타 (코어 타입 재사용)
  network: NetworkRequestSummary[], // 직전 이후 델타 (코어 타입 재사용)
  screenshot: string,               // /runs/recordings/<id>/step-NN.png
  dom?: string,                     // 북마크/anomaly에서만 (무거우니)
  anomalies?: OracleHit[],          // 콘솔에러/네트워크실패/크래시
  note?: string,                    // 수동 버그 메모
}
```

- 저장: `web/runs/recordings/<id>/` 에 `trail.json` + `step-NN.png` (기존 `.gitignore`의 `web/runs/`가 커버).
- 캡처 정책(v1 기본, 조정 가능): 액션마다 스크린샷+콘솔/네트워크 델타. DOM 스냅샷은 북마크/anomaly에서만. 항목 수 상한 + 도달 시 **경고**(조용히 자르지 않음).

## 7. 역매핑 (element → ref) — 코어 권위 유지

- 캡처 스크립트가 맞은 요소에 `data-agrune-hit="<nonce>"`를 찍는다.
- Studio가 각 선언 타깃을 **코어 `resolveTargetLocator`**(필요 시 `findTargetLocator`)로 해석하고, 그 로케이터가 nonce 요소를 가리키는지 확인 → 일치하는 targetId가 ref. 타깃 목록은 `session.snapshot()`/`refreshSnapshot`에서 얻는다.
- 셀렉터 권위(resolveTargetLocator)는 코어에 그대로. Studio는 매칭 로직을 새로 짜지 않고 코어 공개 API를 **조합**만 한다 → 드리프트 없음, **코어 무변경**. (검증: `resolveTargetLocator`/`findTargetLocator`/`refreshSnapshot`/`buildSnapshotFromManifest` 모두 코어 `api.ts`에서 이미 export됨.)
- 일치 타깃 없음 → ref=null(unmapped). 블랙박스에는 raw 디스크립터로 남겨 진단은 가능. 추출 시 갭으로 처리(§9).
- 모호(복수 매칭) → 가장 구체적인/첫 사다리 단 선택 + 낮은 confidence 플래그.

## 8. 오라클 / 북마크

- monkey의 오라클 신호 재사용: 콘솔 error, pageerror(uncaught), 네트워크 실패/비2xx(임계 설정), 크래시.
- 감지 시 가장 가까운 TimelineEntry에 anomaly 표시 + 북마크 생성.
- 수동 [버그다!] → 메모 가능한 북마크. [체크포인트] → 그 시점 단언 삽입(§9).
- 가능하면 monkey와 recorder가 공유하는 오라클 모듈로 추출(리팩터, 가역).

## 9. 시나리오 추출 (트레일 → 테스트)

- 구간 선택: 세션 전체 / 시작~북마크 / 두 지점 사이.
- 액션 엔트리 변환:
  - **매핑됨** → `{ do, ref, value }` 스텝.
  - **unmapped** → 스텝으로 **안 박음**. 대신 "매니페스트에 추가 필요" **갭 목록**으로 보여줌. (비가역 결정 ① — raw 셀렉터 스텝 금지, 시나리오 ref-only 순수 유지.)
- 단언(유저 선택: 체크포인트 + 자동추론):
  - 체크포인트로 찍은 지점 → 해당 ref/상태 단언.
  - 네비게이션 후 → `urlContains` 자동 제안.
  - 마지막 상호작용 타깃 → `targetVisible` 자동 제안.
  - anomaly 북마크 구간 → `noConsoleErrors`/`networkStatus` 단언 제안(기대 정상 상태).
  - 모두 **닫힌 enum** 단언만 사용. 유저가 검수 후 확정.
- 산출 = `agrune.scenario/v1` 문서 → 기존 `validateScenario`로 검증 → Scenarios 패널 텍스트박스로 주입 → Run/Repair로 연결.
- 결과 루프: 블랙박스 → repro 시나리오 → 결정론적 재생 → 셀렉터 드리프트 시 자가복구.

## 10. 인바리언트 준수 (핵심)

- **AI는 실행에 안 들어감**: recorder는 순수 캡처/계기화. 추출 후 재생은 결정론적. AI 없음.
- **배포 아티팩트는 순수 데이터 + 서명**: 블랙박스는 로컬 진단물(배포 X)이라 raw 디스크립터 보관 가능. 추출된 시나리오만 순수 ref-only 데이터.
- **매니페스트 진실은 코어 소유, Studio는 import만**: 역매핑은 코어 resolveLocator 조합, 검증기/셀렉터 정책 복제 없음, 코어 무변경.
- **단언은 닫힌 enum, 임의 코드 없음**: 추출 단언은 기존 enum만.
- **publish 닫힘 / consume 열림**: recorder는 작성-시점 로컬 기능이라 영향 없음.
- **프라이버시**: 캡처는 QA 모드 한정, 상시 감시 없음, REC 오버레이로 가시화.

## 11. 컴포넌트 / 파일 (Studio)

엔진:
- `src/record/inject.ts` — 인페이지 캡처 스크립트 + REC/버튼 오버레이(문자열, addInitScript로 주입). 이벤트 후킹, nonce 태깅, binding 전송. 오버레이는 shadow DOM/고z-index, 역매핑에서 제외.
- `src/record/refmap.ts` — 역매핑(nonce 요소 → targetId), 코어 resolveTargetLocator/findTargetLocator + snapshot 조합.
- `src/record/oracle.ts` — anomaly 감지 (monkey 오라클 공유/재사용).
- `src/record/trail.ts` — RecordingSession/TimelineEntry 타입 + 영속화(trail.json+png) + 로드.
- `src/record/capture.ts` — BrowserSession(headed) 계기화: addInitScript+exposeBinding+오버레이, 이벤트 인테이크, 스크린샷/콘솔/네트워크 수집, 타임라인 조립.
- `src/record/extract.ts` — 트레일 → 시나리오(+단언 추론, 체크포인트, unmapped 갭 처리).
- `src/record/cli.ts` — `agrune-studio record --url ...` 헤디드 녹화 세션 시작.

웹:
- 서버 라우트: `/api/record/start|stop|status|list`, `/api/record/:id`, `/api/record/:id/extract`. 녹화 스크린샷 서빙(`/runs/recordings/...`).
- UI: app.js에 **Recorder 패널** 추가(시작 폼: URL / 라이브 타임라인 / 북마크 / 진단 뷰어 / [추출] → Scenarios 패널 채움). NAV에 항목 추가.

리팩터(가역): monkey 오라클을 공유 모듈로 추출해 recorder와 공용.

## 12. 에러 처리

- 헤디드 브라우저 기동 실패 / 유저가 중간에 창 닫음 → graceful stop, 그때까지 트레일 저장.
- 역매핑 모호 → 가장 구체적 선택 + candidates/낮은 confidence 기록.
- 오버레이는 절대 액션으로 캡처되지 않음(오버레이 shadow root 내 이벤트 제외, nonce 제외).
- 대용량 세션 → 항목 상한 + 경고(무음 절단 금지).
- exposeBinding/addInitScript는 네비게이션마다 재적용되어 SPA 라우팅에서 생존.

## 13. 테스트

- 단위: refmap(스냅샷+디스크립터 → 올바른 ref, unmapped 시 null), extract(트레일 → 기대 시나리오, 단언 추론, unmapped 갭 처리), trail 영속 라운드트립, oracle 감지.
- 통합: BrowserSession을 데모 앱에 대해 (CI는 headless로) 계기화 → 프로그램적으로 클릭 디스패치 → 타임라인/스크린샷/ref매핑 검증 → 추출 → 추출 시나리오 실행 → PASS. (헤디드 창은 UX 표면일 뿐, 계기화는 headless에서도 동작.)

## 14. 잠긴 비가역 결정 (요약)

1. **추출 순수성**: unmapped 액션은 갭으로 표시, **raw 셀렉터 스텝 금지**. 시나리오 ref-only 순수 유지.
2. **역매핑 위치**: Studio가 코어 `resolveTargetLocator`/`findTargetLocator`/snapshot을 조합, **코어 무변경**. 셀렉터 권위는 코어.
3. **온디스크 포맷**: `RecordingSession.version: 1`로 진화 대비. 추출물은 기존 `agrune.scenario/v1`.

## 15. 만들면서 조정할 (가역) 항목

- 진단 뷰어 UX 상세, 단언 추론 휴리스틱 강도, 라이브 전송 방식(폴링 vs SSE), 캡처 정책(스크린샷/DOM 빈도·링버퍼), 오라클 임계값, monkey 오라클 공유 리팩터 범위.
