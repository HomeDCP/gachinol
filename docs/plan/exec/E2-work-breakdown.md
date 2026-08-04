# E2. 작업 분해 — W0~W4 태스크 표

> 근거: [EXEC-PLAN.md](EXEC-PLAN.md) G1~G9, [reviews/EXEC-RUBRIC.md](reviews/EXEC-RUBRIC.md) 영역 1·3,
> 범위의 정본: [02-web-architecture.md](../02-web-architecture.md) §E(체크리스트 0~24번 전건),
> [08-rollout-transition.md](../08-rollout-transition.md) §A(W0~W4·시간축 매핑·DoD)·§E, 04 §H-1(R10 인용 부분)·03 §C-5(D-T9 인용
> 부분)·06 §F-6(문의하기 인용 부분). **범위**: 본 문서는 "무엇을·누가·어떤 산출물로"만 정의한다 — 순서·웨이브·병렬
> 배치는 [E3](E3-parallel-schedule.md)가, 모델·토큰 배분은 [E4](E4-token-budget.md)가, 완료 판정 절차는
> [E5](E5-quality-gates.md)가 소유한다(신규 범위 발명 금지, EXEC-PLAN 서두 원칙과 동일).
>
> **라운드 1 수정**: [reviews/EXEC-EVAL-ROUND-1.md](reviews/EXEC-EVAL-ROUND-1.md) 영역 1·3 감점 전건 +
> [reviews/EXEC-ROUND-1-DECISIONS.md](reviews/EXEC-ROUND-1-DECISIONS.md) D2·D4·D6·D7·D10 반영. 변경 이력은 각 절에
> "(EVAL-ROUND-1 ...)" 각주로 표기, 재해석 없이 DECISIONS 확정 문안을 인용만 한다.
>
> **라운드 2 수정**: [reviews/EXEC-EVAL-ROUND-2.md](reviews/EXEC-EVAL-ROUND-2.md) 영역 1 감점 1~4·영역 3 감점 1~3 +
> [reviews/EXEC-ROUND-2-DECISIONS.md](reviews/EXEC-ROUND-2-DECISIONS.md) DD1(T-W1-07 분할)·DD2(`playwright.config.ts`
> 앱별)·DD3(W4 DoD 문안)·DD4(T-NC-08·09 담당)·DD5(17모듈·T-NC 15건) 반영. "(EVAL-ROUND-2 ...)" 각주로 표기.

## 0. 비범위 선언 (신규 범위 발명 금지 자체 검증)

- **T-AI(실 STT/비전 제공자 주입·`auto_edit`)**: 08 §A "T-AI 병렬 트랙과의 관계"가 명시적으로 W0~W4 DoD 밖이라 선언한
  트랙이다 — 본 문서에 태스크를 만들지 않는다.
- **커머스 2단계(자체 결제 구축)**: 08 §A "커머스 2단계 트랙과의 관계"가 트리거 충족 시 별도 착수라 선언했다 —
  본 문서는 트리거 **월 1회 리뷰**(08 §E 9번, 코드 외 태스크로 등재)만 다루고 결제 구축 자체는 다루지 않는다.
- **04 문서 자체 소유 항목**(리허설 역할표·백업회선 조달·이중 인코더 결정 등, 04 §H-1 게이트 R1·R2·R12·리허설
  배정표): 08 §A/§E·02 §E 어디에도 이 항목들을 실행 체크리스트로 위임하지 않았다 — 04가 자체 소유·자체 실행 체크리스트를
  갖고 있으므로(04 §H "실행 체크리스트(본표)") 본 문서에서 재정의하지 않는다. **단, 04 R10(CF Stream 실계정
  연동)만은 08 §A W2 DoD 행이 명시적으로 인용**("Cloudflare Stream Live Input 발급·상태 조회 동작 확인(04 R10)")하므로
  이 1건에 한해 §C-W2에 태스크로 편입한다.
- **05 §G 재무 트리거·05 §C 전면 전환 트리거의 수치 자체**: 08 §C·§E 8·9번이 "인용만" 한다고 명시한 대로, 본 문서도
  수치를 재정의하지 않고 08의 인용을 그대로 따른다(코드 외 태스크 절 T-NC-11·T-NC-12).

**네이티브 트랙 즉시 동결(DDD7 확정 문안, EVAL-ROUND-3 영역1 감점3·Z-3 — 상시 제약으로 승계, 1회 완결 태스크가
아님)**: 08 §D "전환 중 이중 유지보수" 행 원문 — 완화책 "네이티브는 **즉시 동결**(버그픽스도 웹에서만) — W4까지
Expo Go는 개발 편의로만", 담당 "기획(PM)", 발동 트리거 "**피벗 승인 즉시**". **본 실행계획 승인과 동시에
발효한다**: 전환 기간(W0~W3) 중 `apps/{reporter,control-center,subscriber}` 네이티브 코드에 **신규 기능 커밋
금지**, 버그 수정은 **웹 전환 완료 전 치명 결함**에 한한다(예: 앱스토어 강제 업데이트 요구·보안 취약점). 이
제약은 W4의 어느 특정 태스크에도 속하지 않고 W0 착수 시점부터 W4 종료까지 상시 적용된다 — 준수 확인은 E5 §E
진행 보고 5항(게이트 상태)의 "네이티브 동결 준수(네이티브 트랙 신규 커밋 0건 — `git log` 확인)" 항목이 매
웨이브 종료 보고마다 담당한다(E5 소관, 본 문서는 제약 선언만 소유).

## A. 태스크 크기 기준 (G2)

**정의**: 1태스크 = **서브에이전트 1회 기동으로 구현+테스트+자가 검증까지 완결되는 단위**(E5 §A 게이트① 1회 실행
범위와 1:1 대응). 크기 상한은 **수정 파일 ≤10개 대략** — 절대 규칙이 아니라 "이 이상이면 분할을 먼저 검토하라"는
신호다. 아래 3가지는 **분할 예외**(초과해도 분할하지 않는 근거를 명시하는 조건)로 인정한다:

1. **게이트 완결성**: 두 하위 작업을 분리하면 어느 쪽도 단독으로 상위 문서의 완료 조건(DoD)을 충족하지 못하는 경우
   (예: `packages/ui` 토큰 — "스키마 반영만으로는 게이트가 닫히지 않는다", 02 §E 1번). 이 경우도 **내부적으로는
   스키마 정의/소비 전환 두 단계로 순서를 분리**해 자가 검증을 단계별로 받되, 태스크 ID·완료 선언은 하나로 묶는다.
2. **기계적 반복 패턴**: 동일 패턴(예: import 경로 교체)이 여러 파일에 반복될 뿐 파일별 판단 분기가 없는 경우
   (예: 디자인 토큰 소비 전환 — 앱당 11~21개 파일이지만 전부 `theme.ts` → `packages/ui` 토큰 import로 교체하는
   동일 작업). 분할 비용(태스크 조정·컨텍스트 재구축)이 병렬화 이득보다 크다고 판단해 앱 단위 1태스크로 유지한다.
3. **원자적 DB 마이그레이션**: Prisma 스키마 변경 + 그 스키마를 사용하는 최소 엔드포인트 세트는 분리 배포 시
   깨진 중간 상태(마이그레이션만 있고 소비 코드가 없는 상태, 또는 반대)를 만들므로 분리하지 않는다.

**분할 기본값**: 위 3예외에 해당하지 않는 한, 서로 다른 워크스페이스(`apps/*` vs `services/api` vs `packages/*`)에
걸치는 작업은 **워크스페이스 경계에서 분할**한다(예: 02 §E 16번 계측 파이프라인 → 클라이언트 로깅 태스크 + 서버
집계 엔드포인트 태스크 2개). 이는 파일 소유권 배타 병렬(G3)과도 정합한다 — 워크스페이스 경계 분할은 곧 파일
소유권 경계 분할이다.

**파일 소유권 명시 원칙(EVAL-ROUND-3 영역3 감점1·Z-8 신설)**: **계획 시점에 비교 가능한 파일 집합이 존재해야
E3의 웨이브 배타 근거가 검증 가능하다** — 소속 앱조차 특정되지 않은 파일 소유권 서술("~화면(신규 1~2)")은
E3가 동일 웨이브 타 태스크와의 배타를 문서만으로 판정할 수 없게 만든다. 모든 태스크는 최소 1개의 **예상 경로**
(expo-router 규약·기존 모듈 구조에서 합리적으로 추론 가능한 구체 경로)를 파일 소유권 열에 기재한다 — §G 리스크
2행의 "착수 직전 조율자 실측 grep 재확인"은 이 예상 경로를 갱신하는 절차이지, 예상 경로 자체를 생략해도 되는
근거가 아니다.

## B. 담당 역할 표기 — 원문 표기 → E1 역할군 사상

02·04·08의 "담당" 표기는 마스터플랜 수립 당시(실행계획 이전) 문서라 E1이 정의하는 6개 상근 역할군(FE 리드·BE
리드·인프라 담당·QA 리드·PMO·법무/운영 지원, [E1](E1-agents-org.md) G1)과 어휘가 다르다. 아래 표로 1회 사상한다
— 이후 태스크 표의 "담당" 열은 **사상된 E1 역할군만** 사용한다(원문 표기 재정의 아님, 어휘만 통일).

| 원문 표기 | E1 역할군 사상 | 근거 |
|---|---|---|
| FE 리드 | FE 리드 | 그대로 |
| BE 리드 | BE 리드 | 그대로 |
| 인프라 담당 | 인프라 담당 | 그대로 |
| 디자인시스템 담당(FE 리드 겸) | FE 리드 | 원문이 이미 겸임 명시(02 §B `packages/ui` 행) |
| 미디어 워커 담당(BE 리드 겸) | BE 리드 | 원문이 이미 겸임 명시 |
| **테크리드** | 태스크 성격별 분리 — ① CI/E2E/번들예산·installability 등 **구현이 필요한 것**은 FE 리드가 구현하고 조율자가 승인 ② 스토어 심사 제출·문서 정리·횡단 결정 등 **판단·제출 행위**는 조율자 | **E1 §A-1 공식 채택 완료(라운드 1) — CI 설정은 태스크 성격별 다중 소유·SOLO 웨이브 시점 배타(E1 §A-1 확정 문안 인용)** |
| PO | 태스크 성격별 분리 — 대외 신청(스토어 계정·Meta 심사)은 법무/운영 지원, 사업 판단 동반은 PMO | 07·08이 정의한 대외 절차형 업무 |
| 기획(PM) | 조율자 | PIVOT-PLAN·EXEC-PLAN에서 "기획(PM)"은 실행계획의 "조율자(PM)"와 동일 인물·동일 권한선(G1) |
| 사업총괄 | PMO(정기 리뷰) 또는 조율자 에스컬레이션(1회성 확인) | 재무·행정 판단 |
| 센터 운영 | 법무/운영 지원 | 비개발 현업 운영(게시 절차·URL 게시 등) |
| 현장 PD | (본 문서 비범위 — 04 §H 자체 소유, 위 §0 참조) | — |

## C. W0~W4 태스크 표

