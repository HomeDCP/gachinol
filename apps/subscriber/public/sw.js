/*
 * 가치놀 구독자 웹 서비스워커 — T-W1-04 (정본: docs/plan/02-web-architecture.md §D-T5
 * "서비스워커 갱신·캐시 무효화 정책").
 *
 * 이 파일은 Expo가 `public/` 규약에 따라 **바이트 그대로** 산출물 루트(`dist/sw.js`)로 복사한다
 * (실측: `expo export --platform web` 산출물 트리). 루트여야 하는 이유 = 서비스워커는 자기 스코프
 * **위쪽**을 제어할 수 없어서, `/sw.js`가 아니면 `/watch/:id`·`/live/:id` 같은 앱 전체 경로를 못 잡는다.
 *
 * ── 번들되지 않는다 ─────────────────────────────────────────────────────────────
 * Metro/TypeScript 어느 쪽도 이 파일을 건드리지 않는다(`tsconfig.json` include = app·src·app.config.ts,
 * jest testMatch = src/**). 그래서 import·TS 문법을 쓸 수 없고 순수 브라우저 JS로 작성한다.
 * 판정 로직(언제 알리고 언제 적용하는가)은 전부 앱 쪽 `src/pwa/sw-update-policy.ts`에 있고, 여기에는
 * **정책이 아니라 캐시 규칙과 생명주기 훅만** 둔다.
 *
 * ── 버전 식별 ───────────────────────────────────────────────────────────────────
 * 등록 URL이 `/sw.js?v=<엔트리 번들 콘텐츠 해시>`다(앱이 문서의 <script src>에서 뽑아 붙인다).
 * 이 파일 내용은 배포마다 동일하므로 쿼리가 없으면 브라우저가 신 버전을 영원히 감지하지 못한다
 * — 상세 근거는 `src/pwa/sw-update-policy.ts`의 `resolveBuildId` 주석.
 */

'use strict';

var BUILD_ID = new URL(self.location.href).searchParams.get('v') || 'unversioned';
var CACHE_PREFIX = 'gachinol-subscriber-';
var ASSET_CACHE = CACHE_PREFIX + 'assets-' + BUILD_ID;
var SHELL_CACHE = CACHE_PREFIX + 'shell-' + BUILD_ID;
/** 앱 셸은 항상 이 한 키에만 저장한다 — `/watch/<uuid>`마다 항목이 쌓이는 것을 막는다 */
var SHELL_KEY = '/';

self.addEventListener('install', function () {
  // skipWaiting을 여기서 부르지 않는다(의도적).
  //
  // 정본 §D-T5 2번은 "대기 없이 즉시 활성화"라고 적었지만, 설치 시점 skipWaiting은 **열려 있는 탭이
  // 구 번들을 실행한 채 신 SW의 제어를 받게** 만든다. 아래 activate가 구 버전 캐시를 지우므로 그 탭이
  // 나중에 요청하는 해시 자산이 사라져 화면이 조용히 깨진다. 게다가 이 앱은 영상 시청 중 이탈이
  // 치명적이라 자동 새로고침으로 덮을 수도 없다(같은 조항이 자동 강제 새로고침을 금지한다).
  // → 신 버전은 waiting에 머무르고, 앱이 배너로 알리고, **사용자가 누르면** 아래 message 핸들러가
  //   skipWaiting을 부른다. 프리캐시가 없어 install에서 받아둘 것도 없다.
});

self.addEventListener('message', function (event) {
  // workbox-window의 messageSkipWaiting()이 보내는 값. 앱 쪽 상수는 SW_SKIP_WAITING_MESSAGE.
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches
      .keys()
      .then(function (names) {
        // 우리 소유 접두사만 건드린다(같은 오리진의 남의 캐시를 지우지 않는다).
        return Promise.all(
          names
            .filter(function (name) {
              return (
                name.indexOf(CACHE_PREFIX) === 0 && name !== ASSET_CACHE && name !== SHELL_CACHE
              );
            })
            .map(function (name) {
              return caches.delete(name);
            }),
        );
      })
      .then(function () {
        // 정본 §D-T5 2번의 clients.claim(). 여기까지 왔다는 건 (a) 첫 설치이거나
        // (b) 사용자가 적용을 눌러 skipWaiting이 실행된 경우뿐이다.
        return self.clients.claim();
      }),
  );
});

