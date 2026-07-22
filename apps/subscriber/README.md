# apps/subscriber — 구독자 앱 (Expo)

시청자가 쓰는 **React Native + Expo** 앱 — **로그인 없이(익명)** 12개 지사의 **published 콘텐츠**를
피드로 훑고, 상세 화면에서 재생(자막 포함)한다. 카카오톡 채널 시청 행태와 동일한 익명 시청.
라이브·실시간 채팅·구독자 계정은 다음 단계(라이브 인프라 + WebSocket 미도입) → 플레이스홀더.

reporter/control-center와 **동일 Expo 패턴**(metro·jest·expo-router)이되 **인증 계층이 전면 제거**된
공개 read 전용 앱이다.

## 요구사항

- Node 24 (`.nvmrc`) · pnpm 8+
- `services/api` 기동 — 공개 피드 API(`GET /v1/feed`, `/v1/feed/:id/playback`, `/v1/feed/stations`)의 원천
- Expo Go(실기기) 또는 iOS/Android 시뮬레이터

## 시작하기

```bash
# 리포 루트에서
pnpm install
pnpm --filter @gachinol/shared build          # tsc 타입 원천(dist) — Metro는 소스를 쓴다

# 앱 환경변수 — 루트 .env가 아니라 apps/subscriber/.env (Expo는 루트 .env를 읽지 않는다)
echo 'EXPO_PUBLIC_API_URL=http://localhost:4000' > apps/subscriber/.env
#   실기기(Expo Go)는 localhost가 폰 자신을 가리키므로 개발 머신 LAN IP로:
#   EXPO_PUBLIC_API_URL=http://192.168.x.x:4000

pnpm --filter @gachinol/api dev               # API 선행 기동 (services/api/README.md 참조)
pnpm --filter @gachinol/subscriber dev        # Expo dev 서버 → Expo Go로 QR 스캔
```

`EXPO_PUBLIC_*`는 번들에 그대로 인라인되는 **공개 값** — 시크릿 금지. 접근은
`src/config/env.ts`(`getApiBaseUrl`) 한 곳으로 한정.

## 볼 것이 있으려면 (published 콘텐츠)

피드는 `status='published'` 콘텐츠만 조회한다. 송출(Distribute) 단계는 미구축이라 데모 콘텐츠는
API 시드로 확보한다 — `services/api`에서 `seedFeedDemo`가 애월·제주시에 published 콘텐츠 몇 건과
그 rendition/thumbnail media_assets를 넣는다.

> 실 오브젝트 바이트는 dev 스토리지에 없으므로 **피드 목록·메타·서명 URL 발급은 동작**하지만
> 실제 썸네일 이미지·mp4 재생은 media-worker 파이프라인을 1회 실행한(또는 해당 storageKey에 샘플을
> 수동 업로드한) 뒤에 보인다. 앱 코드 자체는 서명 URL을 불투명하게 취급한다.

## 명령어

```bash
pnpm --filter @gachinol/subscriber dev        # Expo dev 서버 (Expo Go)
pnpm --filter @gachinol/subscriber test       # jest-expo 단위 테스트
pnpm --filter @gachinol/subscriber typecheck  # shared dist 선행 빌드 필요
pnpm --filter @gachinol/subscriber build      # expo export (iOS+Android 번들 스모크)
pnpm --filter @gachinol/subscriber doctor      # expo-doctor
```

## 구조

```
app/
  _layout.tsx            # QueryClientProvider > ApiProvider > FeedFilterProvider > Stack (AuthProvider 없음)
  (tabs)/_layout.tsx     # 탭 3: 피드 · 지사 · 라이브
  (tabs)/index.tsx       # 피드 무한스크롤 (지사·분류 칩 필터)
  (tabs)/stations.tsx    # 공개 지사 탐색 → 탭하면 피드 필터 후 피드 탭 이동
  (tabs)/live.tsx        # 라이브·채팅 정적 플레이스홀더 (네트워크 0)
  watch/[id].tsx         # 재생(expo-video) + 자막 오버레이
src/
  api/{client,errors,feed}.ts   # 익명 GET 전용 공개 클라이언트 (인증 없음)
  api-context.tsx               # ApiProvider / useApiClient
  feed-filter-context.tsx       # stationId 크로스탭 딥링크
  features/feed/{queries,format,labels,captions}.ts
  ui/                           # 최소 스타일 키트 (packages/ui 승격 전)
```

라이브·채팅·추천·구독자 계정·WebSocket은 **미소비**(존재하지 않는 계약 소비 금지).