**공통 검증자 표기**: 별도 명시가 없는 한 모든 코드 태스크의 검증자는 **qa-verifier**(E5 §A 게이트②, 자가검증
로그 재신뢰 금지·AC 1개 이상 독자 재현)이며, `packages/shared`·Prisma 스키마·CI 설정·`packages/ui` 변경 태스크는
qa-verifier 통과 후 게이트③ **루트 전체 회귀**(`pnpm test`·`pnpm typecheck`, E5 §B)를 추가로 거친다 — 회귀 주체는
**QA 리드가 실행하고 조율자가 결과만 수신**한다(E5 §A 게이트③ 확정 문구 인용, EXEC-EVAL-ROUND-1 영역7 감점2 수정
반영 — E5 신규 위임 #6·대장 6-11 #12). **[SOLO]** 표기는 G3 단독 슬롯 대상(파일 소유권 열에 근거 명시) — 웨이브
배정은 E3가 정의한다.

### W0. 기반

| ID | 원천 | 담당 | 파일 소유권 | 산출물 | DoD(정본 인용) | 검증자 |
|---|---|---|---|---|---|---|
| T-W0-01 | 02§E-2 | BE 리드 | `services/api/src/auth/*`(`auth.controller.ts`·`auth.service.ts`·`auth.module.ts` 확장), `services/api/src/main.ts`(CORS 설정) | 쿠키 refresh 경로(바디 방식과 병행)·CSRF 가드·`WEB_ORIGINS` env 화이트리스트 | 02§E-2 "api: `WEB_ORIGINS` CORS + 쿠키 refresh 병행 경로 + CSRF 가드 (기존 테스트 무회귀)" | qa-verifier |
| T-W0-02 | 02§E-3 | 인프라 담당 | `infra/docker-compose.yml`(MinIO CORS 블록), `infra/scripts/r2-cors.ts`(신규, 경로 확정 — EVAL-ROUND-1 영역3 감점3) | R2·MinIO PUT/GET 오리진 화이트리스트 정책 | 02§E-3 "R2·MinIO 버킷 CORS 정책(PUT/GET 오리진 화이트리스트)" | qa-verifier |
| T-W0-03 | 02§E-6(W0분)·02§D-T5, 08§E-2(rollup 인용) | 인프라 담당 | `infra/docker/docker-compose.xeon.yml`(수정, `web` 서비스 블록), `infra/docker/nginx.conf`(신규), `infra/docker/Dockerfile.web`(신규) | nginx `web` 정적 서빙 컨테이너 + Cloudflare 존·프록시·캐시 규칙 골격 + 서브도메인 5종(`watch.`·`go.`·`reporter.`·`center.`·`api.`) vhost 기본틀 (동적 라우트 rewrite는 T-W1-06으로 분리 — nginx 초기 골격에서는 정적 자산만) | 02§E-6 "제온 nginx `web` 서비스 + Cloudflare 존·프록시·캐시 규칙 + 서브도메인 5종 ... 기한: W0(기본 nginx/CF 골격)" | qa-verifier |
| T-W0-04 | 08§E-3 | 인프라 담당 | `infra/backup/pg-dump-to-r2.sh`(신규)·`infra/backup/crontab`(신규)·`infra/monitoring/uptime-kuma-config.yml`(신규)(경로 확정 — EVAL-ROUND-1 영역3 감점3, "또는" 표기 제거) | PG→R2 일일 덤프 파이프라인 + Uptime Kuma + 외부 업타임 체크 | 08§E-3 "백업 파이프라인(PG→R2 일일) + Uptime Kuma + 외부 업타임 체크" | qa-verifier(백업 산출물 실제 R2 도달 확인 1회 포함) |
| T-W0-05 **[SOLO]** | 02§E-0 | FE 리드 | `apps/{reporter,control-center,subscriber}/package.json`(수정 3) + `app.config.ts`(**기존 파일 수정** — 3앱 모두 이미 존재, `ls apps/*/app.config.ts` 실측 확인, `web` 블록만 추가, EVAL-ROUND-1 영역3 감점5 — 舊 "3파일 신규" 오기 정정) | `react-dom`·`react-native-web`·`@expo/metro-runtime` 3앱 추가 + `app.config.ts`에 `web:{bundler:'metro',output:'static'}` 블록 추가 + 기존 `metro.config.js`(3앱 확인됨, pnpm resolver 커스터마이즈·`disableHierarchicalLookup` 금지 주석) 보존 확인 | 02§E-0 "Expo Web 활성화 — ... `app.config.ts`에 `web: { bundler: 'metro', output: 'static' }` 설정 + 기존 `metro.config.js`의 pnpm resolver 커스터마이즈 ... 보존 확인" | qa-verifier + 루트 회귀(QA 리드 실행·조율자 결과 수신 — E5§A 게이트③ 인용, G3 대상: `app.config.ts` 공통 변경) |
| T-W0-06 | 08§E-3-2, 08§B "보안사고 대응" | 인프라 담당 | `infra/monitoring/uptime-kuma-alerts.json`(신규)·`infra/monitoring/log-retention.md`(신규)(경로 확정 — EVAL-ROUND-1 영역3 감점3, "또는" 표기 제거) | 비정상 접근·권한 변경 알림 + 사고 시 증거 보전(로그 삭제·덮어쓰기 금지) 2항목 | 08§E-3-2 "① 비정상 접근·권한 변경 알림 ② 사고 시 증거 보전(로그 삭제·덮어쓰기 금지) 2항목을 기존 Uptime Kuma·`/health/*` 모니터링에 추가 구축" | qa-verifier |

**W0 코드 태스크: 6건.** (비코드 W0 게이트는 §E T-NC-01·T-NC-02 참조)

### W1. 구독자 웹

**선행**: W0 전건 + T-W0-05(Expo Web 활성화) 완료가 `expo export --platform web`을 요구하는 모든 W1 태스크의 전제(02§E-0).
**PoC 게이트 범위(EXEC-DECISIONS #2 인용, EVAL-ROUND-1 X-6 정정)**: 08§A W1 선행조건의 "`<input capture>` 대용량
업로드 실기기 PoC 완료"는 **W1 전체가 아니라 기자 촬영·업로드 트랙(02§E-7번 계열 = T-W2-02 이후) 착수 전 완료**로
좁혀 해석한다 — 근거는 EXEC-DECISIONS #2. 따라서 T-NC-03(PoC)은 아래 W1 태스크 표의 착수 전제가 **아니며**, W2의
T-W2-02 착수 전제다(§D 트리거 참조).

| ID | 원천 | 담당 | 파일 소유권 | 산출물 | DoD(정본 인용) | 검증자 |
|---|---|---|---|---|---|---|
| T-W1-01 **[SOLO]** | 02§E-1(전반부) | FE 리드 | `packages/ui/`(현재 `README.md` 1개만 존재 — `find packages/ui -type f` 실측 확인, EVAL-ROUND-1 영역3 감점5) — `package.json`(신규, 워크스페이스 등록)·토큰 스키마 파일(신규)·CSS 커스텀 프로퍼티 진입점(신규), 3파일 | 03§A-1 확정 수치(본문 18px+/캡션 16px+/제목 22px+/터치 44×44pt+) 반영한 토큰 스키마 + 웹 빌드 한정 `--gachinol-font-*` CSS 커스텀 프로퍼티 + `rem` 스케일. 네이티브는 `Platform.select('web')` 분기로 무변경 | 02§E-1 "`packages/ui` 디자인 토큰 승격 1단계 — ... 토큰 스키마에 반영, 웹 빌드 한정 CSS 커스텀 프로퍼티 ... 노출" | qa-verifier + 루트 회귀(QA 리드 실행·조율자 결과 수신 — E5§A 게이트③ 인용, G3 대상: `packages/ui` 신설) |
| T-W1-02 | 02§E-1(후반부, T-W1-01 의존) | FE 리드 | `apps/subscriber/src/ui/theme.ts`(삭제) + 소비 파일 11개(`app/` 6·`src/ui` 5, 실측 `grep -rlE "from .*theme" apps/subscriber` 재현) | 구독자 앱 전 화면이 신 토큰 값으로 렌더 — `theme.ts` import를 `packages/ui` 토큰 import로 교체(분할 예외②: 기계적 반복 패턴) | 02§E-1 "**+ 구독자 앱의 소비 전환 완료**(구독자 웹 화면이 신 토큰 값으로 렌더됨을 확인 — ... 미완료 시 W1 진행 차단)" | qa-verifier |
| T-W1-03 | 02§E-4(3항목 결합: export 스모크·hls.js·고정 OG, 동일 앱·동일 담당이라 결합) | FE 리드 | **예상 경로(EVAL-ROUND-5 영역3 감점1·U-9 정정)**: `apps/subscriber/src/live/*`(hls.js 어댑터 신규 1~2) + `apps/subscriber/app/live/[id].tsx`(**라이브 재생 컴포넌트 수정 1**, hls.js 통합) + `apps/subscriber/app/(tabs)/index.tsx`+`apps/subscriber/app/(tabs)/stations.tsx`(**홈·지사목록 라우트 OG 메타 2**) + `apps/subscriber/package.json`(수정, hls.js 신규 의존성 추가 1 — **D6-1**) = **총 6파일** | `expo export --platform web` 스모크 통과 + hls.js 어댑터(Chrome/Edge/삼성인터넷 MSE) + 고정 페이지 정적 OG 메타 **+ 02§B 표 행 추가**(신규 의존성 hls.js, D6-1) | 02§E-4 "구독자 앱 `expo export --platform web` 스모크 → 전 화면 웹 렌더 확인 → hls.js 어댑터 → 고정 페이지(홈·지사 목록) 정적 OG 메타" | qa-verifier |
| T-W1-04 | 02§E-4-1 | FE 리드 | **예상 경로(EVAL-ROUND-3 영역3 감점1·Z-8 반영, 착수 직전 실측 재확인 대상)**: `apps/subscriber/src/pwa/register-service-worker.ts`(신규)·`apps/subscriber/public/sw.js`(신규, Workbox 설정) + `apps/subscriber/app/_layout.tsx`(수정, SW 등록 호출·빌드 해시 파일명 설정 확인) + `apps/subscriber/package.json`(수정, Workbox 신규 의존성 추가 1 — **D6-1**) — 서비스워커 등록/Workbox 설정(신규 2), 빌드 해시 파일명 설정 확인(1), package.json(1) = **총 4파일**(EVAL-ROUND-6 D6-1 반영 — 舊 3파일 S에서 상향, 아래 E3 사이징 동반 정정) | 해시 캐시버스팅 + `skipWaiting`+`clients.claim`+새 버전 토스트(자동 강제새로고침 금지) + HTML 엔트리 `no-cache` **+ 02§B 표 행 추가**(신규 의존성 Workbox, D6-1) | 02§E-4-1 "서비스워커 갱신·캐시 무효화 정책 구현(... 해시 캐시버스팅·`skipWaiting`+`clients.claim`+새 버전 토스트·HTML no-cache·배포 파이프라인 CF 캐시 퍼지 4요소)" | qa-verifier(CF 캐시 퍼지 파이프라인 배선은 T-W1-11b에서 CI 워크플로로 완결 — 본 태스크는 클라이언트 3요소만) |
| T-W1-05 | 02§E-5, 02§D-T6 | BE 리드 | `services/api/src/go-link/*`(신규 모듈, 컨트롤러+서비스 2) + `services/api/src/app.module.ts`(준-공용 자산, `imports` 배열 1줄 등록 — D4, 리포 실측 **17모듈** 등록 확인, EVAL-ROUND-2 영역1 감점1·Y-1 정정 — 재현: `awk '/imports: \[/{f=1;next} /^  \],/{f=0} f' services/api/src/app.module.ts \| grep -cE "^\s+[A-Za-z]"` → `17`) | `go.<도메인>` OG SSR 라우트 + go. 가용성 조치(CF Cache Everything+stale 서빙은 CF 설정으로 T-W1-06과 함께 문서화, `watch.` 직접 링크 병행 발급 정책 반영) | 02§E-5 "`go.<도메인>` OG SSR 라우트(api 경량, D-T6 기본안) ... + `go.` 라우트 가용성 조치(D-T6 신설 소절 — Cloudflare Cache Everything+stale 서빙 규칙 적용, ... `watch.` 직접 링크 병행 발급 정책 반영)" | qa-verifier |
| T-W1-06 | 02§E-6(W1분)·02§D-T5(동적 라우트 서빙), T-W0-03 의존 | 인프라 담당 | `infra/docker/nginx.conf`(수정, T-W0-03과 동일 파일 — 순서 의존, **준-공용 자산**) | `try_files $uri $uri.html /index.html;` 류 SPA 폴백 — **그 시점(Wave 4)의 전수 4패턴** `/watch/:id`·`/live/:id`·`/contents/:id`·`/recommendations/:id` + HTML no-cache 헤더 정합. **동적 라우트 신설 태스크 동반 의무(EXEC-DECISIONS #6/D6-2)**: 이후 신설되는 동적 라우트(예: T-W2-09의 `/upload/:token`)는 그 신설 태스크가 폴백 패턴을 동반 소유하며, 본 4패턴은 "Wave 4 시점 전수"이지 "닫힌 목록"이 아니다 | 02§D-T5 "rewrite/SPA 폴백: nginx `web` 서비스에 `try_files $uri $uri.html /index.html;` 류의 SPA 폴백 규칙을 적용 ... 4개 동적 라우트 패턴을 전부 포괄"(**그 시점 전수 — EXEC-DECISIONS #6 정정**) | qa-verifier |
| T-W1-07a | 02§E-16(클라이언트분, 소비 트랙) | FE 리드 | **예상 경로(EVAL-ROUND-5 영역3 감점1·U-9 정정, **EVAL-ROUND-6 D6-5 보정 — 02§E-16 원문 재확인 결과 DoD 자체는 파일 수를 정의하지 않으나 DD1이 추가한 AC("훅 호출이 실제 발생함을 단위 테스트로 확인")는 검증 가능하려면 실 테스트 파일이 있어야 하며 舊 열거에 누락돼 있었다 — E2가 정본이므로 여기서 보정, E3는 이미 3파일로 일치돼 있어 변경 불요**)**: `apps/subscriber/src/telemetry/use-playback-events.ts`(신규 훅) + `apps/subscriber/app/live/[id].tsx`(**재생 컴포넌트(T-W1-03 산출물) 호출 지점 배선 수정 1**, 재생시작·진행률25/50/75/100%·큰자막토글 이벤트 발신 — DD1) + `apps/subscriber/src/telemetry/use-playback-events.test.ts`(**신규, DD1 AC 검증용 단위 테스트**) = **총 3파일** | 콘텐츠 소비(재생시작·진행률25/50/75/100%) 트랙 클라이언트 로깅 — 훅+호출 배선+테스트 결합(분할 예외①: 배선 없이는 DoD 미충족) | 02§E-16 "① 콘텐츠 소비(재생 시작·진행률 25/50/75/100%·조회 집계) ... 클라이언트 로깅". AC 추가(DD1): "훅 호출이 실제 발생함을 단위 테스트로 확인(모의 로거 호출 1회 이상)" | qa-verifier |
| T-W1-07b | 02§E-16(클라이언트분, 업로드퍼널+모드선택 트랙) | FE 리드 | **예상 경로(EVAL-ROUND-5 영역3 감점1·U-9 정정, **EVAL-ROUND-6 D6-5 보정 — 위 T-W1-07a와 동일 사유(누락된 테스트 파일 보정), E3 Wave 8a 셀은 이미 4파일 M으로 일치돼 있어 변경 불요**)**: `apps/reporter/src/telemetry/use-upload-funnel-events.ts`(신규 훅) + `apps/reporter/app/(app)/contents/new/upload.tsx`(**업로드 위저드 호출 지점 배선 수정**, 시작/재개/완료·큰자막모드토글 이벤트) + `apps/reporter/app/(app)/contents/new/classify.tsx`(**모드 선택 UI 호출 지점 배선 수정**, 간단/정밀 모드선택·위저드 진입/이탈 이벤트 — DD1) + `apps/reporter/src/telemetry/use-upload-funnel-events.test.ts`(**신규, DD1 AC 검증용 단위 테스트**) = **총 4파일** | 업로드 퍼널 + 모드선택(간단/정밀) 트랙 클라이언트 로깅 — 훅+호출 배선+테스트 결합 | 02§E-16 "② 업로드 퍼널(위저드 단계 진입·이탈, 업로드 시작/재개/완료, 큰 자막 모드 토글) ③ 모드 선택(간단/정밀 모드 선택 이벤트)". AC 추가(DD1): "훅 호출이 실제 발생함을 단위 테스트로 확인(모의 로거 호출 1회 이상)" | qa-verifier |
| T-W1-08 | 02§E-16(서버분) | BE 리드 | `services/api/src/telemetry/*`(신규 모듈, 컨트롤러+서비스 2) + `services/api/src/app.module.ts`(준-공용 자산, 1줄 등록 — D4) | 계측 집계 엔드포인트(3트랙 이벤트 수신·집계) — 03 KPI "업로드 위저드 완주율"·"재개 성공률"·"큰 자막 모드 활성 비율" 3행의 유일한 측정 원천 | 02§E-16 "서버 집계 엔드포인트(§B `services/api` 행) 신설" | qa-verifier |
| T-W1-09 | 02§E-17, 06§F-6 | FE 리드 | **예상 경로(Z-8 반영)**: `apps/subscriber/app/support.tsx`(신규, expo-router 규약) — 구독자 앱 신규 라우트(1~2, `tel:` 링크·카톡 채널 링크·FAQ 정적) | 웹앱 "문의하기" 라우트 | 02§E-17 "웹앱 '문의하기' 라우트(`tel:` 링크·카톡 채널 링크·FAQ, 정적) — 06 §F-6 수신" | qa-verifier |
| T-W1-10 | 02§E-21, 04§B④ 전제 | FE 리드 | **예상 경로(Z-8 반영)**: `apps/subscriber/app/schedule.tsx`(신규, expo-router 규약) — 구독자 앱 신규 정적 페이지(1) | 정적 방송 편성표 페이지 — 방송 시작 시 CF Stream HLS URL 직접 게시 가능한 구조 | 02§E-21 "웹앱 정적 방송 편성표 페이지 신설 — 04 §B④ '라이브 신규 진입 완화책'의 기술 전제" | qa-verifier |
| T-W1-11a | 02§E-9(착수분, 구독자 시나리오 부분) | FE 리드 | `apps/subscriber/playwright.config.ts`(신규, **앱별 설정 — DD2 확정: 근거는 E5§B 명령 형식 `pnpm --filter @gachinol/<app> exec playwright test`와의 정합, 루트 두면 G3상 SOLO 승격 강제**), 구독자 Playwright 4단계 시나리오(신규, 앱 워크스페이스) + `apps/subscriber/package.json`(수정, Playwright 신규 의존성 추가 1 — **D6-1**) = **총 3파일** | 구독자 4단계 시나리오(카톡 `go.` 진입→상세→재생→자막토글) × 브라우저 프로필 **2종**(Chromium+카카오 인앱 UA·WebKit — EVAL-ROUND-4 영역1 감점7·V-9 정정: 02§E-9 ② 원문 단서 "데스크톱 프로필은 관제·기자 시나리오 한정"에 따라 데스크톱 Chrome 프로필은 구독자 시나리오에서 제외. 舊 "3종(...+데스크톱 Chrome)"은 이 단서를 소거한 것이었다. 08§A W2 DoD가 단서 없이 "3종×3종"으로 축약 인용했으나 08 자신이 "02가 정본, 08은 인용만"이라 선언했으므로 정본 02를 따른다) **+ 02§B 표 행 추가**(신규 의존성 Playwright, D6-1 — "실측 4종" 확정 문안에 열거된 1건. T-W2-07(관제·기자 Playwright)은 D6-1의 실측 4종 열거에 포함되지 않아 본 라운드에서는 재해석하지 않고 미대상으로 둔다) | 02§E-9 "핵심 E2E 시나리오 3종 ... ② 브라우저 프로필 3종(Chromium+카카오 인앱 UA, WebKit, 데스크톱 Chrome 1440×900 — **데스크톱 프로필은 관제·기자 시나리오 한정**) ... 전건 실행" | qa-verifier |
| T-W1-11b **[SOLO]** | 02§E-18·02§E-9(CI 게이트 부분)·02§E-4-1(CF 퍼지 CI 스텝) | FE 리드 | `.github/workflows/ci.yml`(수정, 루트 CI — 워크스페이스 경계 밖 단독 취급) | CI installability 구조 검사(매니페스트 필수필드·SW 등록·HTTPS) + CI 번들 예산 게이트 + CF 캐시 퍼지 CI 스텝(T-W1-04 배포측 완결) | 02§E-18 "CI installability 구조 검사(매니페스트 필수 필드·서비스워커 등록·HTTPS)" | qa-verifier + 루트 회귀(QA 리드 실행·조율자 결과 수신 — E5§A 게이트③ 인용, G3 대상: CI 설정) |

**분할 근거(DD1, EVAL-ROUND-2 영역3 감점2·영역4 감점1·Y-13)**: 舊 T-W1-07(단일 태스크, "3앱 이벤트 로깅 훅/유틸
신규"만 소유)은 02§E-16이 요구하는 이벤트(재생시작·진행률 등)가 **호출 지점 배선 없이는 발생하지 않는데도**
호출 지점 파일을 소유권에 넣지 않아 DoD가 닫히지 않거나(자가검증이 "훅은 있으나 아무도 부르지 않음"을 그린
처리), 넣으면 3개 앱 화면 파일을 동시에 만져 §A 분할 기본값(워크스페이스 경계)과 충돌하는 판정 불가 상태였다.
**앱 경계로 분할하고 호출 지점 배선을 각 태스크 소유에 포함**한다 — 07a(구독자, T-W1-03 재생 컴포넌트 완료 후
착수해 파일 충돌도 함께 해소)·07b(기자).

**07c(관제) 신설 여부 판정(DD1 위임 — E2가 02§E-16 재확인 후 판정)**: 02§E-16 원문(395~422행 구간, 실측 재확인)의
범위 3트랙 — "① 콘텐츠 소비(재생 시작·진행률 25/50/75/100%·조회 집계) ② 업로드 퍼널(위저드 단계 진입·이탈,
업로드 시작/재개/완료, 큰 자막 모드 토글) ③ 모드 선택(간단/정밀 모드 선택 이벤트)" — 어디에도 "관제"·"검토
보드"·"승인/반려" 등 control-center 이벤트가 **명시되지 않는다**(`grep -c "관제" <02§E-16 해당 단락>` → 0건,
관제 앱의 역할은 검토·승인이지 콘텐츠 소비·업로드가 아니므로 3트랙 어디에도 자연스럽게 속하지 않음). **판정:
T-W1-07c 신설하지 않음 — 07a·07b 2분할로 종결**(DD1 "없으면 07a·07b 2분할로 종결" 조건 충족).

**분할 근거(D6, EVAL-ROUND-1 영역3 감점1·X-9)**: 舊 T-W1-11(단일 태스크)은 `.github/workflows/ci.yml`(루트)과
`playwright.config.ts`+시나리오(앱 워크스페이스)에 동시에 걸쳐 §A 분할 기본값("워크스페이스 경계에서 분할")을
위반했고, 3예외 중 어느 것도 원용하지 않았다. **"SOLO 웨이브 수 축소"라는 스케줄 편의가 크기 기준을 앞선 사례**로
적발돼 분할한다 — 크기 기준이 스케줄 편의에 우선한다.

**W1 코드 태스크: 13건.**(DD1 분할로 07→07a+07b, 12→13) (W1 DoD 실측·PoC·패널은 §E T-NC-03~06 참조)

### W2. 기자·관제 웹

**선행**: W0 + T-W0-05(Expo Web) + T-W1-01(`packages/ui` 토큰 스키마) 완료(EVAL-ROUND-1 영역4 감점5·X-7 정정 —
02§E-1번은 "미완료 시 **W1** 진행 차단"만 규정하므로 T-W1-02(구독자 앱 소비 전환)는 W2의 선행이 **아니다**;
舊 "T-W1-01/02"는 근거 없는 과잉 선행이었다). **T-W2-02(웹 업로더 어댑터) 착수 전에는 T-NC-03(PoC) 완료가
별도 필수**(EXEC-DECISIONS #2, §D 참조 — W1 선행과 무관한 별도 게이트).

| ID | 원천 | 담당 | 파일 소유권 | 산출물 | DoD(정본 인용) | 검증자 |
|---|---|---|---|---|---|---|
| T-W2-01 | 02§E-7(부분) | FE 리드 | `apps/reporter/src/auth/token-store.ts`(웹 어댑터 분기, 1) + 관련 테스트(1) | token-store 웹 어댑터(expo-secure-store 웹 미지원 → 교체) | 02§E-7 "token-store 웹 어댑터 → ..." | qa-verifier |
| T-W2-02 | 02§E-7(부분) | FE 리드 | `apps/reporter/src/upload/*`(신규 웹 업로더 어댑터 1~2 + `use-upload-service.ts` DI 배선 수정 1) | fetch/XHR `upload.onprogress`/`abort` 기반 웹용 업로더 어댑터 → 기존 `useUploadService()` DI 지점 주입 | 02§E-7 "**웹용 업로더 어댑터 신규 작성**(fetch/XHR `upload.onprogress`/`abort`) → 기존 `useUploadService()` DI 지점에 주입" | qa-verifier |
| T-W2-03 | 02§E-7(부분), T-W2-02 의존 | FE 리드 | **예상 경로(EVAL-ROUND-5 영역3 감점1·U-9 정정 — §A "파일 소유권 명시 원칙" 자기 규칙 미준수 해소)**: `apps/reporter/app/(app)/contents/new/index.tsx`(수정, `<input type="file" capture>` 촬영 진입 — 위저드 첫 단계) + `apps/reporter/scripts/upload-300mb.spec.ts`(신규, 300MB 실측 업로드 검증 스크립트) — 기자 앱 촬영/업로드 화면(1) + 업로드 검증 스크립트(1) | `<input type="file" capture>` 통합 촬영 + 300MB 실측 업로드 검증 | 02§E-7 "input capture 촬영 → 업로드 검증(실측 300MB)" | qa-verifier |
| T-W2-04 | 02§E-8 | FE 리드 | `apps/control-center/src/auth/token-store.ts`(웹 어댑터, 기자와 동일 패턴 이식, 1) + 관련 배선(1~2) | 관제 앱 웹 전환(인증 패턴 기자와 동일) | 02§E-8 "관제 앱 웹 전환(인증 패턴 기자와 동일)" | qa-verifier |
| T-W2-05 | 02§E-1-1(기자분), T-W1-01 의존 | FE 리드 | `apps/reporter/src/ui/theme.ts`(삭제) + 소비 파일 20개(`app/` 9·`src/features` 2·`src/ui` 8, 실측 `grep -rlE "from .*theme" apps/reporter` 재현) | 기자 앱 토큰 전면 전환 + `theme.ts` 제거(분할 예외②) | 02§E-1-1 "3앱 전면 전환 ... + 앱 로컬 `theme.ts` 3개 ... 제거" | qa-verifier |
| T-W2-06 | 02§E-1-1(관제분), T-W1-01 의존 | FE 리드 | `apps/control-center/src/ui/theme.ts`(삭제) + 소비 파일 16개(`app/` 9·`src/ui` 7, 실측 재현) | 관제 앱 토큰 전면 전환 + `theme.ts` 제거(분할 예외②) | 02§E-1-1 (기자와 동일 인용) | qa-verifier |
| T-W2-07 | 02§E-9(완료분) | FE 리드 | `apps/{reporter,control-center}/playwright.config.ts`(신규 2, **앱별 설정 — DD2**) + 관제·기자 Playwright **시나리오 스펙 2**(EVAL-ROUND-4 영역3 감점1·V-11 확정 — 관제 3단계 시나리오 파일 1 + 기자 4단계 시나리오 파일 1) + **스모크 스펙 1**(라우트 전건 순회) = 신규 3파일 | 관제 3단계(검토보드→상세→승인/반려)·기자 4단계(로그인→위저드4단계→프리뷰승인) 시나리오 × 브라우저 3종 + **W2 착수 시점 화면 라우트 전건(100%) 스모크**(EXEC-DECISIONS #4 인용, EVAL-ROUND-4 V-3 정정 — 계획 시점 22 + 본 계획 신설 3(T-W1-09·T-W1-10·T-W2-09) = 예상 25, 재현 명령: `find apps/{reporter,control-center,subscriber}/app -iname '*.tsx' ! -path '*__tests__*'`에서 `_layout.tsx`류 제외, "22"는 피벗 시점 스냅숏이지 판정 고정 수치가 아니다) | 02§E-9 "② 위 3종을 브라우저 프로필 3종에서 전건 실행 ③ 화면 라우트 스모크: ... 화면 라우트 22개 전건(100%)이 렌더 크래시 없이 스모크 통과"(EXEC-DECISIONS #4가 "22"를 판정 시점 재현으로 해석 확정) | qa-verifier |
| T-W2-08 **[SOLO]** | 02§E-13(백엔드분)·02§D-T9 | BE 리드 | `services/api/prisma/schema.prisma`(마이그레이션: `ContentOrigin` 확장, 1) + `services/api/src/resident-links/*`(신규 모듈, **컨트롤러 1 + 서비스 1 = 2파일**, 4엔드포인트는 동일 컨트롤러 내 — EVAL-ROUND-4 영역3 감점1·V-11 확정, go-link·telemetry 자매 모듈과 동일 산정 관례) + `services/api/src/app.module.ts`(준-공용 자산, 1줄 등록 — D4, 1) = **총 4파일** | `POST /v1/resident-links`·`GET /v1/resident-links/:token`·`POST /v1/resident-links/:token/uploads`·`POST /v1/resident-links/:token/uploads/:uploadId/complete` — 72시간 만료·링크당 5건·건당 500MB·IP시간당10회 제한 | 02§D-T9 "72시간 만료·링크당 5건·건당 500MB·동일 IP 시간당 업로드 시도 10회 초과 시 차단 ... `ContentOrigin` 확장 마이그레이션" | qa-verifier + 루트 회귀(QA 리드 실행·조율자 결과 수신 — E5§A 게이트③ 인용, G3 대상: Prisma 스키마) |
| T-W2-09 | 02§E-13(프론트분)·03§C-5, T-W2-08 의존 | FE 리드(**담당 배정 근거, EVAL-ROUND-5 영역1 감점2·U-14 신설**: 02§E-13 원문 담당은 "BE 리드" 단독이나, E1 §A 경계 판정 원칙("두 역할이 한 태스크에 걸치면 파일 소유권이 명확한 쪽으로 쪼갠다")에 따라 02§E-13이 서술하는 백엔드분(API·검증 로직)은 이미 T-W2-08(BE 리드)이 전담하므로, 본 태스크(프론트 UI 화면)는 파일 소유권 기준으로 FE 리드에 배정한다) | **소속 앱 확정(EVAL-ROUND-3 영역3 감점1·Z-8 정정)**: `apps/subscriber/app/upload/[token].tsx`(신규) — 03§C-5 원문("**인증 없는 임시 업로드 링크**"·"웹 피벗이 있어야만 성립 — 네이티브 앱은 설치가 전제라 불가능")이 명시하듯 이 화면은 **무인증**이 핵심 설계라 `apps/reporter`(기자 로그인 전제) 배치는 성립하지 않고, 로그인 없는 익명 접근을 이미 전제하는 `apps/subscriber`(CLAUDE.md §4 "구독자 앱 — 익명 시청")가 유일하게 정합하는 앱이다 — 주민 임시 업로드 링크 축소 UI 화면(신규 1~2) + `infra/docker/nginx.conf`(수정, 5번째 동적 라우트 `/upload/:token` SPA 폴백 1줄 — **준-공용 주의, T-W0-03·T-W1-06과 동일 파일, EXEC-DECISIONS #6/D6-2 동반 소유**) = **총 3파일** | 무인증·간단 모드 강제 노출·지사 담당자 검수 게이트 UI **+ nginx SPA 폴백 패턴 동반**(`/upload/:token`, EXEC-DECISIONS #6) **+ 라우트 스모크 모수 편입**(EXEC-DECISIONS #4, 신설 동적 라우트 1건 반영) | 02§E-13 "간단 모드 강제 노출, 지사 담당자 검수 게이트 구현(설계 원천: 03 §C-5)". **동반 산출물(EXEC-DECISIONS #6/D6-2)**: "동적 라우트를 신설하는 태스크는 ① nginx SPA 폴백 패턴 추가와 ② 라우트 스모크 모수 편입을 동반 산출물로 가진다" | qa-verifier |
| T-W2-10 | 02§E-14·02§D-T8 | BE 리드 | `services/api/src/media/*`(공개 렌디션 복사 로직 신규 1~2), 콘텐츠 삭제/비공개 전이 훅 수정(1) | 공개 렌디션 버킷/프리픽스 분리 + CF 캐시 서빙 전환 **+ 삭제·비공개 전환 시 공개 객체 제거 + CF 캐시 퍼지 호출(필수 대칭, 동시 구현)** | 02§E-14 "공개 렌디션 버킷/프리픽스 분리 + Cloudflare 캐시 서빙 전환(D-T8) + 삭제·비공개 전환 시 공개 객체 제거 + CF 캐시 퍼지 API 호출 경로 구현(D-T8 필수 대칭 설계) ... 순서 분리 금지" | qa-verifier |
| T-W2-11 | 02§E-19(프론트분) | FE 리드 | **예상 경로(Z-8 반영)**: `apps/subscriber/src/live/ProductCard.tsx`(신규) + `apps/subscriber/app/live/[id].tsx`(수정, 카드 삽입) — 라이브 화면 상품 카드 컴포넌트(신규 1~2) | 상품 카드 UI + 외부 판매 채널(네이버 스마트스토어 등) 링크아웃 — 판매·결제·환불·재고 구현 범위 아님 | 02§E-19 "판매자(이장·어촌계장)의 기존 외부 판매 채널 ... 연결하는 상품 카드 UI + 외부 링크 클릭 계측 ... 판매·결제·환불·재고는 구현 범위 아님" | qa-verifier |
| T-W2-12 | 02§E-19(서버분) | BE 리드 | `services/api/src/telemetry/*`(T-W1-08 모듈 확장, 링크 클릭 이벤트 엔드포인트 1) | 링크아웃 클릭 계측 집계 엔드포인트 | 02§E-19 (동일 인용, 서버측) | qa-verifier |
| T-W2-13 **[SOLO]** | 02§E-20(백엔드분) | BE 리드 | `services/api/prisma/schema.prisma`(마이그레이션: 미성년자 플래그+동의서 확인 필드), 콘텐츠 워크플로 전이 가드 수정(1) | 피촬영자 만 14세 미만 플래그 + 법정대리인 동의서 첨부 확인 전 승인 차단 전이 가드 | 02§E-20 "체크 시 승인 단계(센터 검토)에서 법정대리인 동의서 첨부 여부를 확인하기 전에는 승인을 차단하는 워크플로우 전이 가드 신설" | qa-verifier + 루트 회귀(QA 리드 실행·조율자 결과 수신 — E5§A 게이트③ 인용, G3 대상: Prisma 스키마) |
| T-W2-14 | 02§E-20(프론트분), T-W2-13 의존 | FE 리드 | **예상 경로(Z-8 반영)**: `apps/reporter/app/(app)/contents/new/classify.tsx`(수정 — 촬영 위저드의 분류 단계, 콘텐츠 메타데이터 입력 화면) — 기자 앱 콘텐츠 등록 폼(수정 1) | "피촬영자 만 14세 미만 여부" 체크박스 입력 필드 | 02§E-20 "기자 앱 콘텐츠 등록 폼에 '피촬영자 만 14세 미만 여부' 체크박스 입력 필드 추가" | qa-verifier |
| T-W2-15 | 04 R10(08§A W2 DoD 인용) | BE 리드 | `services/api/src/live/*`(CF Stream 실계정 연동 확장, env 플레이스홀더 → 실 연동 2) | CF Stream 실계정 개설 + Live Input 발급 흐름 | 04 실행체크리스트-1 "Cloudflare Stream 실계정 개설 + Live Input 발급 흐름 구현(현재 env 플레이스홀더, R10)" | qa-verifier |
| T-W2-16a | 04 R10(08§A W2 DoD 인용), T-W2-15 의존 | BE 리드 | `services/api/src/live/*`(webhook 수신 1) | CF Stream webhook 수신(BE) | 04 실행체크리스트-2 "관제 웹앱에 CF Stream Output/Live Input 상태 조회 연동(webhook 또는 polling)"(BE분) | qa-verifier |
| T-W2-16b | 04 R10(08§A W2 DoD 인용), T-W2-16a 의존 | FE 리드 | **예상 경로(Z-8 반영)**: `apps/control-center/src/live/use-cf-stream-status.ts`(신규 훅) + `apps/control-center/app/(app)/live/[id].tsx`(수정, 상태 표시 UI 삽입) — `apps/control-center/src/live/*`(상태 조회 훅/UI 신규 1~2) | 관제 웹앱 상태 조회 UI(FE) | 04 실행체크리스트-2 (동일 인용, FE분) | qa-verifier |

**분할 근거(D4·D6, EVAL-ROUND-1 영역2 감점2·영역3 감점2·X-9)**: 舊 T-W2-16(담당: 인프라 담당 단일)은
`apps/control-center`(FE 소유 영역) + `services/api`(BE 소유 영역)를 동시 소유해 §A 분할 기본값(워크스페이스
경계 분할)과 E1 §A "인프라 담당 금지 칸(앱/서비스 비즈니스 로직 코드)"·"경계 판정 원칙(걸치면 파일 소유권이
명확한 쪽으로 분할)"에 정면으로 어긋났다. BE(webhook 수신)/FE(상태 조회 UI)로 분할해 각 워크스페이스를 해당
역할군이 소유하도록 정정한다.

**W2 코드 태스크: 17건.** (W2 실기기 완주 DoD는 §E T-NC-07 참조)

### W3. 쉘·PWA

**선행**: **W1 종료(Wave 12) + T-NC-08(스토어 개발자 계정 개설) 완료**(08§A W3 선행조건 원문 그대로 — D4-3 확정
문안, EVAL-ROUND-4 영역1 감점4·V-4 정정: 舊 "W1(구독자 웹 안정) + T-NC-08(... 별도 트랙)"은 08§A 원문이 명시한
"W1 + 스토어 계정 개설 완료" 결합 조건을 "별도 트랙"으로 이완 서술해 T-NC-08을 사실상 선행조건 밖처럼 읽히게
했다). 단 T-NC-08은 사용자 의존 외부 리드타임(D-U-N-S 발급 등)이므로, **코드 선행 준비는 §F G9 우회 경로와
동형으로 로컬 검증 범위 내 진행 가능하며 T-NC-10(스토어 제출 행위)만 하드 차단**된다(08§D 승인 지연 완화책
준용 — 정본과 상충 아님, D4-3).

| ID | 원천 | 담당 | 파일 소유권 | 산출물 | DoD(정본 인용) | 검증자 |
|---|---|---|---|---|---|---|
| T-W3-01 **[SOLO]** | 02§E-23 | BE 리드 | `services/api/prisma/schema.prisma`(마이그레이션: `PushSubscription`), `services/api/src/push/*`(신규 모듈: 구독/해지·발송트리거+워커·쉘 토큰수신 API, 4파일) + `services/api/src/app.module.ts`(준-공용 자산, 1줄 등록 — D4) + `services/api/package.json`(수정, web-push 신규 의존성 추가 1 — **D6-1**) = **총 7파일**(EVAL-ROUND-6 D6-1 반영 — 舊 6파일 M에서 상향, 아래 E3 사이징 동반 정정: M→L) | 웹푸시(VAPID) 구독/해지 API + 발송 트리거 엔드포인트(발송 워커 포함) + 쉘(TWA/iOS) FCM·APNs 토큰 수신 API + `PushSubscription` 모델 **+ 02§B 표 행 추가**(신규 의존성 web-push, D6-1) | 02§E-23 "웹푸시(VAPID) 구독 등록/해지 API + 발송 트리거 엔드포인트(발송 워커 포함) + 쉘(TWA/iOS) FCM·APNs 토큰 수신 API + `PushSubscription` 데이터 모델" | qa-verifier + 루트 회귀(QA 리드 실행·조율자 결과 수신 — E5§A 게이트③ 인용, G3 대상: Prisma 스키마) |
| T-W3-02 | 02§E-10(부분)·02§D-T2 | FE 리드 | **예상 경로(Z-8 반영)**: `apps/{reporter,control-center,subscriber}/web/manifest.json`(신규 3) + `apps/{reporter,control-center}/src/pwa/register-service-worker.ts`(신규 2, subscriber는 T-W1-04가 이미 구현 — 동일 패턴 이식) — 3앱 PWA manifest(신규 3), 서비스워커 등록 확장(T-W1-04 기반 3앱 확장) | PWA manifest/SW 3종 | 02§E-10 "PWA manifest/SW 3종 → TWA(Android) → iOS 쉘(푸시+딥링크) 심사 제출"(manifest/SW 부분) | qa-verifier |
| T-W3-03 | 02§E-10(부분)·02§D-T2, T-W3-01 의존(FCM 토큰수신 API 선행) | FE 리드 | **예상 경로(Z-8 반영)**: `infra/shell/twa/twa-manifest.json`(신규) + `infra/shell/twa/assetlinks.json`(신규) — 3앱 소스 트리 밖 별도 쉘 프로젝트(02§B "쉘·PWA 산출물" 행과 동일 경계) — TWA 패키징 설정(신규, Bubblewrap) | Android TWA 패키징 | 02§D-T2 "**Android 쉘**: TWA(Trusted Web Activity, Bubblewrap) ... `assetlinks.json` 검증" | qa-verifier |
| T-W3-04 | 02§E-10(부분)·02§D-T2, T-W3-01 의존(APNs 토큰수신 API 선행) | FE 리드 | **예상 경로(Z-8 반영)**: `infra/shell/ios/GachinolShell.xcodeproj/project.pbxproj`(신규) + `infra/shell/ios/AppDelegate.swift`(신규) + `infra/shell/ios/WebViewController.swift`(신규) — iOS WKWebView 래퍼 프로젝트 골격(신규 3, **가정치 — 02§B 쉘·PWA 산출물 행 인용, 실제 Xcode 프로젝트 골격은 통상 3파일보다 많은 보일러플레이트를 동반하므로 착수 시 파일 분해가 늘 가능성 있음. E2 신규 위임 목록 #4로 E4에 이미 반영 요청**) | iOS 쉘(WKWebView 래퍼) + APNs 푸시 + 공유시트/딥링크(네이티브 부가가치 2종) | 02§D-T2 "**iOS 쉘**: WKWebView 래퍼 + 네이티브 부가가치 최소 2종(APNs 푸시 알림 + 공유 시트/딥링크)" | qa-verifier |

**W3 코드 태스크: 4건.** (스토어 심사 제출·통과는 §E T-NC-08·T-NC-10 참조)

### W4. 정리

| ID | 원천 | 담당 | 파일 소유권 | 산출물 | DoD(정본 인용) | 검증자 |
|---|---|---|---|---|---|---|
| T-W4-01 | 08§A W4·02§E-24 | 조율자(테크리드 사상) | `CLAUDE.md`(**§9 "개발 명령어"(모바일 실기 구동 — Expo Go 절차 소재) + §11 "현재 상태/로드맵"**, EVAL-ROUND-4 V-8 정정 — 舊 "§11 수정 1"은 "Expo Go 운용 절차 개발 편의 격하 문서화"가 실제로 위치한 §9를 누락했다) | **착수 시점 현행 CLAUDE.md 재실측 기준 문서 정리**(EXEC-DECISIONS #5 확정 문안, EVAL-ROUND-5 영역1·3 감점1·U-1 정정 — 舊 "라운드 4 Q1 재검증 각주"는 인용 좌표(293)·`grep -c` 주장(0건) 둘 다 재실측(302행·1건, `CLAUDE.md:202`)과 불일치하는 이중 오류였으며 **삭제**한다): ① §9 Expo Go 운용 절차의 웹 절차 격하 문서화 ② §11 네이티브 잔존 수치·서술 정리 — **구체 항목(좌표·수치)은 계획 문서에 고정 기재하지 않고 착수 시점 재실측으로 확정**한다(이미 두 번(라운드4→라운드5) stale된 이력 반영. `CLAUDE.md:202`가 이미 "reporter 102·control-center 153·subscriber 48·media-worker 24" 최신치를 담고 있어 이 부분은 착수 시점 재실측 시 "기 반영 확인"으로 판정될 가능성이 높으나, 계획 문서 자신은 그 판정을 선취하지 않는다) | 02§E-24 "CLAUDE.md §11 갱신 ... 담당: 테크리드, 기한: 계획 승인 시점 +1주 이내". EXEC-DECISIONS #5 "산출물을 착수 시점 현행 재실측 기준으로 재정의 — 계획 문서에 고정 좌표·고정 수치를 적지 않는다(이미 두 번 stale됐다)" | qa-verifier(**착수 시점** grep 재현 — 계획 문서 작성 시점 고정 수치 대조 금지) |
| T-W4-02 **[SOLO]** | 08§A W4 | 조율자(테크리드 사상) | `.github/workflows/ci.yml`(수정) | 웹 E2E(Playwright)를 CI 필수 게이트로 승격 | 08§A W4 "웹 E2E를 CI 필수 게이트로" | qa-verifier + 루트 회귀(QA 리드 실행·조율자 결과 수신 — E5§A 게이트③ 인용, G3 대상: CI 설정) |
| T-W4-03 | 02§E-22 | 조율자(테크리드 사상) | 실측 리포트 문서(신규 1, T-W1-07/08 계측 인프라 데이터 소비) | 웹 배포 소요시간·스토어 심사 회피 횟수·이중 트랙 잔존 공수 실측 → 01§A-2 "월 20~30시간" 상계 가정 확정·갱신 | 02§E-22 "웹 배포 소요 시간·스토어 심사 회피 횟수·이중 트랙(웹+네이티브 병행 잔존 시) 잔존 공수를 계측해 ... 상계 가정을 확정·갱신" | qa-verifier |

**W4 코드 태스크: 3건.**

## D. 트리거 대기 코드 태스크

아래는 **코드 작업이지만 착수 시점이 W단계가 아니라 수치·의사결정 트리거**인 태스크다. 사전 설계·DI 지점 준비까지는
가능하나 본격 구현은 트리거 충족 후 착수한다. E3는 이를 별도 "게이트 대기 트랙"으로 편성한다(정상 웨이브 슬롯을
점유하지 않음).

| ID | 원천 | 담당 | 트리거 | 산출물 | DoD(정본 인용) |
|---|---|---|---|---|---|
| T-TRIG-01 | 02§E-12·02§D-T4 | BE 리드 | "업로드 실패율 주간 5% 초과 또는 평균 원본 크기 300MB 초과"(D-T4 유일 원천 문장) | S3 멀티파트 업로드(create/complete-multipart presign 엔드포인트) 전환 | 02§E-12 "(승격 조건 충족 시, D-T4 단일 문장 기준) 멀티파트 업로드 승격" |
| T-TRIG-02 | 02§E-15 | BE 리드 | B2B 세일즈 착수 결정(사업 판단, 트리거 미정) | media-worker 워터마크 오버레이 트랜스코딩 프로파일(시연용, 원본 비공개 유지) | 02§E-15 "(W2~, B2B 착수 전) B2B 샘플 워터마크 렌디션 ... 이용범위·표시 문구는 07 법무 검토를 인용" |
| T-TRIG-03 | 02§E-11 | FE 리드 | 05§A-4 후원·멤버십 트랙 재개 결정 | 쉘 UA/런치 파라미터 감지 → 후원·멤버십 메뉴 비노출. **선구축 가능분**: 감지 로직 자체(대상 분기 제외)는 W3 이전 선착수 허용 | 02§E-11 "발동 조건 단서: 05 §A-4가 후원·멤버십을 이월 트랙으로 확정한 현재는 비노출 대상 UI 자체가 존재하지 않는다 ... 쉘 UA/런치 파라미터 감지 로직 자체는 W3 이전 선구축 가능" |

## E. 코드 외 태스크 (비개발·사용자 결정·실기기 실측 — 별도 트리거 대기)

물리 기기·외부 심사 기관·사용자 재무/행정 결정이 필요해 코딩 서브에이전트가 단독 완결할 수 없는 항목이다. 실측
계열(TTFF·PoC·실기기 완주)은 **QA 리드가 실행**하고(사람 또는 QA 리드가 orchestrate하는 실기기/에뮬레이터 조작),
**증적 경로는 E5 §C(W단계 DoD 판정 절차)를 그대로 인용**한다(재정의 금지 — E5 발주 신규 위임 수신, 아래 §F 참조).

| ID | 원천 | 담당 | 게이트/트리거 | 산출물·증적 경로 |
|---|---|---|---|---|
| T-NC-01 | 08§A W0 DoD | QA 리드 | **T-W0-01~04 완료 후(Wave 2 종료 직후)**(D5-3 확정 문안, EVAL-ROUND-5 영역1·8 감점4·U-4 정정 — health 외부 도달·로그인 왕복은 T-W0-01(인증)·T-W0-02(R2 CORS)·T-W0-03(nginx)·T-W0-04(백업·모니터링 기반)까지로 충족되며 T-W0-05(Expo Web 활성화)·T-W0-06(모니터링 확장)은 이 DoD의 입력이 아니다. 舊 "T-W0-01~06 완료 후"는 T-W0-06(Wave 4 배정)까지 요구해 E3 §C의 "W0 코드 종료=Wave 4 / W0 DoD 판정 기점=Wave 2 완료 후" 이원 선언과 모순됐다 — E3 §C가 정본, 본 행을 그에 맞춰 정정) | `https://api.<도메인>/health` 외부 도달 + 웹 오리진 로그인 왕복 실측 — 증적: `curl -i` 응답 전문 + 로그인 왕복 스크린캡처, 경로 `reviews/dod-evidence/w0/`(E5§C 인용) |
| T-NC-02 | 08§E-1, 08§A W0 선행조건, EXEC-PLAN G9 | 법무/운영 지원(접수)→조율자(에스컬레이션) | W0 착수 전 | 사용자 결정 3건: ① 도메인 ② 제온 노출 방식(Tunnel 권장) ③ 05§G MVP 착수 게이트(운전자금) 확인. **미확인 시 해당 게이트에 걸리는 태스크만 보류**(G9, EXEC-PLAN §3) |
| T-NC-03 | 02§E-0-1·08§E-3-1(동일 태스크, 양쪽 인용) | **QA 리드(FE 리드 실행 지원)**, 판정 승인 = 조율자(D10 확정 문안) | **Wave 5(T-W2-02) 착수 전 필수 완료**(EXEC-DECISIONS #2 — 舊 "W1 착수 전"은 08§A 원 문언 오독, 실질 하류는 02§E-0-1 "§E 7번의 착수 여부를 좌우") | `<input capture>` 대용량 업로드 PoC — 3환경(iOS Safari·Android Chrome·카카오 인앱 웹뷰)×2용량(500MB·1GB)×3회=18시행, 성공 16회 이상(≥89%)+iOS Safari discard 재개 3회 전건 성공. **"합격 임계값 89%(18시행 중 16회)는 가정치이며 실측 착수 전 조율자가 최종 확정한다"**(D10 확정 문안, 02§E-0-1 단서 승계 — 원 정본의 확정 주체 "테크리드"는 E1 §A-1 매핑에 따라 조율자). 증적: 시행별 로그, 경로 `reviews/dod-evidence/w1-poc/`(E5§C 표 인용 — 6-11 #8로 편입 완료) |
| T-NC-04 | 08§A W1(어르신 패널 1차) | QA 리드 | **T-W1-01+T-W1-02 완료(= `packages/ui` 토큰 게이트 완료, Wave 5) 직후 ~ T-W1-03 웹 export 스모크 사이**(D4-4 확정 문안, EVAL-ROUND-4 영역1 감점5·V-5 정정 — 舊 "T-W1-01(Wave 3)만으로 개방"은 02§E-1 "토큰 스키마 반영만으로는 이 게이트가 닫히지 않는다"·08§A 시간축 매핑 U3 "토큰 게이트 완료 → 패널 R1 순서 확정"과 어긋난 오인용이었다) | 애월·제주시 어르신 패널 1차(R1 저해상도 프로토타입) 테스트. 증적: 패널 기록, 경로 `reviews/dod-evidence/w1-panel-r1/`(E5§C 표 인용 — 6-11 #8로 편입 완료) |
| T-NC-05 | 08§A W1 DoD① | QA 리드 | T-W1-03(구독자 웹 export) 완료 후 | TTFF 실기기 3종×카카오 인앱×LTE, 각 20회(합산 60회+), p75≤4초. 증적: 60행+ 원자료 CSV + p75 계산, 경로 `reviews/dod-evidence/w1-ttff/`(E5§C 표 인용) |
| T-NC-06 | 08§A W1 DoD② | QA 리드 | T-W1-05(go. 라우트)+T-W1-06(nginx 동적라우트 폴백) 완료 후, **그리고 T-W1-03(구독자 웹 export, Wave 8a) 완료 후 — 즉 실질 기점은 Wave 8a 종료 후**(EVAL-ROUND-6 — Wave 8 분리(D6-1)로 T-W1-03 위치가 8a로 확정, EVAL-ROUND-5 영역4 감점1·U-10 정정 — 08§A W1 DoD②가 "탭 시 리다이렉트를 거쳐 콘텐츠 상세 화면이 실제로 렌더됨을 확인"을 요구하는데, 웹 빌드 자체가 존재해야 렌더가 가능하고 `expo export --platform web` 스모크·전 화면 웹 렌더 확인은 T-W1-03의 산출물이다. 舊 "T-W1-05+06 완료 후"(둘 다 Wave 4)만으로는 아직 웹 빌드가 없어 완료 판정이 불가능한 시점이었다) | 카톡 `go.` 링크 미리보기(썸네일+제목)+탭 후 리다이렉트→상세 렌더 확인. 증적: 캡처 2장 세트, 경로 `reviews/dod-evidence/w1-go-link/`(E5§C 표 인용) |
| T-NC-07 | 08§A W2 DoD 전체 | QA 리드 | W2 코드 태스크(T-W2-01~16b, EVAL-ROUND-4 영역1 감점8·V-12 정정 — 舊 "T-W2-01~16"은 D6의 16a/16b 분할이 미반영된 stale 표기였다) 전건 완료 후 | 실기기 모바일 웹 촬영→업로드→승인→송출 한 바퀴 + 관제 데스크톱1440px/태블릿1024px + Playwright 3종×3프로필 전건(자동, T-W2-07 산출물 실행 확인) + **W2 착수 시점 재현 명령으로 산출한 화면 라우트 전건 스모크**(EXEC-DECISIONS #4 인용, EVAL-ROUND-4 V-3 정정 — 계획 시점 22 + 본 계획 신설 3(T-W1-09·T-W1-10·T-W2-09) = 예상 25, 재현: `find apps/{reporter,control-center,subscriber}/app -iname '*.tsx' ! -path '*__tests__*'`에서 `_layout.tsx`류 제외, 舊 "22라우트 스모크" 고정 수치는 계획 자신이 신설하는 라우트를 반영하지 못해 실제 88%를 100%로 위장하는 문제가 있었다) + 주민 링크 업로드 1건 + CF Stream 상태조회 + 링크아웃 클릭 계측 1건 + **미성년자 승인 전이가드 구현 완료 확인**(02§E-20, 08§A W2 DoD 최종 항목 — EVAL-ROUND-4 영역1 감점2·V-2 신설, 원천 열이 "W2 DoD 전체"라 선언했음에도 7항목 중 이 항목이 누락돼 있었다·E5§C W2 행과 항목 수 일치). 증적: Playwright HTML 리포트+실기기 캡처 시퀀스+CF Stream API 응답+라우트 스모크 로그, 경로 `reviews/dod-evidence/w2/`(E5§C 표 인용) |
| T-NC-08 | 08§E-1-1 | **사용자**(법무/운영 지원: 절차 정리·문서 준비·상태 추적)(DD4, E1§A 법무/운영 지원 금지 칸 확정 인용 — "대외 계정 개설·심사 제출 등 사용자 본인 인증이 필요한 행위의 대행 불가") | **W3 착수 8주 전 개시**(리드타임 크리티컬 패스) | Apple Developer Program 조직 계정(D-U-N-S 선행) + Google Play Console 개설 |
| T-NC-09 | 08§E-10, 04§H-1 R4 | **사용자**(법무/운영 지원: 절차 정리·문서 준비·상태 추적)(DD4, 동일 인용) | 사업자등록 완료 직후(리드타임 2~4주) | Meta App Review + Business Verification 신청. 미완료 시 FB 동시송출 없이 YouTube 단독 첫 방송 가능(04§H-1 R4, 기획+PO 리스크 수용 서명) |
| T-NC-10 | 08§A W3 DoD | **사용자**(스토어 제출·심사 대응 — 본인 인증 행위) + **법무/운영 지원**(절차 정리·상태 추적), 판정 승인 = **조율자**(DDD4 확정 문안, EVAL-ROUND-3 영역1 감점4·Z-13 정정 — 舊 "조율자(사용자 승인 동반)"는 E1§A-1 "기획(PM)=조율자" 매핑상 실행자=승인자 동일 주체가 되어 D5 구현자≠승인자 원칙과 충돌했다) | T-W3-01~04 완료 + T-NC-08 완료 | Play 스토어 게시 + App Store 심사 통과(리젝 시 02§D 플랜B). 증적 경로 `reviews/dod-evidence/w3/`(E5§C 표 인용) |
| T-NC-11 | 08§E-8 | 인프라 담당 | W2 DoD 충족 후 상시(월 1회) | 클라우드 전환 트리거 대시보드(다운타임·p95) 월 1회 리뷰 캘린더 등록 — 수치 자체는 08§C·05§C 인용(재정의 아님) |
| T-NC-12 | 08§E-9 | PMO | W2 DoD 충족 이후 상시(월 1회) | 커머스 2단계(자체 결제) 착수 트리거 월 1회 리뷰 — 수치 자체는 05 소유(08§A "커머스 2단계 트랙과의 관계" 인용) |
| T-NC-13 | 08§A W4 DoD(EVAL-ROUND-1 영역1 감점3·X-10 신설 — E5§C가 이미 정의한 절차의 태스크 편입) | QA 리드 | T-W4-01·T-W4-02 완료 후 | **판정 명령 재설계(DD3 확정 문안 그대로 인용, EVAL-ROUND-2 영역7 감점1·Y-5 — 舊 명령은 자기 매칭 3건+정상서술 1건으로 0건 반환이 구조적으로 불가능했다)**: 명령①(문자열 잔재) `grep -rn "expo-env\.d\.ts\|EAS Build" CLAUDE.md docs/ --exclude-dir=exec` — 통과 기준 0건. 단 `CLAUDE.md`의 개발 편의 안내 문맥(예: §9 "Expo Go로 충분·EAS Build 불요")의 히트는 잔재가 아니므로 제외 가능 — 제외 시 판정자가 히트별 문맥 1줄을 증적에 기재(무설명 제외 금지). W4에서 CLAUDE.md §9가 웹 절차로 대체되면 제외 사유 자체가 소멸함을 부기. 명령②(배포 경로 잔재) `eas.json` 부재 확인(`ls eas.json` → 없음) + `grep -rn "eas build\|eas submit\|expo build" .github/workflows/ apps/*/package.json` → 0건. 증적: 두 명령의 실행 전문 + CI yaml에 웹 E2E 필수 게이트 존재 인용. 저장 위치 `reviews/dod-evidence/w4/`(불변, E5§C W4 행과 동일 문안 — 한쪽만 고치면 두 문서가 다른 명령을 갖게 되므로 동시 갱신 원칙) |
| T-NC-14 | 02§E-21(센터 운영 몫, EVAL-ROUND-2 영역1 감점2·Y-15 신설) | 법무/운영 지원(02§E-21 "센터 운영" 사상 인용, §B) | T-W1-10 완료 후 | 방송별 HLS URL 게시 절차 문서 1건 + 첫 방송 전 리허설 1회 기록 — 02§E-21이 명시한 "센터 운영(방송별 URL 게시 절차)" 몫. 정적 편성표 페이지(T-W1-10)만으로는 08§B 생존 매트릭스·04§B④ "라이브 신규 진입 완화책"이 작동하지 않는다(게시 절차 부재 시 페이지는 있어도 URL이 안 채워짐). 증적: 절차 문서 + 리허설 기록, 경로 `reviews/dod-evidence/broadcast-url-procedure/`(DDD2 확정 — EVAL-ROUND-3 영역1 Z-14 정정: E5§C가 이 경로의 정본이다 — E2 §E 서두 "증적 경로는 E5 §C를 그대로 인용(재정의 금지)" 원칙에 따라 舊 `ops-review.md`(1회성 절차 증적에 상시 리뷰 누적 전용 경로를 오적용했던 것)를 정정. `ops-review.md`는 T-NC-11·12·15(상시 리뷰) 전용으로 남는다) |
| T-NC-15 | 08§B "복구 리허설을 분기 1회"(EVAL-ROUND-2 영역1 감점3·Y-16 신설) | 인프라 담당 | T-W0-04 완료 후 상시(분기 1회) | PG 덤프→복원 리허설 결과 1행씩 누적 — 08§B "복구 리허설을 분기 1회 — 백업은 복구 검증 전까지 백업이 아니다"의 유일한 실행 슬롯(舊 T-W0-04는 "백업 산출물 R2 도달 확인 1회"까지만 검증했고, T-NC-11·12(월 1회 상시 리뷰)와 동일 성격의 상시 항목임에도 배제돼 있었다). 증적 경로 `reviews/dod-evidence/ops-review.md`(T-NC-14와 파일 공유 — 상시 운영 로그 성격 동일) |
| T-NC-16(EVAL-ROUND-6 D6-3 신설) | 08§A 시간축 매핑표 "런칭 직전 — 패널 R2(스테이징 빌드)" 행(03§B-1, 실 4G·카톡 환경) | QA 리드(실행)·조율자(승인) | **W1 DoD 충족 직전**(최종 스테이징 검증 단계, D6-3 문안 그대로 인용) | 스테이징 빌드 기반 03§B-1 어르신 패널 R2 테스트(실 4G·카톡 환경) 결과. 증적: 세션 기록/리포트, 경로 `reviews/dod-evidence/` 하위(정확한 경로명은 E5§C가 확정 — 본 문서는 재정의하지 않음, D6-3) |
| T-NC-17(EVAL-ROUND-6 D6-3 신설) | 08§A 시간축 매핑표 "런칭 4주 후 — 패널 R3(실사용 로그+재방문 인터뷰)" 행(03§B-1) | QA 리드(실행)·조율자(승인) | **W1 DoD 충족 + 4주**(W2·W3 진행과 병행, 비차단, D6-3 문안 그대로 인용) | 실사용 로그 분석 + 재방문 인터뷰 결과. 증적: 세션 기록/리포트, 경로 `reviews/dod-evidence/` 하위(E5§C 확정, D6-3) |
| T-NC-18(EVAL-ROUND-6 D6-3 신설) | 08§A 시간축 매핑표 "03§B-4 공급자(기자·주민) 사용성 검증 — 1차" 행 | QA 리드(실행)·조율자(승인) | **W2 DoD 충족 직전**(= "첫 촬영 재개(전)" 행과 동일 시점, 기자 앱 웹 전환 검증 국면, D6-3 문안) | 웹 전환된 기자 실제 플로우(촬영→업로드→자막 입력) 검증. 03 리스크 9 트리거(자막 입력 이탈 2명 이상 또는 완료율 90% 미만) 관측. 증적: 세션 기록/리포트, 경로 `reviews/dod-evidence/` 하위(E5§C 확정, D6-3) |
| T-NC-19(EVAL-ROUND-6 D6-3 신설) | 08§A 시간축 매핑표 "03§B-4 공급자(기자·주민) 사용성 검증 — 2차" 행 | QA 리드(실행)·조율자(승인) | **첫 촬영 재개 후 4주**(패널 R3 행과 동일 앵커 원칙, D6-3 문안) | 03§B-4 1차와 동일 검증 반복. 증적: 세션 기록/리포트, 경로 `reviews/dod-evidence/` 하위(E5§C 확정, D6-3) |

**코드 외 태스크: 19건.**(D6-3 확정 — 기존 15 + T-NC-16~19 신설, 08§A 시간축 매핑표가 W축에 결박한 활동 4종의 태스크화. 단가 5만/건 불변 → 19건=95만, D6-3)

## F. 커버리지 선언 (EVAL-ROUND-1 영역1 감점1·영역8 감점5·X-11 전면 재작성 — 라벨→태스크 전건 대사표 + 실행 grep)

**Q1 원칙 준수**: 아래는 실제 실행한 명령과 그 출력을 그대로 인용한다(허위 확인 금지).

```
$ grep -nE "^[0-9]+(-[0-9]+)?\. \[ \]" docs/plan/02-web-architecture.md | wc -l
28
$ grep -nE "^[0-9]+(-[0-9]+)?\. \[ \]" docs/plan/08-rollout-transition.md | wc -l
13
```

(전문은 조율자 재현 시 `grep -nE "^[0-9]+(-[0-9]+)?\. \[ \]" 02-web-architecture.md`·`08-rollout-transition.md`로
재생성 가능 — 02는 395~422행, 08은 163~175행.)

### F-1. 02§E 28라벨 → 태스크 ID 전건 대사표

| 라벨 | 태스크 ID | 분류 |
|---|---|---|
| 0 | T-W0-05 | 1:1 |
| 0-1 | T-NC-03 | 1:1 |
| 1 | T-W1-01 + T-W1-02 | 분할 |
| 1-1 | T-W2-05 + T-W2-06 | 분할 |
| 2 | T-W0-01 | 1:1 |
| 3 | T-W0-02 | 1:1 |
| 4 | T-W1-03 | 1:1 |
| 4-1 | T-W1-04 + T-W1-11b | **분할**(EVAL-ROUND-3 영역1 감점1·Z-1 정정 — 舊 "1:1"은 02§E-4-1이 명시한 4요소 중 4번째(배포 파이프라인 CF 캐시 퍼지)를 T-W1-11b가 담당한다는 사실(T-W1-11b 원천 열 "02§E-4-1(CF 퍼지 CI 스텝)" 자기 자신의 기재)과 모순됐다) |
| 5 | T-W1-05 | 1:1 |
| 6 | T-W0-03 + T-W1-06 | 분할 |
| 7 | T-W2-01 + T-W2-02 + T-W2-03 | 분할 |
| 8 | T-W2-04 | 1:1 |
| 9 | T-W1-11a + T-W1-11b + T-W2-07 | 분할 |
| 10 | T-W3-02 + T-W3-03 + T-W3-04 + T-NC-10 | 분할(EVAL-ROUND-3 영역1 감점2·Z-2 정정 — 02§E-10 원문 담당이 "FE 리드(빌드)+테크리드(심사 제출)" 이원인데 심사 제출 몫(=T-NC-10)이 빠져 있었다. F-2 08§E-6 매핑은 이미 T-NC-10을 포함하고 있어 두 대사표가 불일치했다) |
| 11 | T-TRIG-03 | 트리거 |
| 12 | T-TRIG-01 | 트리거 |
| 13 | T-W2-08 + T-W2-09 | 분할 |
| 14 | T-W2-10 | 1:1 |
| 15 | T-TRIG-02 | 트리거 |
| 16 | T-W1-07a + T-W1-07b + T-W1-08 | 분할(DD1 — 舊 "T-W1-07+T-W1-08" 2건에서 07 분할로 3건, 분류(분할) 자체는 불변) |
| 17 | T-W1-09 | 1:1 |
| 18 | T-W1-11b | 1:1(T-W1-11b는 9·4-1번의 CI 하위 조각도 함께 구현 — 그 태스크가 "여러 라벨을 서비스"하는 것과 "18번 자신이 1개 태스크에 매핑"되는 것은 별개 판정이다) |
| 19 | T-W2-11 + T-W2-12 | 분할 |
| 20 | T-W2-13 + T-W2-14 | 분할 |
| 21 | T-W1-10 + T-NC-14 | **분할**(EVAL-ROUND-2 영역1 감점2·Y-15 정정 — 舊 "1:1"은 02§E-21 담당 이원("FE 리드(페이지 구현)+센터 운영(방송별 URL 게시 절차)") 중 센터 운영 몫을 태스크화하지 않은 채 판정한 오류였다) |
| 22 | T-W4-03 | 1:1 |
| 23 | T-W3-01 | 1:1 |
| 24 | T-W4-01 | 1:1 |

**요약 산식(재현, EVAL-ROUND-3 정정 — 4-1번 재분류 반영, Z-1)**: 1:1 = {0,0-1,2,3,4,5,8,14,17,18,22,23,24} =
**13건**. 분할 = {1,1-1,4-1,6,7,9,10,13,16,19,20,21} = **12건**. 트리거 = {11,12,15} = **3건**. 합계 13+12+3 =
**28 = 라벨 총수와 일치**(舊 산식 "1:1 14·분할 11"은 4-1번을 1:1로 오분류했던 결과 — 정정 완료).

### F-2. 08§E 13라벨 → 태스크 ID 전건 대사표

| 라벨 | 태스크 ID/처리 | 분류 |
|---|---|---|
| 1 | T-NC-02 | 비코드 |
| 1-1 | T-NC-08 | 비코드 |
| 2 | T-W0-01 + T-W0-02 + T-W0-03(코드) — "W0: CF 존·CORS·쿠키인증·R2 CORS·nginx web" 롤업 | 코드+롤업 겸용(1회만 계상) |
| 3 | T-W0-04 | 코드 |
| **3-1** | **T-NC-03**(舊 라운드 §F가 원천 열에는 인용해 두고도 F표 자체에 행을 누락 — EVAL-ROUND-1 영역1 감점1·X-11로 적발돼 이번에 명시 계상) | 비코드(PoC) |
| 3-2 | T-W0-06 | 코드 |
| 4 | W1 롤업 — T-W1-01·02·03·04·05·06·**07a·07b**·08·09·10·11a·11b + T-NC-03·04(개별 태스크 인용, 중복 계상 아님. EVAL-ROUND-4 영역1 감점8·V-12 정정 — 舊 "07" 단일 ID는 DD1의 07a/07b 분할이 미반영된 stale 표기로 12 ID가 나열돼 실제 W1 13건과 불일치했다) | 롤업 |
| 5 | W2 롤업 — T-W2-01~16b + T-NC-07(개별 태스크 인용) | 롤업 |
| 6 | T-W1-11b(installability) + T-W3-02·03·04(PWA/TWA/iOS) + T-NC-10(심사) | 롤업 |
| 7 | T-W4-01 + T-W4-02 + T-W4-03 | 롤업 |
| 8 | T-NC-11 | 비코드 |
| 9 | T-NC-12 | 비코드 |
| 10 | T-NC-09 | 비코드 |

**계상 확인**: 코드 3건(2·3·3-2) + 비코드 5건(1·1-1·8·9·10) + PoC 1건(3-1, 신규 계상) + 롤업 4건(4·5·6·7, 2번은
코드와 겸용이라 별도 카운트 아님) = **13 = 라벨 총수와 일치**(舊 산식은 3-1이 어느 군에도 명시 행이 없어 12건
행으로만 서술됐다 — 정정 완료).

### F-3. 그 외 매핑

| 정본 항목군 | 라벨 수 | 매핑 | 결과 |
|---|---|---|---|
| 08§A W2 DoD 중 04 R10 인용 | 1 | T-W2-15 + T-W2-16a + T-W2-16b(코드) + T-NC-07(실측 통합) | 매핑 완료 |
| 08§B "복구 리허설을 분기 1회"(EVAL-ROUND-2 영역1 감점3·Y-16 신설 — 08§E 13라벨 밖의 §B 프로즈 항목, T-W0-06이 08§B "보안사고 대응"을 인용한 것과 동형) | — | T-NC-15 | 매핑 완료 |
| 08§A 시간축 매핑표(W축 결박 4활동 — 패널 R2·R3, 03§B-4 1·2차) | — | **T-NC-16~19(태스크화, EVAL-ROUND-6 D6-3 확정)** — 舊 "E3 소유 경계"로 태스크화하지 않았던 것은 §0 비범위 선언 어디에도 이 4활동을 명시 제외하지 않은 채 누락된 상태라 비대칭이었다(D6-3 배경 그대로 인용). 08§A 시간축 매핑표의 나머지 행(패널 R1=T-NC-04, 앵커 2/3/4, M1~M12=05 소유)은 기존대로 각자의 매핑을 유지 — 이 4행만 누락돼 있었다 | 매핑 완료(D6-3 정정) |

**전건 매핑 — 누락 0건**(신규 범위 발명 0건, §0 비범위 선언 3항목 제외 확인, 실행한 grep 재현 결과와 라벨 수
일치). **총 태스크 수 재계산(EVAL-ROUND-6 반영 — DD1 T-W1-07 분할 42→43, DD5 T-NC 13→15, D6-3 T-NC 15→19)**: 코드 **43건**
(W0 6·W1 13·W2 17·W3 4·W4 3) + 트리거대기 3건 + 코드외 **19건**(T-NC-16~19 신설 반영, D6-3) = **65건**.

## G. 리스크 테이블

| 리스크 | 완화책 | 담당 | 발동 트리거 |
|---|---|---|---|
| 태스크 크기 산정이 계획 시점 근사치라 실제 diff가 10개 대략을 크게 초과 | 자가검증(게이트①) 직전 실제 변경 파일 수를 서브에이전트가 스스로 보고 — **50% 이상 초과**(예상 10 → 실제 15+) 시 태스크를 진행 완료하지 않고 조율자에게 분할 재요청 | 구현 에이전트→조율자 | 게이트① 직전 실측 파일 수가 계획 대비 1.5배 초과 |
| 동일 앱 내 여러 태스크(예: 기자 앱 T-W2-01~03·05)가 실제로는 파일이 겹쳐 병렬 시 충돌 | 계획 시점 파일 소유권은 근사치임을 명시 — **착수 직전 조율자가 실측 grep으로 파일 집합을 재확인**한 뒤 E3 웨이브 배정을 확정(PIVOT-PLAN Q1 "확인=실행한 결과만" 동형 적용) | 조율자 | 동일 워크스페이스 내 2개 이상 태스크가 같은 웨이브에 배정되기 직전 |
| `테크리드`·`PO`·`사업총괄` 등 원문 역할이 E1 6개 역할군에 정식 편입되지 않은 채 실행 진행 | §B 사상표를 잠정 적용하되, E1 확정본 발표 시 사상표를 즉시 재검증(아래 신규 위임 목록 참조) | 조율자 | E1 문서 최초 작성 완료 시 |
| Prisma 스키마 변경 태스크(T-W2-08·T-W2-13·T-W3-01) 3건이 서로 다른 시점에 스키마를 건드려 마이그레이션 순서 꼬임 | 3건 모두 [SOLO] 지정 + E3가 순차 웨이브로만 배정(동시 진행 금지) — 순서: T-W2-08 → T-W2-13 → T-W3-01(W축 순서와 일치, 별도 조정 불요) | BE 리드+조율자 | E3 웨이브 편성 시 상시 확인 |
| 코드 외 태스크(T-NC 계열)가 물리 기기·외부 심사 의존이라 "완료" 판정 기준이 코드 태스크(qa-verifier)와 다름 | §E 표에 QA 리드 담당·증적 경로를 명시하고, 판정 승인은 E5§C 원칙대로 조율자가 최종 확인(실측 실행↔승인 역할 분리) | QA 리드→조율자 | 상시 |
| **공유 진입점 파일(`services/api/src/app.module.ts`) 동시 편집**(D4, EVAL-ROUND-1 영역3 감점4·영역4 감점1·X-14 — 리포 실측 **17모듈**(EVAL-ROUND-2 영역1 감점1·Y-1 정정, 재현 명령은 T-W1-05 행 각주 참조) 전부 이 파일에 등록, 신규 api 모듈 태스크 T-W1-05·T-W1-08·T-W2-08·T-W3-01이 전부 이 파일을 편집) | `app.module.ts`를 **준-공용 자산**(동시성 1, SOLO 승격은 불요)으로 지정 — 같은 웨이브에 신규 api 모듈 태스크 2건 이상 배치 금지(E3 §B·§C가 소비) | 조율자 | 웨이브 편성 시 상시 |
| **루트 `pnpm-lock.yaml` 동시 갱신 충돌**(EVAL-ROUND-6 D6-1 신설 — 신규 npm 의존성을 추가하는 태스크 실측 4종: T-W1-03 hls.js·T-W1-04 Workbox·T-W1-11a Playwright·T-W3-01 web-push. 같은 웨이브에 2건 이상 배치되면 lockfile 동시 갱신이 충돌) | `pnpm-lock.yaml`을 `app.module.ts`와 동형의 **준-공용 자산**(동시성 1, SOLO 승격 불요)으로 지정 — **신규 의존성 추가 태스크는 웨이브당 1건**만 배치(E3 §B·§C가 소비, Wave 8 위반 해소를 위한 재배치 반영). `pnpm install --frozen-lockfile` 성공을 게이트①·qa-verifier 재현 범위에 포함(D6-1) | 조율자 | 웨이브 편성 시 상시 |

## H. 실행 체크리스트

- [ ] 각 태스크 착수 전 파일 소유권 실측 재확인(G3, 위 리스크 표 2행)
- [ ] [SOLO] 태스크 **7건**(T-W0-05·T-W1-01·T-W1-11b·T-W2-08·T-W2-13·T-W3-01·T-W4-02, EVAL-ROUND-2 영역3 감점1·
      Y-11 정정 — 舊 "8건(…7건)" 자기모순 표기를 단문화)이 D6 분할(T-W1-11→11a/11b) 후에도 그대로 7건 불변임을
      재확인, E3에서 전부 단독 웨이브로 배정됐는지 확인
- [ ] 트리거 대기 코드 태스크 3건(§D)이 정상 웨이브에 잘못 편입되지 않았는지 확인
- [ ] 코드 외 태스크 **19건**(§E, T-NC-13·14·15·16·17·18·19 포함, D6-3 반영)이 E3에서 "게이트 대기 트랙"으로 별도 표기됐는지 확인
- [ ] 커버리지 선언(§F) 갱신 시 02§E·08§E 항목 수 grep 재실행(라벨 수 변동 여부 확인) — 실행 명령·출력 동봉 의무
- [ ] `app.module.ts` 준-공용 자산 규칙(D4) 준수 — 신규 api 모듈 태스크(T-W1-05·08·T-W2-08·T-W3-01) 동일 웨이브 배치 금지
- [ ] `pnpm-lock.yaml` 준-공용 자산 규칙(EVAL-ROUND-6 D6-1) 준수 — 신규 의존성 추가 태스크(T-W1-03·04·11a·T-W3-01) 동일 웨이브 배치 금지, `pnpm install --frozen-lockfile` 게이트① 로그 포함 확인
- [ ] 신규 위임 발생 시 완료 보고에 즉시 등재(§신규 위임 목록 갱신)

## 신규 위임 목록 (등재 책임 규칙에 따라 제출)

**상태 SSOT(D7, EVAL-ROUND-1 영역8 감점3·X-3)**: 아래 표는 **발주 시점 스냅샷**이며, 처리 상태의 정본은
[PIVOT-PLAN §6-11](../PIVOT-PLAN.md)이다. 상태 열은 `→ 6-11 #n 참조`로만 표기하고 개별 갱신하지 않는다.

| # | 발주처 | 수신처 | 요청 내용 | 상태 |
|---|---|---|---|---|
| 1 | E5 §D(등재 책임 규칙)·조율자 추가지시 | **E2**(본 문서) | W1·W2 DoD 실측 태스크의 실측 담당(QA 리드)·증적 경로(`reviews/dod-evidence/`)를 산출물란에 명시 | → 6-11 #3 참조 |
| 2 | E2 §B | **E1**(역할군 정의) | "테크리드"·"PO"·"사업총괄"·"센터 운영" 등 마스터플랜 시대 담당 표기를 E1의 6개 상근 역할군 체계에 공식 편입 요청 | → 6-11 #7 참조 |
| 3 | E2 §E(T-NC-03·04) | **E5**(§C DoD 판정 절차 표) | PoC(`w1-poc/`)·어르신 패널 1차(`w1-panel-r1/`) 2건의 증적 경로를 E5§C 표에 정식 행으로 추가 | → 6-11 #8 참조 |
| 4 | E2 §C(W3) | **E4**(토큰·모델 배분) | T-W3-04(iOS 쉘 WKWebView 래퍼) 파일 수 가정치의 확장 가능성을 토큰 예산 산정에 반영 요청 | → 6-11 #11 참조 |
| 5 | E2 §0 비범위 선언 | **PIVOT-PLAN §6**(대장 소유자) | 위 4건을 "6-11. EXEC 웨이브 신규 위임" 소절에 편입 | → 6-11 #4 참조(소절 신설 자체로 종결) |
| 6 | E5 §A 게이트③(주체 확정 — E5 라운드1 수정 완료 보고 제출분) | **E2**(본 문서 검증자 열) | "개별 워크스페이스 회귀 = QA 리드 / 공용 자산 루트 전체 회귀 = QA 리드가 실행하고 조율자가 결과 수신" 문구로 검증자 열 통일 | → 6-11 #12 참조(등재 예정) — **수신 완료, 본 라운드에 즉시 반영**(§C 공통 검증자 표기 문단 + T-W0-05·T-W1-01·T-W1-11b·T-W2-08·T-W2-13·T-W3-01·T-W4-02 검증자 열 7건 전건 치환) |

**라운드 1 수정에서 발생한 신규 위임**: 없음 — 본 라운드는 EXEC-EVAL-ROUND-1·EXEC-ROUND-1-DECISIONS·조율자 추가
지시(E5 게이트③ 확정)가 이미 확정한 문안(D1·D2·D4·D6·D7·D10 + E5 신규 위임 #6)을 그대로 인용·적용했을 뿐,
E2가 자체적으로 새 문서 간 위임을 만들지 않았다.

**라운드 2 수정에서 발생한 신규 위임**: 없음 — EXEC-EVAL-ROUND-2·EXEC-ROUND-2-DECISIONS(DD1~DD5)가 이미 확정한
문안만 인용·적용했다(T-NC-14·15 신설은 E2 내부 태스크 추가라 문서 간 위임이 아님, DD4 담당 정정은 E1의 기존
확정 문구를 grep 재확인 후 인용한 것). E5§C의 동일 문안(DD3 W4 판정·DD4 T-NC-09) 동시 갱신은 조율자 지시상
C팀 소관이라 본 문서가 별도 발주하지 않는다.
