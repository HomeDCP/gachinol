# CLAUDE.md — Gachinol (제주 마을방송국 통합 플랫폼)

> 이 파일은 Claude Code와 개발자가 매 세션 참조하는 프로젝트 기준 문서다.
> 결정이 바뀌면 이 파일부터 갱신한다.

## 0. 개발원칙 (2026-08-31 사용자 지시로 개정 — 이 절이 §1~§12보다 우선한다)

### 0-1. 역할
- **조율자(메인 세션) = 관리자다.** 요구·지시·발주하고, 보고를 종합해 다시 일을 시킨다.
  페르소나는 **경력 30년차 풀스택 개발자 겸 데브옵스** — 정체된 프로젝트를 **근원부터** 고친다.
- **실제 개발은 서브에이전트(AI 팀원)가 한다.** 팀 정의는 `.claude/agents/` — 6롤
  (`implementer`·`verifier`·`wiring-auditor`·`ops-prober`·`scribe`·`planner`).
- **조율자는 코드를 쓰지 않는다(예외 0).** 문서 갱신도 `scribe` 몫이다.
  조율자가 직접 실측하는 것은 **6가지뿐**: 위임문에 넣는 수치 · 기준선(before) · 환경 기댓값 ·
  CI 상태(워크플로·잡 단위) · 보고 1건당 주장 1개 무작위 재실행 · 배포 후 실물.
  **"90% 온 것을 대신 마무리"는 금지** — 그 순간 검증 분리가 무너진다.

### 0-2. 사용자에게 보고하는 시점 (이때만)
1. **전체계획이 수정되고 만들어질 때**
2. **수정을 2차례 이상 했는데도 문제가 해결되지 않고 반복될 때**
3. **외부배선·시크릿배선 등 스스로 못 해 권한·작업을 요청해야 할 때**
4. **기능상의 문제가 아닌 결정의 문제일 때**

### 0-3. 커밋·배포 경계선
- **①브랜치 생성 → ②변경 → ③로컬 3게이트(`lint`+`typecheck`+`test`) → ④커밋 → ⑤푸시 →
  ⑥PR → ⑦CI 3종 워크플로·잡 단위 확인 → ⑧독립 검증 → ⑨PR ready + 머지 제출서**까지 **자동**.
- **⑩머지는 사람.** 예외 없다 — **main 머지 = 제온 프로덕션 자동 배포**이기 때문이다.
- 자동 커밋을 **멈추고 사람에게 넘기는 경우**: 정본 문언 변경 · 결정의 문제 · **같은 결함 3번째 수리** ·
  되돌리기 어려운 것(`DROP COLUMN`·프로덕션 DB·제온 env·nftables·시크릿) · 계획에 없는 범위 신설 ·
  **테스트 계수가 줄면서 초록이 될 때** · 수치를 그 자리에서 재실행하지 못했을 때.
