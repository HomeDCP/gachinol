# apps/reporter — 기자 앱 (Expo)

12개 지사 기자가 쓰는 **React Native + Expo** 앱 — 촬영 → 장면별 자막 기입 → 분류 → 초안 저장 →
(미디어 파이프라인 연동 후) 업로드 → 저화질 프리뷰 확인 → **승인/수정요청/반려**.
현재 송출처: 기자 소속 **카카오톡 채널**(지역방송국).

## 요구사항

- Node 24 (`.nvmrc`) · pnpm 8+
- `services/api` 기동 (아래 참조) — 인증·콘텐츠 API의 원천
- Expo Go(실기기) 또는 iOS/Android 시뮬레이터

## 시작하기

```bash
# 리포 루트에서
pnpm install
pnpm --filter @gachinol/shared build          # tsc 타입 원천(dist) — Metro는 소스를 쓴다

# 앱 환경변수 — 루트 .env가 아니라 apps/reporter/.env (Expo는 루트 .env를 읽지 않는다)
echo 'EXPO_PUBLIC_API_URL=http://localhost:4000' > apps/reporter/.env
#   실기기(Expo Go)는 localhost가 폰 자신을 가리키므로 개발 머신 LAN IP로:
#   EXPO_PUBLIC_API_URL=http://192.168.x.x:4000

pnpm --filter @gachinol/api dev               # API 선행 기동 (services/api/README.md 참조)
pnpm --filter @gachinol/reporter dev          # Expo dev 서버 → Expo Go로 QR 스캔
```

`EXPO_PUBLIC_*`는 번들에 그대로 인라인되는 **공개 값** — 시크릿 금지. 접근은
`src/config/env.ts`(`getApiBaseUrl`) 한 곳으로 한정.

> `apps/reporter/.env`는 `.gitignore` 대상이지만 루트 `turbo.json` build 태스크의
> `inputs`(`$TURBO_DEFAULT$` + `.env`)에 포함된다 — API 주소를 바꾸면 turbo 캐시가
> 무효화되어, 옛 주소가 인라인된 번들이 캐시로 재생되는 일을 막는다.

> iOS 실기기에서 LAN `http://` 접속은 ATS(App Transport Security) 예외가 필요할 수 있다.
> Expo Go 개발 중에는 통상 문제없지만, dev build로 전환 시 `NSAllowsLocalNetworking` 검토.

## 기자 계정 만들기 (셀프 가입 없음)

1. api 시드로 admin 생성: 루트 `.env`에 `SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD` 설정 후
   `pnpm --filter @gachinol/api prisma:seed`
2. Swagger `http://localhost:4000/docs`에서 admin으로 `POST /v1/auth/login` → accessToken 인증
3. `GET /v1/stations`로 애월(code `aewol`)의 id 확인
4. `POST /v1/users` — `{ "role": "reporter", "name": "…", "email": "…", "password": "…", "stationId": "<애월 id>" }`
5. (MVP 부활) `POST /v1/stations/:id/transitions` — `{ "toStatus": "operating" }`

이 앱은 **기자 전용** — 다른 role로 로그인하면 입구에서 차단된다(role 게이트).

## 실행·검증 파이프라인 (시뮬레이터 없어도 완료 판정 가능)

```bash
pnpm install
# 1) shared "소스 소비" 증명: dist 없이 번들이 성공해야 한다 (반증 가능한 절차)
pnpm --filter @gachinol/shared clean
pnpm --filter @gachinol/reporter exec expo export --platform android
# 2) 타입 원천(dist) 복구 후 typecheck
pnpm --filter @gachinol/shared build
pnpm --filter @gachinol/reporter typecheck
# 3) 단위 테스트
pnpm --filter @gachinol/reporter test
# 4) SDK 정합 진단 (네트워크 필요 — 오프라인이면 스킵 가능)
pnpm --filter @gachinol/reporter exec expo-doctor
# 5) 루트 회귀 (api·shared 포함)
pnpm typecheck && pnpm test && pnpm build
# 6) git status — 루트 .gitignore의 `*.ts` 함정(아래) 때문에 신규 파일 추적 여부 확인
```

수용 기준: 전부 녹색 + expo-doctor 무경고 (불일치 시 `npx expo install --fix`).

## 구조 요약