/*
 * ── 캐시 전략과 근거 ────────────────────────────────────────────────────────────
 * 이 앱은 **익명 공개 시청 앱**이라 저장될 개인정보는 없다. 그러나 "개인정보가 없다 = 다 캐시해도 된다"가
 * 아니다 — 아래 두 축이 실제 파손 요인이다.
 *
 * ① 서명 URL(presigned S3/R2 GET). `GET /v1/feed/:id/playback`이 만료 시각이 박힌 URL을 돌려주고
 *    영상 바이트는 그 URL로 받는다. 이걸 캐시하면:
 *      - 만료된 URL을 캐시에서 꺼내 재생 → R2가 403 → 사용자에게는 "영상이 고장난" 것으로 보인다
 *        (네트워크 오류가 아니라서 앱의 재시도 폴백도 헛돈다).
 *      - 서명 URL은 사실상 **일회용 접근권한 토큰**이다. 만료로 스스로 죽는 것이 설계인데 캐시에
 *        영속시키면 그 수명 설계를 우회한다. 개인정보 유무와 무관하게 저장하지 않는다.
 *      - 영상 응답은 Range 요청의 **206 Partial**이다. Cache API는 206을 `put`할 수 없다(throw).
 *    → 교차 오리진 요청은 아예 가로채지 않는다(아래 첫 번째 가드). HLS 세그먼트·CF Stream도 동일.
 *
 * ② API 응답(`/v1/**`). 피드 목록은 송출·회수마다 바뀌고 라이브 세션 상태는 실시간이다. 캐시된
 *    목록은 이미 내려간 콘텐츠를 계속 보여주거나 방금 올라온 소식을 감춘다. TanStack Query가 이미
 *    메모리 캐시·재검증을 담당하므로 SW가 한 겹 더 얹을 이유도 없다. → 가로채지 않는다.
 *
 * ③ 해시 자산(`/_expo/static/**`, `/assets/**`). 파일명에 콘텐츠 해시가 있어(실측: Expo가 이미 붙인다)
 *    **URL이 같으면 내용도 같다**. 스테일이 원리적으로 불가능하므로 CacheFirst가 안전하고, 반복 방문·
 *    오프라인 셸 구동에 가장 크게 기여한다.
 *
 * ④ 문서(내비게이션). NetworkFirst — **항상 네트워크를 먼저 시도**한다. 정본 §D-T5 3번(HTML no-cache)의
 *    의도는 "진입점이 스테일이면 1·2가 무력화된다"인데, NetworkFirst는 온라인일 때 언제나 새 문서를
 *    쓰므로 그 의도를 깨지 않는다. 캐시본은 오프라인일 때만 나온다.
 *
 * ── 오프라인 폴백 ───────────────────────────────────────────────────────────────
 * 별도 offline.html은 만들지 않는다. 위 ④의 셸 1건 + ③의 해시 자산이면 오프라인에서 앱이 그대로 뜨고,
 * 데이터 요청은 실패해 **앱이 이미 가진 `ErrorView`("다시 시도")** 가 나온다 — 어르신 톤으로 이미
 * 다듬어진 화면이라 전용 오프라인 페이지는 같은 말을 한 번 더 하는 중복이다. 게다가 전용 페이지는
 * 프리캐시가 필요한데 이 파이프라인에는 빌드 시점 주입 단계가 없다(위 헤더 주석). 오프라인에서 영상
 * 시청 자체는 어차피 불가능하다(서명 URL·바이트 모두 네트워크).
 */

self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (request.method !== 'GET') return;

  var url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }

  // ① 교차 오리진(서명 URL·HLS·CF Stream·외부 이미지) — 손대지 않는다
  if (url.origin !== self.location.origin) return;

  // ② API·WebSocket — 캐시 금지
  if (url.pathname.indexOf('/v1/') === 0 || url.pathname.indexOf('/socket.io/') === 0) return;

  // ③ 해시 자산 — CacheFirst
  if (url.pathname.indexOf('/_expo/') === 0 || url.pathname.indexOf('/assets/') === 0) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // ④ 문서 — NetworkFirst(오프라인일 때만 셸)
  if (request.mode === 'navigate') {
    event.respondWith(networkFirstShell(request));
    return;
  }

  // 그 외(매니페스트·파비콘 등)는 브라우저 기본 처리에 맡긴다.
});

function cacheFirst(request) {
  return caches.open(ASSET_CACHE).then(function (cache) {
    return cache.match(request).then(function (hit) {
      if (hit) return hit;
      return fetch(request).then(function (response) {
        // 200만 저장한다 — 206(Range)은 Cache API가 거부하고, 3xx/4xx/5xx를 굳혀두면 복구가 안 된다.
        if (response && response.status === 200) {
          cache.put(request, response.clone());
        }
        return response;
      });
    });
  });
}

function networkFirstShell(request) {
  return fetch(request)
    .then(function (response) {
      if (response && response.status === 200) {
        var copy = response.clone();
        // 어느 라우트로 들어왔든 셸은 SHELL_KEY 한 자리에만 덮어쓴다. expo-router는 클라이언트에서
        // `location.pathname`으로 라우팅하므로, 오프라인에 다른 라우트로 들어와도 화면은 맞게 그려진다
        // (사전 렌더 HTML과 첫 렌더가 어긋나면 React가 클라이언트 렌더로 넘어간다 — 허용 가능한 열화).
        caches.open(SHELL_CACHE).then(function (cache) {
          cache.put(SHELL_KEY, copy);
        });
      }
      return response;
    })
    .catch(function () {
      return caches.open(SHELL_CACHE).then(function (cache) {
        return cache.match(SHELL_KEY).then(function (hit) {
          // 캐시본이 없으면(설치 후 첫 방문이 오프라인) 브라우저 기본 오류 화면으로 넘긴다.
          return hit || Response.error();
        });
      });
    });
}