- ⚠️ **`Closes #N`·`Fixes #N` 금지**(전역 CLAUDE.md 규칙의 프로젝트 예외 — `DISCIPLINES.md` §20).
  **대장 번호(#1~#189)와 PR 번호(#1~#80)의 범위가 겹쳐 무관한 PR을 닫는다.**
  대신 `Refs: <태스크ID>, 대장 #N`.

### 0-4. 순서·핸드오프·보고서
- **개발 순서의 단일 원천은 [docs/plan/exec/QUEUE.md](docs/plan/exec/QUEUE.md)** — 그 순서를 따라 개발한다.
  판정은 **L0~L5 사전식 사다리**(선행 실구동 → 도달 경로 → 실발생 결함 → MVP 조각 → 시니어 사용성 → 나머지).
  ⭐ **검사 범위 확장은 순서가 아니라 동반 의무(D1)** — 순서에 넣으면 항상 뒤로 밀린다.
- **컨텍스트가 길어지면 압축해 핸드오프로 넘긴다.** 부족분은 문서로 추적한다.
  세션 인계는 `exec/HANDOFF.md`(가변 값을 적지 말고 **명령**을 적는다).
- **일간 보고서 매일**(`docs/ops/daily/`), **토요일 주간 보고서**(`docs/ops/weekly/`).
  ⚠️ **보고서는 쓰지 말고 생성한다** — 사람이 쓰는 부분은 맨 위 "사용자 결정 대기" 한 블록뿐이다.

### 0-5. 반드시 먼저 읽을 문서
| 문서 | 무엇의 원천 |
|---|---|
| [exec/ROOT-CAUSE-2026-08.md](docs/plan/exec/ROOT-CAUSE-2026-08.md) | **왜 정체됐는가** — 검사가 닿지 않는 축에만 결함이 산다 |
| [exec/DISCIPLINES.md](docs/plan/exec/DISCIPLINES.md) | **규율 19개 + 프로젝트 예외** (개인 메모리에서 이주) |
| [exec/QUEUE.md](docs/plan/exec/QUEUE.md) | **개발 순서** |
| [exec/HANDOFF.md](docs/plan/exec/HANDOFF.md) | 세션 인계 |
| `PIVOT-PLAN.md` §6-* | 결함 대장 |
| `exec/E2-work-breakdown.md` | 태스크 범위·DoD |

## 1. 한 줄 정의

제주도의 **로컬 마을방송국 12개 지사**와 이를 총괄하는 **제주방송센터**(컨트롤타워)를 하나의
플랫폼으로 묶어, 촬영·자동편집·다채널 송출·라이브·시청·수익화까지 잇는 방송 시스템.

## 2. 프로젝트 비전 / 도메인 배경

- **조직도 (허브 앤 스포크)**
  - **제주방송센터** = 중심국·컨트롤타워 (12개 지사 취합·라이브·관제)
  - **12개 지사(마을방송국)** = 현장 취재·촬영. 현재 애월·제주시 2곳 설립, 작년까지 운영 → **현재 휴무**
  - 각 지사는 **카카오톡 채널**을 배포 창구로 보유 (총 12개 개설됨). 업로드 → 친구 알림 → 모바일 카톡에서 즉시 시청
    - ⚠️ 카카오는 **채널 직접 발행 API가 없음**(재검증 확정) → **반자동 게시 모델**: 백엔드가 게시자산(카카오최적 렌디션·캡션·썸네일·딥링크)을 준비 → 담당자가 채널 관리자 앱으로 게시. 실제 재생은 자체 앱/YouTube, 카카오는 "유입 채널". 상세 [docs/infrastructure.md](docs/infrastructure.md) §5-1
- **편성 원칙**
  - **월~금**: 12개 지사가 현장 촬영·녹화 업로드
  - **토~일**: 제주방송센터 **라이브** + 녹화방송
  - **긴급(재난·위기 등)**: 현장 즉시 라이브
- **최종 목표**: 앞으로 설립될 마을방송국들을 **한 화면에서 보고 접속해 시청**할 수 있게 한다.

## 3. 제주방송센터 콘텐츠 (6종)

1. **주간뉴스 라이브** — 12개 지사 소식 취합. **YouTube 단독 라이브**(카카오톡 채널은 유입 공지, 나머지 SNS는 링크 홍보).
   채널별 실시간 댓글을 **아나운서에게 프롬프터로 통합 제공** → 아나운서가 보며 실시간 소통·진행.
   > **스코프 이력**: 5채널 동시 라이브(불가, §5-2) → YouTube + Facebook 동시(2026-07) → **YouTube 단독**(2026-08-17 사용자 결정).
   > Facebook 제외로 **Meta App Review(리드타임 2~4주 + 팔로워 100↑ 요건)가 크리티컬 패스에서 빠진다.**
   > Meta/X/Threads 어댑터 코드는 **보존**하되 미사용(재개 시 env 게이트만 열면 된다). 상세 [docs/infrastructure.md](docs/infrastructure.md) §5-2.
2. **정치인 게스트 대담**
3. **교양 프로그램** — 독서·요리·여행지·관광·숙소·민박·지역축제·먹거리·농민·생산자 안내 등
4. **지역특화 날씨예보** ⭐ 킬러 콘셉트 — 기상청이 아닌 **이장·촌장·어촌계장의 '감'** 기반.
   "내일 이런 활동 하기 좋겠다" 식. 정확성보다 오래 산 지역민의 관점을 파는, 세상에 없던 예보.
5. **로컬 라이브커머스** — 이장·어촌계장·삼춘·부녀회장이 직접 소개·판매. 채널별 실시간 댓글 보며
   소통·이벤트·구매유도. 로컬 먹거리/생산품을 전국·전세계에 판매.
6. **B2B 미디어 세일즈** — 위에서 생산된 자료를 방송3사·종편·케이블에 **판매**.

## 4. 클라이언트 3종 — 웹앱 (+ 통합 쉘 앱 1개) ⚠️ 웹 피벗 확정 (2026-08-04)

> **웹 피벗**: 네이티브 3앱 체제를 **웹앱 3종 + 스토어 통합 쉘 앱 1개** 체제로 전환한다(사용자 승인 2026-08-04).
> 기존 Expo RN 코드는 **Expo Web(react-native-web)**으로 웹에서 재사용하고, 스마트폰 아이콘은 웹앱을 여는
> **껍데기 쉘**(Android=TWA, iOS=WKWebView+푸시·딥링크)이 담당한다. 기자·관제는 내부 사용자라 **PWA만으로 충분**
> (스토어 유지보수 대상 = 구독자 중심 통합 쉘 1개). 업데이트는 웹 배포만으로 완결(스토어 재심사 불요).
> 마스터플랜·근거·전환 단계(W0~W4)는 [docs/plan/PIVOT-PLAN.md](docs/plan/PIVOT-PLAN.md)가 단일 원천.

| 웹앱             | 위치                  | 사용자         | 핵심 기능                                                                                                                                                                             |
| ---------------- | --------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **기자 웹**      | `apps/reporter`       | 12개 지사 기자 | 촬영(웹 `<input capture>`) → 장면별 자막/내용 기입 → 분류 → 업로드. 메인서버가 최종편집해 반환 → 기자가 **저화질 미리보기** 확인 후 **승인** → 송출(카톡채널=지역방송국은 **반자동 게시**: 백엔드 게시자산 준비 → 담당자 관리자앱 게시. infra §5-1) |
| **센터 관제 웹** | `apps/control-center` | 제주방송센터   | 지사 업로드물 **자동 분석·저장** → 화면+텍스트 분석 → **매주 콘텐츠 추천** → 승인 시 즉시 송출 / 수정사항 입력 시 반영해 재생성. 라이브 관제 + 채널별 댓글 프롬프터 (웹 전환으로 데스크톱 콘솔 겸용 — 舊 "웹 콘솔 병행" 미정 항목 해소) |
| **구독자 웹**    | `apps/subscriber`     | 시청자         | 12개 지사 콘텐츠 시청 + 센터 라이브 **실시간 참여·채팅**. **URL만으로 접근·공유**(카톡 채널 유입 직결) + PWA/쉘 설치는 선택                                                            |

## 5. 기술 스택 (확정)

- **클라이언트 (웹앱 3종)**: **React Native + Expo Web**(react-native-web, TypeScript 단일 코드베이스 — 웹 피벗으로 배포 형태만 웹 전환, 기존 코드 재사용. 재사용률 실측 정본 [docs/plan/02-web-architecture.md](docs/plan/02-web-architecture.md) §B). 스토어 = **통합 쉘 1개**(Android TWA + iOS WKWebView·푸시·딥링크) + PWA 병행
- **백엔드 메인 API**: **Node.js + TypeScript + NestJS**
- **AI 분석 워커**: **Python + FastAPI** (비전/STT/요약·추천) — 무거운 ML은 여기로 분리
- **미디어 워커**: Node + **FFmpeg** (트랜스코딩·자동편집 오케스트레이션·저화질 프리뷰)
- **데이터**: PostgreSQL(관계형) · Redis(큐·캐시·실시간 pub/sub) · S3 호환 오브젝트 스토리지(영상).
  **프로덕션 스토리지 = 제온 자체 호스팅 MinIO**(2026-08-17 사용자 결정 — 백엔드와 같은 호스트, 현재 2TB NVMe `/srv/dcpwork/minio`.
  **용량 부족 시 하드디스크 증설**로 확장). 앞단 = Cloudflare(무료 티어 터널·CDN). **Cloudflare R2는 폐기가 아니라 대기 옵션**이며
  코드가 `S3_ENDPOINT`/`S3_FORCE_PATH_STYLE`로 이미 S3 호환이라 **전환은 env만**이다.
  ⚠️ **증설이 푸는 것은 용량이지 대역폭이 아니다** — 제온이 origin이면 시청 트래픽이 가정 회선 업로드를 통과한다.
  전환 트리거는 [docs/infrastructure.md](docs/infrastructure.md) §4-C가 단일 원천. 상세 §3·§4-C
- **ORM**: Prisma 6 (PostgreSQL). enum은 DB에 shared snake_case 문자열(text) 저장 — Prisma enum 금지. ID는 앱 발급 UUID v7
- **요청 검증**: zod + nestjs-zod — 스키마는 shared 계약에 satisfies로 정합 강제
- **인증**: JWT(access 15m / refresh 14d 회전+재사용 탐지) + argon2id. passport 미도입
- **큐**: BullMQ (Redis 기반). 트래픽 성장 시 Kafka 검토
- **라이브**: RTMP ingest + HLS 배포 = **Cloudflare Stream**(매니지드, 인코딩·다채널 simulcast 무료) 확정. 자체 RTMP/HLS 구축은 라이브 전송비 급증 시 재검토. [docs/infrastructure.md](docs/infrastructure.md) §4-B
- **모노레포**: pnpm workspaces + Turborepo
- **런타임**: Node 24 (`.nvmrc`), pnpm 8+
- **배포/인프라**: 컨테이너(Docker 멀티스테이지, glibc) + GitHub Actions CI/CD. 프로덕션 오케스트레이션 `infra/docker/docker-compose.prod.yml`. AI STT = **로컬 whisper.cpp + Silero VAD**(2026-08-20 결정 — 舊 RTZR API에서 변경, 근거는 비용이 아니라 **데이터 주권**. §12 참조). 서버 = 4vCPU/8GB 단일 VM 시작 → 병목별 확장. 상세 [docs/infrastructure.md](docs/infrastructure.md)

## 6. 모노레포 구조

```
gachinol/
├── apps/
│   ├── reporter/         # 기자 앱 (RN/Expo)
│   ├── control-center/   # 센터 관제 앱 (RN/Expo)
│   └── subscriber/       # 구독자 앱 (RN/Expo)
├── services/
│   ├── api/              # NestJS 메인 API (인증·콘텐츠·워크플로우·WebSocket 게이트웨이)
│   ├── media-worker/     # FFmpeg 트랜스코딩·자동편집·프리뷰
│   └── ai-worker/        # Python/FastAPI 화면+텍스트 분석·콘텐츠 추천
├── packages/
│   ├── shared/           # 공용 TS 타입·도메인 모델·API 계약·유틸
│   ├── ui/               # 공용 RN 컴포넌트·디자인시스템
│   └── config/           # 공유 eslint/tsconfig/prettier
├── infra/                # docker-compose·IaC·배포 스크립트
└── docs/                 # 아키텍처·로드맵 상세
```

## 7. 아키텍처 — 데이터/영상 흐름

```
[기자 앱] 촬영·자막·분류
   │ 업로드(원본)
   ▼
┌──────────────── 제온(192.168.0.101) = 백엔드 + 스토리지 ────────────────┐
│ [api] ──넣기──> [큐] ──> [media-worker] 트랜스코딩 → 자동편집(auto_edit) → 저화질 프리뷰
│    │                         │                        └ 기계편집 완료(2026-08-20) / 글콘티는 T-AI
│    │                    [ai-worker] 화면(비전)+텍스트(STT/요약) 분석 → 태깅·추천
│    ▼                         │
│ [오브젝트 스토리지 = MinIO]   ▼      ← 용량 부족 시 **HDD 증설**
└────│─────────────────────────│──────────────────────────────────────────┘
     │                    [센터 관제 웹] 주간 콘텐츠 추천·승인/수정
     │  기자 프리뷰 승인 ◄──────┘
     ▼  ← **기자 승인 XOR 센터 승인**(분류별 reviewPolicy) 통과분만 송출
[송출]  카카오톡 채널(반자동 게시) · YouTube(Data API 자동)
   │
   ├─ 라이브: RTMP ingest → YouTube 단독 → HLS 배포
   ├─ 댓글 수집: 채널별 실시간 댓글 → [api] 집계 → 아나운서 프롬프터
   ▼
[구독자 앱] 시청 + 라이브 채팅          [B2B] 방송3사·종편·케이블 판매
```

핵심 도메인 6개: **Ingest(수집) · Process(처리/편집) · Analyze(AI 분석) · Distribute(다채널 송출) ·
Live(라이브+댓글집계) · Monetize(라이브커머스·B2B 세일즈)**.

## 8. 외부 연동 (키는 `.env`, 목록은 `.env.example`)

- **카카오톡 채널** (유입 창구) — **직접 발행 API 없음**(확정) → 반자동 게시(담당자 관리자앱). 친구톡은 대행사 계약 시 썸네일+링크 푸시만 가능. [docs/infrastructure.md](docs/infrastructure.md) §5-1
- **YouTube Live/Data API** — VOD 업로드 + 라이브 송출 + 댓글 수집. **2026-08-17부터 실사용 SNS는 YouTube 하나뿐**
  (Meta Graph/X/Threads 어댑터 코드는 **보존**하되 미사용 — 재개 시 기존 env 게이트만 열면 된다). 스코프 이력 §5-2
- **PG(결제)** — 라이브커머스
- **비전/STT** — ai-worker

## 9. 개발 명령어

```bash
pnpm install          # 워크스페이스 전체 설치
pnpm dev              # 전체 dev (turbo)
pnpm build            # 전체 빌드
pnpm lint             # 린트
pnpm typecheck        # 타입체크
pnpm test             # 테스트
pnpm format           # prettier 포맷
```

앱/서비스별 개별 실행은 각 워크스페이스의 README 참고 (아직 스캐폴딩 전이면 부재).

```bash
# 기자 앱 (apps/reporter — Expo). API 선행 기동 + apps/reporter/.env에 EXPO_PUBLIC_API_URL 설정
pnpm --filter @gachinol/reporter dev        # Expo dev 서버 (Expo Go)
pnpm --filter @gachinol/reporter test       # jest-expo 단위 테스트
pnpm --filter @gachinol/reporter typecheck  # shared dist 선행 빌드 필요

# 센터 관제 앱 (apps/control-center — Expo). API 선행 기동 + apps/control-center/.env에 EXPO_PUBLIC_API_URL 설정
pnpm --filter @gachinol/control-center dev        # Expo dev 서버 (Expo Go)
pnpm --filter @gachinol/control-center test       # jest-expo 단위 테스트
pnpm --filter @gachinol/control-center typecheck  # shared dist 선행 빌드 필요

# 구독자 앱 (apps/subscriber — Expo, 익명 시청). API 선행 기동 + apps/subscriber/.env에 EXPO_PUBLIC_API_URL 설정
pnpm --filter @gachinol/subscriber dev        # Expo dev 서버 (Expo Go)
pnpm --filter @gachinol/subscriber test       # jest-expo 단위 테스트
pnpm --filter @gachinol/subscriber typecheck  # shared dist 선행 빌드 필요
```

### 모바일 실기 구동 (시뮬레이터·에뮬레이터·실기기)

3앱 모두 **커스텀 네이티브 0**(순수 Expo SDK + JS 라이브러리) → **Expo Go로 충분**하다. EAS Build·Apple 계정 불요.

- **`.env`의 `EXPO_PUBLIC_API_URL`은 LAN IP여야 한다.** `localhost`는 iOS 시뮬에서만 되고 **Android 에뮬에선 에뮬레이터 자신**을 가리켜 실패한다. LAN IP 하나면 시뮬·에뮬·실기기가 전부 동작한다.
- **Android SDK**는 Android Studio 없이 command-line tools만 설치돼 있다(`~/.zshrc`에 `ANDROID_HOME`·`JAVA_HOME` 설정). AVD: `gachinol-pixel`(Android 15/arm64).
- **Xcode는 외장 볼륨**(`/Volumes/DCPQC/Applications/Xcode.app`)에 있고 시스템 `xcode-select`는 CommandLineTools를 가리킨다 → `~/.zshrc`의 `DEVELOPER_DIR`로 우회(sudo 불요). **볼륨이 마운트돼 있어야 iOS가 동작한다.**

```bash
# 에뮬레이터 부팅 (Android)
emulator -avd gachinol-pixel -no-snapshot-load &

# 앱 dev 서버 (한 번에 하나 — Metro가 8081 단독 점유)
pnpm --filter @gachinol/subscriber exec expo start
```

⚠️ **앱을 바꿀 때는 Expo Go를 강제 종료해야 한다** — 같은 `exp://` URL이면 Expo Go가 재로드를 건너뛰고 **이전 앱을 그대로 띄운다**(디버깅 시 크게 헷갈림).

```bash
adb -s emulator-5554 shell am force-stop host.exp.exponent
adb -s emulator-5554 shell am start -a android.intent.action.VIEW -d "exp://<LAN-IP>:8081"
```

> 그 외 함정: ① 에뮬레이터가 둘 이상이면 adb가 "more than one device"로 실패 → `-s <id>` 명시(유령 offline 항목이 남기도 한다). ② `expo start --android`의 자동 실행은 `adb shell monkey`가 251로 죽어 실패할 수 있다 → 위 딥링크로 대체. ③ zsh는 따옴표 없는 변수를 단어 분리하지 않는다 → `ADB_ARGS="-s foo"` 같은 관용구가 안 먹는다.

```bash
# 미디어 워커 (services/media-worker — BullMQ+FFmpeg). Redis+S3(MinIO) 선행: pnpm infra:up
pnpm --filter @gachinol/media-worker dev        # tsx watch (인프로세스 부팅)
pnpm --filter @gachinol/media-worker test       # 프로파일 + 실 FFmpeg 프로세서 단위 테스트

# 미디어 파이프라인 E2E (업로드→트랜스코딩→프리뷰 완주). Postgres 필요, Redis/S3는 인프로세스 자동 조달
pnpm --filter @gachinol/api test:e2e -- media-pipeline

# 라이브+WS E2E (인프로세스 Nest app.listen(0) + 실 socket.io-client 왕복, 댓글 목). Postgres만 필요, Redis 불요
pnpm --filter @gachinol/api test:e2e -- live-ws

# ⚠️ 파이프라인 E2E는 외부 Redis/S3를 주입해야 확실히 돈다 (2026-08-20)
#  · redis-memory-server는 Redis를 소스 빌드하는데 구버전 GNU Make 환경(맥)에서 실패 → E2E가 **조용히 skip**된다
#  · s3rver는 AWS SDK v3 스트림 업로드(aws-chunked)를 디코드하지 못해 **파일을 손상**시킨다
#    (실측 24,453B→24,497B). 워커 산출물을 워커가 다시 읽는 경로(auto_edit→preview)가 이걸 밟는다.
#    MinIO는 바이트 일치 — 프로덕션 무영향.
#  Redis DB 15는 전용으로 쓰고 실행 전 비운다: docker exec gachinol-redis-1 redis-cli -n 15 FLUSHDB
E2E_REDIS_URL=redis://localhost:6379/15 E2E_S3_ENDPOINT=http://localhost:9000 \
E2E_S3_KEY=minioadmin E2E_S3_SECRET=minioadmin \
pnpm --filter @gachinol/api test:e2e -- media-pipeline
```

## 10. 컨벤션

- 언어: **한국어 우선** (커밋 메시지·문서·주석). 코드 식별자·기술용어는 영어.
- 브랜치: `main`(보호) + `feat/*` · `fix/*` · `chore/*`. main 직접 커밋 지양, PR 경유.
- 커밋: Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:` …).
- 공용 타입은 반드시 `packages/shared`에 두고 앱·서비스가 import (계약 단일화).
- `@gachinol/shared` 소비: Node 서비스는 dist(CJS), Expo 앱은 `react-native` 필드로 소스 — 소스 경로 직접 import 금지.
- **시크릿은 절대 커밋 금지.** `.env`·키파일은 `.gitignore` 처리됨. 새 키가 생기면 `.env.example`에 "이름만" 추가.
- 대용량 미디어(mp4 등)는 git 대신 오브젝트 스토리지. `.gitignore`가 막고 있음.

## 11. 현재 상태 / 로드맵

- **✅ 동의서 판단 게이트 해체 (2026-08-28, T-W2-36 — 촬영자 책임 모델, 대장 #166)**: 사용자 결정(2026-08-27)
  *"앱은 동의서를 받았는지 판단하지 않는다 — 동의서는 촬영자가 책임지고 받는다"*에 따라 미성년자 동의
  **판단 장치 전면 제거**: policyGuard ④ 승인 차단 · minor-consent 확인/철회 API · 재생성 확인 무효화(#117) ·
  fail-closed 확인기록 삭제 · DB 확인 컬럼 2개 drop · shared 술어/필터 · 관제 "동의 확인 대기" 뷰·확인/철회 UI.
  **유지**: `hasMinorSubject` 플래그·기자 체크박스(T-W2-14, 문구를 촬영자 책임 고지로 교체) · 관제 "미성년 등장"
  정보 배지(가시성). **법적 의무는 사라진 게 아니라 운영 절차(07 §3-3 액션 1 동의서 템플릿·액션 3 기자 교육)로
  이동** — 그 두 액션의 중요성이 올라갔고, 책임 구조의 법적 유효성은 07 §3-15 외부 자문 시 확인한다.
  정본 개정: 07 §3-3·02 §E-20·03 §C-2-1(만 14세 기준 정정 포함). 파급: #164 해소·#115 심각도 강등.
- **✅ 자동편집 Phase 1 완료 (2026-08-20, PR #54) — 대장 #98 종결**: `auto_edit` 구동부가 0건이라
  **수정요청이 콘텐츠를 영구 정지**시키던 결함을 닫았다. 핵심 설계는 **auto_edit이 LLM에 의존하지 않는다**는 것 —
  `editPlan`은 선택적 입력이고 null이면 컷 없이 **기계편집**(음량 정규화 loudnorm·720p 렌디션·faststart)만 하므로
  **AI·추론 노드가 전혀 없어도 파이프라인이 완주한다**(2026-08-17 PoC 실측: FFmpeg만으로 8.7초·AI 호출 0회).
  - **새 ContentStatus 0개 · 전이맵 변경 0줄 · api 신규 HTTP 경계 0개.** auto_edit은 `preview_generating` 안에서
    preview로 순차 체이닝하고, 재생성은 기존 `revision_requested→regenerating` 루프를 탄다.
  - ⚠️ **`silenceremove`를 쓰지 않는다**: `Scene.startSec`는 원본 기준이고 구독자 피드 자막(`feed.mapper.ts`
    `scenesToCaptions`)이 그 값을 그대로 쓴다. PoC 실측상 무음 제거 효과는 0.56초로 미미한데(야외는 환경음이
    계속 있다) 타임라인은 바뀌어 **전 콘텐츠 자막이 밀린다**. Phase 1의 타임라인은 **항등**이며, 항등이 깨지면
    `PipelineService.warnIfTimelineShifted`가 에러 로그로 드러낸다(컷 도입 시 Scene 재기입을 함께 구현해야 한다).
  - **재편집 소스 = `edited_master`**(실측: 원본 4K HEVC 5.33초 vs 720p 마스터 **1.06초**, 5배). preview·thumbnail·
    `durationSec`도 현 세대 edited_master를 우선한다.
  - **재생성은 자동 연쇄가 아니라 명시 트리거**(`POST /v1/contents/:id/regenerate`) — `revision_requested`는
    초안 수정이 허용되는 상태라(`EDITABLE_STATUSES`) 자동 연쇄하면 **기자가 자막을 고칠 기회가 사라진다**.
    기자앱·관제앱에 "이대로 다시 만들기" 버튼을 배선했다.
  - **대장 #117 동시 해소** — 세대가 오르면 미성년자 동의 확인 무효화. **07 정본 대조 완료(2026-08-23)**:
    §3-3에 **재생성·세대에 관한 문언이 없어** 완화안("화면 구성이 바뀐 재생성만")을 지지할 근거가 없다
    → **매번 무효화 확정**(정본의 침묵은 완화 허가가 아니다). 완화하려면 07 §3-3에 세대 문언이 먼저 필요하다.
    ⚠️ **(후속 소멸 — T-W2-36, 2026-08-28)**: 확인 개념 자체가 제거돼 이 무효화 로직도 함께 사라졌다(§11 최상단).
  - `STALLED_AUTOMATION_CONTENT_STATUSES`가 **빈 배열**이 되어 3앱의 "정지 상태" 경고가 자동으로 사라졌다(#29 ④).
  - ⚠️ **E2E 하네스 함정 2건 발견**: ① redis-memory-server가 구버전 GNU Make 환경에서 소스 빌드에 실패해
    **파이프라인 E2E가 조용히 skip**되고 있었다. ② **s3rver는 AWS SDK v3 스트림 업로드(aws-chunked)를 디코드하지
    못해 파일을 손상시킨다**(실측 24,453B → 24,497B). 기존 파이프라인은 워커 산출물을 워커가 다시 읽는 경로가
    없어 드러나지 않았다. **MinIO는 바이트 일치 — 프로덕션 무영향.** `E2E_REDIS_URL`·`E2E_S3_ENDPOINT` 주입 경로를 추가했다:
    ```bash
    E2E_REDIS_URL=redis://localhost:6379/15 E2E_S3_ENDPOINT=http://localhost:9000 \
    E2E_S3_KEY=minioadmin E2E_S3_SECRET=minioadmin pnpm --filter @gachinol/api test:e2e
    ```
  - **Phase 2 이후(맥 추론 노드·실 STT·글콘티 3지선다)는 정본대로 T-AI 트랙 · W2 완료 후**다. 설계는
    `~/.claude/plans/llm-poc-cheeky-thacker.md`(승인된 계획)에 있다.
- **🔄 웹 피벗 확정 (2026-08-04, 최우선)**: 네이티브 3앱 → **웹앱 3종 + 통합 쉘 앱** 전환 마스터플랜이
  독립 루브릭 평가 19라운드(11개 영역 전부 9.5/10+, [docs/plan/reviews/](docs/plan/reviews/))를 통과하고 **사용자 승인** 완료.
  다음 실행 = [docs/plan/08-rollout-transition.md](docs/plan/08-rollout-transition.md)의 **W0(기반)→W1(구독자 웹)→W2(기자·관제 웹)→W3(쉘·PWA)→W4(정리)**.
  네이티브 트랙은 승인 즉시 **동결**(버그픽스도 웹에서만). 착수 게이트: 05 §G 운전자금 확인 + 도메인·제온 노출 방식(사용자 결정).
  테스트 실측 최신치(**api·reporter·control-center는 2026-08-28** T-W2-36 종료 실측 / 나머지는 2026-08-20, `pnpm --filter <app> test` 재현): **api 901(+e2e 86)** · **control-center 282** · **reporter 280** · subscriber 289 · media-worker 35
  (T-W2-36 게이트 해체로 판단 스위트가 제거되며 api 942→901·관제 308→282·기자 281→280 — **줄어든 게 회귀가 아니라 제거된 판단 장치의 테스트가 함께 빠진 것**. e2e는 s3rver 함정 수리로 analysis-pipeline이 skip에서 실측으로 복귀, 89→86은 舊 게이트 e2e 재작성분)
  ⚠️ **api 기록치 923은 이번에 실측하니 936이었다**(작업 전 기준선). 이번 슬라이스가 +6/+7 했다. 舊 923은 기록 시점 이후 누적 차이가 반영되지 않은 stale 값이며, 아래 원칙이 예고한 그대로다.
  ⚠️ **shared dist가 stale이면 api 유닛이 5건 실패한다**(`isSafeLinkoutUrl is not a function`) — 코드 결함이 아니라 빌드 산출물 문제이므로 `pnpm --filter @gachinol/shared build`를 선행할 것. 기준선을 재기 전에 이걸 모르면 없는 회귀를 쫓게 된다. (ai-worker는 이번 회차 미실측 — 로컬에 pytest 미설치. 직전 기록 pytest 11) — 아래 이력 단락의 舊 계수(74·13 등)는 기록 당시 값이며, **문서의 기록치는 출처가 아니라 검증 대상이다**(위임에 수치를 적을 때는 그 자리에서 재실행할 것 — EXEC-DECISIONS #22 ⑥).
  ⚠️ 이번 재실측에서 **subscriber 기록치가 stale이었음이 드러났다**(舊 109 → 실측 289). auto_edit 작업과 무관한 누적 차이이며, 규율이 예고한 그대로다 — 수치를 인용할 때는 반드시 그 자리에서 재실행할 것.
- **✅ 영상 파이프라인 실증 완료 (2026-08-15)**: 실기 촬영본(iPhone 1080p HEVC 가로 63초·세로 `rotation=-90` 117초)으로
  **촬영본→업로드→트랜스코딩→AI분석→프리뷰→기자승인→(센터승인)→송출→시청** 한 바퀴를 제온 실배포에서 완주했다.
  3건 `published` + 카카오 목 송출 전건 성공 + 구독자 공개 피드 노출·재생(`206 video/mp4`). 회전 처리 정확(세로 406×720)·faststart 확인.
  그 과정에서만 드러난 **잠복 결함 6건을 적발·해소**(대장 #90~#95): DCP arbiter 도달 불가로 인한 미디어 큐 전역 정지 ·
  서브도메인 vhost API 프록시 부재 · react-native-web `Alert` 무력화(승인 불가) · RNW `ScrollView` 칩 레이아웃 ·
  관제 송출 미배선 · `contents.durationSec` 미기록. 상세·게이트 사각 분석은 [EXEC-DECISIONS #26](docs/plan/exec/EXEC-DECISIONS.md).
- **지금(피벗 전 이력)**: shared 완료 → **services/api 스캐폴딩+인증+콘텐츠 CRUD 완료**(Prisma·JWT 회전·상태 전이 전 구간·Swagger·시드),
  `infra/docker-compose.yml`(항목 4 선행) 가동 → **apps/reporter Expo 스캐폴딩 완료** →
  **api 미디어 파이프라인 슬라이스(shared+api) 완료**: `media_assets` Prisma 모델·마이그레이션,
  UploadModule(presigned PUT 발급 `POST /v1/contents/:id/upload-url` + 완료검증 `.../upload-complete`),
  QueueModule(BullMQ 생산자 + QueueEvents 인프로세스 리스너 = **api 유일 DB 기록자**),
  PipelineModule(잡이벤트→상태전이 매핑), ContentWorkflowService의 system-액터 전이(`applySystemTransition`, HTTP 미노출)·
  업로드 user 전이(`beginUpload`/`completeUpload`/`failUpload`), MediaModule(S3 presign·MediaAssets 멱등 upsert),
  `GET /v1/media-assets/:id/url`. 큐/S3 계약은 `packages/shared/src/media/media-job.ts`가 단일 원천.
  Redis·S3 미설정 시 부팅은 유지(기능만 비활성) → **services/media-worker + reporter 실업로드 + E2E 완료**:
  media-worker(BullMQ Worker·ffmpeg-static/ffprobe-static 트랜스코딩·프리뷰·썸네일·sha256, DB·토큰 무접근·S3만),
  reporter `HttpUploadService`(presigned PUT·진행률·취소, `useUploadService()` 훅으로 교체)·프리뷰 서명URL 재생,
  E2E 하네스(`services/api/test/media-pipeline.e2e-spec.ts` — 실 FFmpeg·실 BullMQ·인프로세스 Redis(redis-memory-server)·
  S3(s3rver)·docker Postgres로 업로드→트랜스코딩→프리뷰→`awaiting_reporter_review` 한 바퀴 실증).
  **풀 루프 완성**: 업로드→720p 렌디션·360p 프리뷰·썸네일 생성→기자 승인 대기까지 실제로 돈다.
  → **services/ai-worker(analyzing 홉) 연동 완료**: ai-worker(Python/FastAPI 순수 컴퓨트 `POST /analyze` — DB·큐·토큰 무접근,
  결정적 스텁+플러그블)를 api가 HTTP로 소비. 일반 콘텐츠는 `processing→analyzing`(analysis 큐 인큐)→ 인프로세스
  Analysis 워커가 `AI_WORKER_URL/analyze` 호출 → `ai_analyses`((content_id,generation) unique, api 유일 기록자) 멱등
  기록 + `analyzing→preview_generating`. 긴급(urgent)·AI 비활성(AI_WORKER_URL 미설정)은 `preview_generating` 직행
  패스트트랙 보존(무회귀). 계약은 `packages/shared/src/analysis/analysis-job.ts`(AnalyzeRequest/Response·큐 wire)가 단일 원천.
  → **apps/control-center Expo 스캐폴딩 완료**: 센터 role 게이트(`center_operator`·`admin`만)·검토 보드(전 지사 횡단·상태/지사/분류 필터)·
  상세(저화질 프리뷰·AI분석 vision/text·장면·수정요청·전이 이력)·센터 결정(승인/수정요청/반려 + 실패 재시도)·지사 로스터(read-only 딥링크).
  reporter 인증/클라이언트 패턴(refresh single-flight·auth 게이트·TanStack Query·secure-store·metro) 동형 이식, **shared·api 무변경**.
  주간추천·라이브 관제는 백엔드 부재로 플레이스홀더. jest-expo 단위 테스트(client·token-store·role-gate·status·actions·analysis·validation).
  → **다채널 송출(Distribute) 슬라이스 완료 (카카오 우선)**: 송출 워커를 api **인프로세스**로(analysis 홉 동형) 두고
  카카오 **목 어댑터**를 배포 기본으로 격리(실 카카오는 `KAKAO_*` env 게이트 확장점). Prisma 신규 2테이블
  `channel_accounts`·`publications`(enum성=text·UUID v7·부분 유니크 `(content,channel) WHERE status active`=멱등 하드가드).
  센터 엔드포인트 4종(전부 `center_operator`·`admin`): `POST /v1/contents/:id/distribute`(center_approved→publishing CAS +
  채널별 queued Publication + 인큐-애프터-커밋), `GET /v1/contents/:id/publications`, `POST /v1/publications/:id/{retry,retract}`.
  대상 채널 해석 우선순위 body override>`content.targetChannelAccountIds`>지사 connected kakao(vod_publish). content 전이는
  `ContentWorkflowService.beginPublishing`(CAS)·`applySystemTransition` 재사용(publishing→published/publish_failed), Publication
  전이는 shared `PUBLICATION_STATUS_TRANSITIONS` 소비(규칙 사본 금지). 채널 부분실패=`job.returnvalue` 데이터(throw 아님 →
  성공채널 재송출 방지), 채널 단위 복구는 retry 엔드포인트. 큐 wire는 api-내부 `distribution/distribution-job.ts`(워커 인프로세스라
  shared 불요). shared 추가는 `DistributeContentRequest` DTO 1건뿐. `seed.ts`에 애월·제주시 kakao 채널 멱등 upsert.
  E2E(`test/distribution-pipeline.e2e-spec.ts` — embedded redis-memory-server·s3rver·docker PG, 카카오 목 → 외부 네트워크 0):
  distribute→published 정상 + fail- 채널→publish_failed→retry→published 실증. 회귀 0(api 유닛 217·e2e 34). shared·기존 전이 무변경.
  → **라이브 + WebSocket(Live) 슬라이스 완료 (api)**: `@nestjs/websockets`+socket.io 게이트웨이(`services/api/src/live/`).
  Prisma 신규 3테이블 `live_sessions`·`live_comments`·`chat_messages`(enum성=text·UUID v7·`(channel,external)` unique=댓글 dedup 하드가드·
  `stream_key_ref`=참조 이름만). **채팅 룸=익명 공개**(닉네임=핸드셰이크 `auth.nickname`·서버 토큰버킷 레이트리밋), **프롬프터·관제 룸=JWT 게이트**
  (announcer·center_operator·admin). WS 이벤트는 shared `realtime/events.ts` 소비(재정의 0): `live.join`(`LiveJoinAck`)·`live.leave`·
  `chat.send`(`ChatMessage` ack+`chat.new` 브로드캐스트)·`prompter.join`(`PrompterJoinAck`)·`control.join`, 서버emit `live.status_changed`·
  `live.viewer_count`·`chat.new`·`chat.moderated`·`prompter.comments`. 각 핸들러 try/catch→`ws-ack.ts`(전역 필터 우회, DomainException→WsAck).
  센터 REST `@Controller('live-sessions')`(생성 불변식 emergency⇔scheduledAt=null·prepare/start/interrupt/resume/end/cancel CAS+shared
  `LIVE_SESSION_STATUS_TRANSITIONS`+`status_transition_logs`(entityType='live_session')+커밋후 브로드캐스트·`GET /:id/ingest`=streamKey 유일 노출·
  `POST /:id/chat/:messageId/hide`). 공개 `@Controller('live')` 전부 `@Public`: `GET /live/sessions`·`/sessions/:id`(화이트리스트 `toLiveSessionPublic`
  —streamKeyRef/rtmpIngestUrl 구조적 차단, status∈{scheduled,preparing,live,interrupted}). 댓글 수집=어댑터+**목 기본**(youtube/meta/x/threads 결정적,
  `fail-` 접두 throw)·실 어댑터는 기존 `YOUTUBE_*`/`META_*`/`X_*`/`THREADS_*` 키 게이트(신규 시크릿 0). `CommentCollectorService`=인프로세스·**이벤트-암드**
  (start→arm·end→disarm, 활성0=타이머0), `collectOnce`→comment_read 채널 poll→정규화→`createMany(skipDuplicates)`→collected 배치 프롬프터 푸시→prompted
  마킹(재호출 dedup). socket.io Redis 어댑터는 `afterInit`에서 `REDIS_URL` 있을 때만 주입(다중 인스턴스 fan-out·미설정=단일 인스턴스 저하). LiveModule은
  DistributionCoreModule(ChannelAccountsService)만 import→아무도 LiveModule을 import 안 함(순환 구조적 불가). E2E(`test/live-ws.e2e-spec.ts` —
  인프로세스 Nest `app.listen(0)`+실 socket.io-client 왕복, 댓글 목): 채팅 send→broadcast+DB영속·레이트리밋·프롬프터 collectOnce 푸시+dedup+익명 forbidden·
  공개 GET streamKeyRef 미유출·hide→chat.moderated·end→status_changed 실증. 회귀 0(shared·기존 모듈·전이 무변경, app.module +1줄·resetDb +3테이블).
  → **라이브 WS 앱 배선 완료 (subscriber·control-center)**: 두 앱에 `socket.io-client@^4` 추가(WS=REST와 동일 `EXPO_PUBLIC_API_URL` 오리진,
  신규 EXPO_PUBLIC 키 0). **구독자(익명 채팅)**: `src/live/live-socket.ts`(`createLiveSocket({url,nickname,socketFactory?})` — 닉네임=핸드셰이크
  `auth.nickname`, Authorization 미부착, `joinLive`/`sendChat`/`leaveLive`/`onChatNew`/`onChatModerated`/`onViewerCount`/`onLiveStatus`/`onConnect`,
  ack `{ok:false}`→`ApiClientError` 재사용)·`chat-store.ts`(id dedupe+sentAt 오름차순+hidden 제거, 순수)·`use-live-chat.ts`(connect마다 `live.join`
  재전송=재연결 룸 재구독, recentChat 시드·`chat.new` append·moderated 제거·viewer_count·status_changed, 낙관적 반영 0)·`nickname.ts`·`format.ts`.
  화면: `app/(tabs)/live.tsx`(공개 세션 목록·방송중 강조)·`app/live/[id].tsx`(닉네임 게이트→채팅, `status==='live'`에서만 전송, hlsUrl 없으면 "준비중"
  정직 표기). **관제(프롬프터·JWT)**: `src/api/client.ts`에 `getFreshAccessToken()` 추가(REST attempt의 선제 refresh 재사용)→소켓 **함수형 `auth`**로
  매 (재)연결 시 최신 access 재-auth. `src/live/live-socket.ts`(`createControlSocket({url,getToken,socketFactory?})` — `prompterJoin`→`PrompterJoinAck`·
  `controlJoin`·`onPrompterComments`/`onLiveStatus`)·`use-live-prompter.ts`(prompter.join 재전송·recentComments 시드·`prompter.comments` 배치 누적·
  status_changed)·`features/live/{prompter-store,validation,labels}.ts`(prompter-store=postedAt dedupe+질문 선별, validation=emergency⇔scheduledAt 불변식
  사전검증, labels=라이프사이클 액션을 shared `LIVE_SESSION_STATUS_TRANSITIONS`에서 파생·사본 0). 화면: `app/(app)/(tabs)/live.tsx`(세션 생성 폼+목록)·
  `app/(app)/live/[id].tsx`(라이프사이클 제어 버튼+아나운서 프롬프터 패널·플랫폼 뱃지·질문 강조). 앱 단위 테스트=socketFactory DI 목(jest-expo transform 무변경):
  구독자 20건(chat-store·nickname·format·live-socket)·관제 27건(labels·validation·prompter-store·live-socket). **shared·api 무변경**(client.ts는 앱 로컬).
  검증: subscriber typecheck·test 48·control-center typecheck·test 95·양 앱 expo export(ios+android)·expo-doctor 18/18.
  → **주간추천(Weekly Recommendation) 슬라이스 — api 백엔드 완료**: 추천 생성 워커를 api **인프로세스**(analysis/distribution 동형)로 두고,
  `REDIS_URL` 미설정 시 **인라인 계산 폴백**(추천은 외부 HTTP 0회·순수 DB 집계라 `generating` 고착이 무가치 — 송출과 다른 판단).
  Prisma 신규 1테이블 `weekly_recommendations`(`week_of` DATE **UNIQUE**=주 1건 멱등 키, items JSONB, enum성=text, UUID v7,
  `approved_by_user_id` FK→users SetNull) + `revision_requests.recommendation_id` **FK 활성**(Restrict — 수정지시는 감사 원천).
  센터 엔드포인트 5종(전부 `center_operator`·`admin`): `POST /v1/recommendations`(weekOf를 그 주 월요일 KST로 서버 정규화·인큐-애프터-커밋),
  `GET /v1/recommendations`(weekOf DESC), `GET /v1/recommendations/:id`(`RecommendationReview` — items를 rank순 `ContentSummary` 조인),
  `POST /v1/recommendations/:id/{approve,request-revision}`. 랭킹은 **결정적**: 후보=그 주 published ∧ 같은 세대 완료분석,
  정렬=`recommendationScore DESC(null→0)`→`publishedAt DESC`→`contentId ASC`, 상위 `RECOMMENDATION_TOP_N`(기본 7).
  `reason`은 `ai_analyses.text`(요약 첫 문장·키워드) 파생 — **ai-worker 재호출·실 ML 재랭킹 없음**(기존 점수 재사용), `highlights` 미채움.
  전이는 shared `RECOMMENDATION_STATUS_TRANSITIONS`만 소비(사본 금지)하며 `RecommendationWorkflowService.applyHop`(CAS+감사,
  `entityType='weekly_recommendation'`) 단일 관문. 수정요청은 `revision_requested`→`regenerating` **2홉 자동 연쇄**(gen+1, 2번째 로그는 system),
  `RevisionRequest`는 `targetKind='recommendation'` 재사용(재생성 완료 시 `resolvedAt`/`resolvedByJobId` 해소).
  멱등 3키: `week_of` unique(동시 POST=P2002→409) · 상태별 분기(`generation_failed`만 재시도 200, 그 외 409+`details{id,status}`) ·
  결과 기록의 **세대 CAS**(구세대 결과가 신세대를 못 덮음). 후보 0건은 랭킹이 아니라 **기록자**가 `generation_failed`(note='대상 콘텐츠 0건')로 판정 —
  빈 검토 화면 금지. 실패 사유의 유일 원천은 `status_transition_logs.note`(shared에 lastError가 없어 컬럼 미생성).
  큐 wire는 api-내부 `recommendations/recommendation-job.ts`. shared 추가는 `GenerateRecommendationRequest` DTO 1건뿐.
  E2E(`test/recommendation-pipeline.e2e-spec.ts` — embedded redis-memory-server, S3·FFmpeg·ai-worker 전부 불요, 외부 네트워크 0):
  생성→랭킹 순서·reason 3분기→수정요청→재생성(gen=2, 새 콘텐츠 편입)→승인 실증. **큐 경로/인라인 폴백 양쪽 완주**(`REC_E2E_FORCE_INLINE=1`로 폴백 강제).
  **견고화 4건**(리뷰 반영): ① 고착 복구 — `generating|regenerating`이 `RECOMMENDATION_STUCK_MS`(기본 10분) 초과면 재요청이
  `generation_failed` 강제 강등 후 재시도(`week_of` unique라 대체 행이 없어 잡 유실 시 그 주차가 영구 차단되던 문제),
  ② 재시도가 미해소 `RevisionRequest`를 재패킹 + 해소 조건에서 `from==='regenerating'` 제약 제거(수정지시 접두·해소 레코드 유실 방지),
  ③ items **쓰기 경계**도 `zRecommendationItems` 통과 후 기록(계약 밖 score 1건이 목록·상세를 영구 500으로 만들던 읽기/쓰기 비대칭),
  ④ `weekOf` 스키마가 실존 날짜까지 검증(`2026-02-31`이 500 internal→400 validation_failed).
  회귀 0(api 유닛 294→381·e2e 41→52).
  → **관제 앱 주간추천 탭 실배선 완료**(플레이스홀더 제거, **shared·api 무변경**): 목록 탭(`(tabs)/recommendations.tsx` — 주차 카드
  `2026-06-01 주 · 6/1~6/7`·상태 칩 6종·`항목 N건 · 산출물 v{n}`·`needsCenterAction` 테두리 강조·무한스크롤 id dedupe·
  `[이번 주 추천 생성]`) + 상세(`(app)/recommendations/[id].tsx` — 상태 카드·총평(재생성 접두가 수정지시 노출 통로)·
  rank순 항목(점수·근거·지사/기자/분류/길이 + `/contents/{id}` 크로스 딥링크)·조인 누락 경고·승인/수정요청 액션바·2000자 note 시트).
  기존 패턴 그대로 재사용: 인증 `ApiClient`·`@Roles` 게이트·TanStack Query(`recommendationKeys{all,list,detail}`)·
  **낙관적 업데이트 금지**(onSuccess detail 병합 → `invalidateQueries(all)`, 409는 invalidate+토스트).
  `generating|regenerating`이면 상세 **10s 폴링**(포커스 시에만). 생성 409의 `details.id`는 기존 주차 상세로 딥링크 유도.
  배지·설명 맵은 `RecommendationStatus` **10종 전수** `satisfies`(미도달 5종 포함 — 활성화 시 tsc가 잡는다),
  `needsCenterAction`은 정확히 `pending_review`·`generation_failed` 2종. `currentWeekOfKst`는 +09:00 오프셋 후 **UTC getter만**
  (기기 시간대 무관). 목 데이터 0. jest-expo 단위 +58(status·week·validation·selectors) → **control-center 95→153/15스위트**,
  subscriber 48·reporter 74·media-worker 13 불변, expo export(ios+android)·expo-doctor 18/18 통과.
- **배포 인프라 (본 세션 — 착수점 A)**: api·media-worker·ai-worker **컨테이너화(Docker 멀티스테이지, glibc·pnpm deploy)** + **GitHub Actions CI/CD**(`ci.yml` lint·typecheck·test / `build-images.yml` 이미지 빌드→GHCR) + **프로덕션 compose**(`infra/docker/docker-compose.prod.yml` — R2/Cloudflare 전제, 개발용 `infra/docker-compose.yml`과 분리) 완료. 확정된 제품 모델(카카오 반자동·라이브 YT+FB 하향)은 **문서에만 반영**, **코드(어댑터 재구현)은 유예 — 착수점 B**: `KakaoMockAdapter`→`KakaoManualPublishAdapter`·YouTube 실 어댑터·IG/X/Threads 스코프 정리는 후속 슬라이스. 상세 [docs/infrastructure.md](docs/infrastructure.md) §5·§7.
- **🖥️ 제온 = gachinol 단독 서버 (2026-08-19 확정)**: DCP 파이프라인이 **영구 철수**해 제온(192.168.0.101 / Tailscale 100.92.205.127)은 이제 우리 단독 사용이다. 상호배제는 **해제**됐고(`DCP_ARBITER_URL` 제거 → `DcpArbiterService`가 `enabled=false`. 코드 8파일은 제온 외 환경 대비로 보존), 회수 자원은 **[A-2]에서 재배분 완료**(media-worker `cpus:32`·동시성2 → 인코딩 65.2s→18.0s **3.6배** · 컨테이너 리밋 합계 14.25GiB · MinIO 데이터를 **2TB NVMe `/srv/dcpwork/minio`**로 이전 · 콘솔 9001 루프백 축소 · 스왑 2.4GiB 회수). **재부팅 실검증 완료**(2026-08-19, 다운타임 81초, 7컨테이너 자동기동, failed 0).
  - ⭐ **지우면 안 되는 부팅 안전장치 2건**: `/etc/fstab`의 `/srv/dcpwork` **`nofail`**(없으면 디스크 문제 시 emergency mode → **헤드리스라 SSH 불가**) + `/etc/systemd/system/docker.service.d/10-require-dcpwork.conf`의 **`RequiresMountsFor=/srv/dcpwork`**(없으면 마운트 없이 docker가 떠 **빈 디렉터리에 bind** = 조용한 오동작). 둘은 짝이며 **디스크 문제 시 서버는 뜨고 docker만 안 뜨는 것이 의도**다.
  - ⚠️ **`dcpx-fan-control.service`는 호스트 인프라다**(팬 온도 비례제어). 이름만 dcpx라 잔재로 오인해 지우면 발열·소음이 바뀐다. **`docker system|image|volume prune` 금지**(DCP 보존 자산 잔존, `builder prune`만 예외적으로 허용하되 지금은 불요). **`/etc/nftables.conf` 통째 재적용 금지**(3행 `flush ruleset`이 Docker `ip nat DOCKER`·Tailscale 체인까지 삭제).
  - 상세·근거·실측표는 **[docs/infrastructure.md](docs/infrastructure.md) §4-A-0**이 단일 원천. 서버 측 기록은 제온 `/srv/admin/{decisions,inventory}.md`·`runbooks/dcp-retire.md`.
- **(이력) 제온 임시 백엔드 — DCP 공유 시절**: 개인 제온 서버(2×Xeon E5-2683 v4 = 32C/64T, 32GB, Debian 13, Docker 29.6)를 **임시 백엔드**로 사용. 이 호스트는 **가동 중인 DCP 파이프라인과 공유**했으므로 상호배제가 필수였다 → `services/api/src/arbiter/` **DcpArbiterService**(인프로세스, `DCP_ARBITER_URL` 게이트): DCP 측 `GET /api/arbiter/state`를 **읽기 전용** 조회해 `busy`면 **BullMQ 미디어 큐를 전역 정지**(`Queue.pause()` — 별도 프로세스인 media-worker도 새 잡을 안 집고 진행 중 1건만 마침, 선점 없음). 갱신은 **SSE(`/api/stream`) 트리거 + 폴백 폴링**이며 **`busy` 불린만 소비**(DCP의 상태머신 재구현 0 → 그쪽 상태 추가에 면역). imminent(`stage===null && queued>0`)는 우리 리스크 정책으로 양보하되, **개입 대기(`review_pending` 등)에는 양보하지 않는다**(사람 대기라 큐가 안 움직여 우리가 영구 정지함). 조회 실패는 `DCP_ARBITER_FAIL_MODE`(기본 hold). 상태 노출 `GET /v1/system/processing-state`. 배포는 `infra/docker/docker-compose.xeon.yml` **오버레이**(prod compose 위에 덧씌움 — MinIO 추가·전 서비스 메모리 리밋·media-worker `cpus:8`+동시성1·포트 4000/9000만·bridge 유지 + `extra_hosts: host.docker.internal`). **shared·Prisma 무변경**, api 유닛 381→419. DCP 측 계약은 그쪽 DSGN-API §2.1(외부 조회 계약)이 원천.
- **🔧 제품 정의 갱신 (2026-08-17 사용자 지시 — 대장 #151~#153)**: 파이프라인 정의를
  *"기자 웹 업로드 → **제온**이 수신 → **자동편집** → 미리보기 반환 → **기자 승인 또는 센터 승인** → 송출 →
  웹앱·카톡 채널 알림으로 시청"*으로 확정. 세 가지가 바뀌었다.
  1. **자동편집(`auto_edit`)이 파이프라인 정식 단계로 승격** — 종전에는 `T-AI` 병렬 트랙의 선택 항목이었다.
     → **범위 확정 + Phase 1 구동 완료(2026-08-20, PR #54)**. 로컬 LLM 조사·PoC(2026-08-17)와 맥 스튜디오
     실측(2026-08-20)을 거쳐 3단계로 쪼갰다: ① 기계편집(완료) ② 글콘티 3지선다(T-AI, W2 후) ③ 아카이브 매칭(펀딩 후).
     상세는 이 절 최상단 "자동편집 Phase 1 완료" 항목.
  2. **송출 채널 = 카카오톡 + YouTube 2채널**(§3-1·§8). Facebook 이하 전부 스코프 제외(어댑터 코드는 보존).
  3. **제온이 정식 백엔드 겸 스토리지**(§5) — R2는 대기 옵션으로 강등, 용량은 HDD 증설로 확장.
- **다음 후보 (docs/ROADMAP.md 참고)**:
  1. 댓글 수집 연동 + SNS 확장(YouTube/Meta/X/Threads 어댑터 — 레지스트리에 platform 추가) + 채널 계정 CRUD
     (~~`reporter_only` 자동 송출 후킹~~은 이미 동작 중이며, **센터 송출 지시 UI도 2026-08-15 배선 완료** — 대장 #94)
  1-1. ~~`auto_edit` 착수 시 `contents.durationSec` 확정 주체 재정리~~ → **해소(2026-08-20)**:
     `MediaAssetsService.findDurationSec(contentId, generation)`이 현 세대 `edited_master`를 우선한다
     (shared 계약 "편집 완료 후 확정" 준수). Phase 1은 컷이 없어 값이 같지만 규칙을 먼저 고정했다
  1-2. 세로 영상 썸네일 프로파일 비대칭(`scale=640:-2` 폭 고정 → 세로는 640×1138) — 렌디션·프리뷰의
     높이 기준(`min(ih,H)`)과 어긋난다. 실사용 목록 확인 후 판단(EXEC-DECISIONS #26 ⑤)
  2. ~~`auto_edit`(자동편집 마스터·`edited_master`, `regenerating→analyzing` 재분석 재사용)~~ →
     **Phase 1 완료(§11)**. 남은 것: **글콘티 3지선다·실 STT**(T-AI 트랙, W2 완료 후) · HLS 패키징 ·
     실시간 WS 진행률 푸시(재생성 대기 가시화에 유효)
  3. ai-worker 실 제공자 주입(**로컬 whisper.cpp+VAD / 비전** — §12 STT 결정 반영, 舊 "OpenAI Whisper" 표기 정정)
     + 추천 **승인→송출(publishing/published)** 배선 + 주간 자동 생성 스케줄(BullMQ repeatable)
  4. ~~`infra` 배포 스크립트/IaC~~ → **컨테이너화·CI/CD·프로덕션 compose 완료**. 남은 것: VM 프로비저닝·배포(CD) 워크플로·백업(R2)/마이그레이션 스크립트
  - ~~`apps/reporter` Expo 스캐폴딩 (촬영·업로드 MVP)~~ ✅ 완료
  - ~~업로드 presigned URL + BullMQ 생산자/QueueEvents (api 측)~~ ✅ 완료
  - ~~media-worker(순수 FFmpeg) + reporter 실업로드 교체 → 풀 루프 실증~~ ✅ 완료
  - ~~`apps/control-center` Expo 스캐폴딩 (센터 검토·결정 MVP)~~ ✅ 완료
  - ~~`analyzing`(ai-worker 비전/STT) 홉 — HTTP 통합·ai_analyses·전이 재배선~~ ✅ 완료
  - ~~**구독자 공개 피드 API**(services/api `FeedModule`) — `@Public` 익명 read 3종:
    `GET /v1/feed`(published `FeedItem` 커서목록·stationId/category 필터),
    `GET /v1/feed/:id/playback`(`PlaybackInfo` — 720p rendition 서명 GET URL을 hlsUrl에·포스터·Scene 자막파생, 비published 404),
    `GET /v1/feed/stations`(operating+dormant branch만). published-only 화이트리스트 투영(내부필드 유출 차단)·
    keyset 커서(publishedAt DESC,id DESC)·썸네일 서명 best-effort(피드 500 금지). `seed.ts`에 `seedFeedDemo`(published 3건+rendition/thumbnail/ai_analyses,
    resetDb 불호출로 기존 e2e 무회귀). shared·schema 무변경.~~ ✅ 완료
  - ~~**구독자 앱(apps/subscriber) Expo 스캐폴딩 완료**: 로그인 없는 익명 시청 — 피드 무한스크롤(지사·분류 칩 필터)·
    공개 지사 탐색(크로스탭 딥링크)·상세 재생(expo-video로 720p 서명 URL 재생 + Scene 자막 오버레이 `selectActiveCue`)·
    라이브 정적 플레이스홀더. 공개 GET 전용 클라이언트(reporter/control-center에서 tokenStore·refresh·401 재시도 전면 제거,
    Authorization 미부착). reporter/control-center Expo 패턴(metro·jest·expo-router·TanStack Query) 동형 이식, **shared·api 무변경**.
    jest-expo 단위(client·captions·format·labels·pagination) 28건.~~ ✅ 완료
  - ~~**주간추천(Weekly Recommendation) api 백엔드** — `weekly_recommendations` 1테이블 + 결정적 랭킹(기존 recommendationScore 재사용) +
    상태머신 CAS·감사(shared 전이맵 소비) + 센터 엔드포인트 5종 + 수정→재생성 루프(RevisionRequest targetKind='recommendation').
    큐(api 인프로세스)·인라인 폴백 양쪽 E2E 완주.~~ ✅ 완료
  - ~~**관제 앱 주간추천 탭 실배선** — 목록(주차 카드·상태 칩·무한스크롤·[이번 주 추천 생성]) + 상세(총평·rank 항목·콘텐츠 딥링크·
    승인/수정요청) + 10s 폴링·409 경합 처리. 배지 10종 전수 satisfies, 목 데이터 0. **shared·api 무변경**.~~ ✅ 완료
  - ~~**다채널 송출(Distribute) 슬라이스** — api 인프로세스 송출 워커 + 카카오 목 어댑터 + `channel_accounts`·`publications`
    2테이블 + 센터 엔드포인트 4종(distribute·publications·retry·retract). 카톡 채널 송출 한 바퀴 실증.~~ ✅ 완료
  - ~~**라이브 + WebSocket 슬라이스** — api WS 게이트웨이(채팅·프롬프터·프레즌스) + `live_sessions`·`live_comments`·`chat_messages`
    3테이블 + 센터/공개 REST + 이벤트-암드 댓글 수집기 + 구독자 익명 채팅 앱 + 관제 프롬프터 앱. 주말 라이브·실시간 채팅·아나운서 프롬프터 실증.~~ ✅ 완료
- **MVP 우선 제안**: 휴무 중인 **애월·제주시 2개 지사 부활**을 최소 실행안으로. (기자 앱 업로드 → 카톡채널 송출 → 구독자 시청) 한 바퀴를 먼저 돌린다.

## 12. 미정 / 결정 대기 사항

- ~~서버 사양~~ → **확정**: 4vCPU/8GB 단일 VM 산정은 유지하되, **웹 피벗으로 보유 제온 서버 우선 운영**·클라우드 전환은 수치 트리거([docs/plan/05-monetization.md](docs/plan/05-monetization.md) §C 유일 원천). [docs/infrastructure.md](docs/infrastructure.md) §4-A
- ~~라이브 인프라: 자체 RTMP/HLS vs Mux/AWS IVS~~ → **확정**: Cloudflare Stream(매니지드). 자체 구축은 라이브 전송비 급증 시 재검토. §4-B
- ~~센터 관제 앱의 웹 콘솔 병행 여부~~ → **웹 피벗으로 해소**(2026-08-04): 관제 자체가 웹앱이 되어 데스크톱 콘솔을 겸한다(02 §C 데스크톱 매트릭스·W2 DoD 1440px 확인 포함)
- ~~카톡 채널 배포 방식~~ → **반자동 게시로 확정**(직접 발행 API 없음). 자체 앱/YouTube가 실재생, 카카오는 유입 채널. 자체 앱 이전/병행은 계속 열려 있음. §5-1
- ~~결제 PG 사~~ → **웹 피벗 계획에서 단계화**(2026-08-04): 커머스 1단계=**링크아웃**(판매·결제는 외부 플랫폼, PG 불요) → 2단계(자체 결제·PG 계약)는 GMV 트리거 충족 시 착수([docs/plan/05-monetization.md](docs/plan/05-monetization.md) §A-1·§G). B2B 미디어 세일즈 유통 방식은 계속 미정(01 §B-3 전략 초안 있음)
- ~~프로덕션 스토리지(R2 vs 자체)~~ → **확정(2026-08-17)**: **제온 자체 호스팅**(MinIO), 용량은 HDD 증설. R2는 대기 옵션(env 전환). §5·infra §4-C
- ~~라이브 SNS 채널 범위~~ → **확정(2026-08-17)**: **YouTube 단독**. Facebook/IG/X/Threads 제외(어댑터 코드 보존). §3-1·infra §5-2
- ~~자동편집(`auto_edit`)의 작업 범위~~ → **확정·Phase 1 완료(2026-08-20)**. 범위는 3단계로 쪼갰다:
  **① 기계편집**(음량 정규화·렌디션, AI 0회) = **완료** · **② 글콘티 3지선다**(구성방향/구간/자막 문구) = T-AI 트랙 ·
  **③ 아카이브 B-roll 매칭** = 펀딩 후. 서비스 목적은 처리량이 아니라 **시니어의 진입장벽 제거**이며
  (사용자 정의: *"이 기능을 얼마나 잘 구현하는지가 서비스의 성패를 판가름"*), 그래서 MVP 물량(주 5건)과 무관하게 우선한다. §11
- **STT 제공자 — 로컬 확정 (2026-08-20 사용자 결정, 정본 변경)**. 정본은 RTZR API였고 비용도 산정돼
  있었으나(infra §4 — MVP ~$5/월), **개인정보·보안**을 근거로 로컬(whisper.cpp)로 바꾼다:
  *"우리가 촬영한 원본에서 오디오를 추출하여 외부 서비스에 맡기는 건 보안·개인정보보호 측면에서 문제"*.
  마을 촬영본에 주민 실명·목소리가 담기고 07이 미성년자 동의를 최상위 블로커로 다루는 것과 일관된다.
  ⚠️ **비용은 로컬로 갈 이유가 아니었다**(월 $5) — 이 결정의 근거는 **오직 데이터 주권**이다.
  - **인식률 실측(2026-08-20)**: 개선 시도 4가지 중 **1개만 유효**. ✅ **Silero VAD**(환각 소멸, 정상본 회귀 0,
    34.7배 실시간) / ❌ 도메인 어휘 프롬프트(**VAD 모드에서 무시됨** — 564자 그대로) / ❌ `large-v3` full
    (turbo 대비 8배 느린데 정확도는 더 낮다) / ⚠️ LLM 후처리(긴 입력에서 스키마 붕괴 — "교정"이 아니라 **"의심 표시"**로 전환).
  - ⚠️ **정답 전사(ground truth) 미확보** — 지금까지의 비교는 전부 대리 지표(글자수·키워드)다. 작업지를
    사용자에게 전달했으며, 확보 전에는 설정 튜닝이 감에 의존한다.
  - **입력 품질이 알고리즘보다 효과적일 수 있다** — 무선 핀마이크 도입 검토(사용자 결정). 실측 음량 -19.8·-26.2dB.
- ~~제온 외부 노출 방식(Cloudflare Tunnel/포트 개방)~~ → **확정(2026-08-27 사용자 결정)**: 사용자 트래픽 =
  **Cloudflare Tunnel**(도메인 확정 후 배선), 배포 제어(러너→제온 SSH) = **Tailscale**(도메인과 무관하게
  지금 배선, 도메인 후에도 유지 — 두 경로는 독립). 켜는 절차·시크릿 목록은 `.github/workflows/deploy-web.yml`
  preflight 잡 주석이 단일 원천. **⭐ 실가동 확인(2026-08-28)**: 사용자가 시크릿 입력·검증 완료 →
  PR #71 머지분 main 런에서 **deploy 잡 실제 success**(제온 web 컨테이너 자동 갱신). 이제 **main 머지 =
  웹 자동 배포**다. purge만 도메인 확정 시까지 skip.
- **실 도메인 — 미정(보류)**: 당장은 Tailscale로 배포·테스트하고, 추후 구매 시 vars 재정의(공개 URL 번들
  재빌드)+Tunnel 배선+퍼지 시크릿만 추가하면 되도록 설계됨(워크플로 무변경). 구매는 지출이라 사용자 실행.