```
app/                      # expo-router 라우트 — 전부 .tsx, "얇게"(조립만)
├── (auth)/login          # ① 로그인
└── (app)/
    ├── index             # ② 콘텐츠 목록 (우리 지사 — 서버 강제)
    └── contents/
        ├── new/          # ③ 신규 위저드: 촬영 → 장면 → 분류·저장 → 업로드(Mock)
        └── [id]/         # ④ 상세 / edit 초안 수정 / ⑤ preview 프리뷰 승인
src/
├── config/env.ts         # EXPO_PUBLIC_API_URL 단일 접근점
├── api/                  # fetch 클라이언트(+401 refresh 인터셉터) · 엔드포인트 typed 함수
├── auth/                 # 토큰 저장(SecureStore) · AuthProvider(세션·role 게이트)
├── query/                # TanStack Query 기본 옵션 · 캐시 키 팩토리
├── features/contents/    # 상태 라벨(23종 전수) · 액션 게이팅 · 폼 검증 · 쿼리/뮤테이션
├── upload/               # UploadService facade + Mock (교체 지점 1곳)
└── ui/                   # 최소 컴포넌트 · theme (packages/ui 승격 전 임시)
```

## 인증 규약

- **JWT**: access 15분(메모리 전용) / refresh 14일 **회전식** — shared·api 계약 그대로.
- **SecureStore에는 refresh만 영속** — 회전 시 영속 시크릿이 1개라 torn-write(쌍 불일치 →
  재사용 탐지 → family 전체 폐기)가 구조적으로 불가능. access는 콜드 스타트마다 refresh 1회로 재획득.
- **refresh single-flight**: 동시 401 N건 → refresh 요청 1건. 회전식이라 동시 2건이면 한쪽이
  '재사용'으로 탐지돼 family 전체가 폐기된다 — 직렬화는 정합성 요건.
- refresh 401/403 = 세션 종료 확정(clear + 재로그인). **5xx·네트워크 예외는 토큰 보존** —
  오프라인이 로그아웃이 되지 않는다.

## 업로드 현황 — Mock (시뮬레이션)

- 업로드 엔드포인트는 서버에 아직 없다(api README "이번 단계 범위 밖"). shared에는
  `IssueUploadUrlRequest/Response`·`CompleteUploadRequest` DTO만 선정의됨.
- `src/upload/mock-upload-service.ts`가 진행률만 시뮬레이션 — **서버 상태를 바꾸지 않는다**
  (콘텐츠는 `draft` 유지, 가짜 전이 금지, UI에 시뮬레이션 명시).
- 다음 단계: `TODO(upload-api)` — presigned URL 발급 + PUT + 완료 통지의 `HttpUploadService`로
  `upload-service.ts`의 한 줄만 교체.

## 컨벤션

- **`.ts` 파일은 반드시 `src/` 아래** (또는 `*.config.ts`·`*.d.ts` 이름만). 루트 `.gitignore`의
  `*.ts`(TransportStream 오인 방지) 패턴이 그 밖의 TS 소스를 무시한다. `app/` 라우트는 전부 `.tsx`.
- shared 계약 재정의 금지 — 타입·상수는 `@gachinol/shared`에서 import. 전이 게이팅은
  `canTransitionContent`(전이 맵 사본 금지).
- 서버 zod 수치를 미러하는 폼 검증은 `src/features/contents/validation.ts` — 수치마다 출처 주석.
- `src/ui/theme.ts`는 packages/ui 디자인시스템 승격 예정 — 그 이상 확장 금지.
- 이후 control-center·subscriber 앱 추가 시 **react/react-native 버전 통일 필수** (pnpm isolated).
- shared 소스 수정 중 타입 즉시 반영: `pnpm --filter @gachinol/shared dev`(tsc --watch) 병행.

## 현재 한계와 다음 단계

| 현재                                          | 다음 단계                                       |
| --------------------------------------------- | ----------------------------------------------- |
| 업로드 Mock (진행률 시뮬레이션)               | presigned URL + BullMQ 연동 `HttpUploadService` |
| 프리뷰 placeholder (재생 배선만 완성)         | MediaAsset·서명 URL API (`MediaAccessUrl`) 연결 |
| 상세 화면 15s 폴링                            | WebSocket 실시간 상태 반영                      |
| 촬영 원본 세션 메모리 보관 (재시작 유실)      | 업로드 API 도입 시 로컬 영속·재개 전략          |
| 목록 "내 것만" 필터 없음 (서버 파라미터 부재) | api에 `reporterId` 필터 제안                    |
