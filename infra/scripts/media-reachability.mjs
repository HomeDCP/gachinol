#!/usr/bin/env node
/**
 * infra/scripts/media-reachability.mjs
 *
 * 공개 미디어 URL 도달성 검사(대장 #169) — "페이지가 200인가"가 아니라 "그 안의 영상·썸네일이
 * 인터넷에서 실제로 보이는가"를 fail-closed로 확인한다.
 *
 * ── 왜 있는가 ────────────────────────────────────────────────────────────────────
 * 2026-09-12 실기 검증: 구독자 웹의 영상·썸네일이 전부 인터넷에서 도달 불가였다(`S3_PUBLIC_ENDPOINT`가
 * 제온 LAN IP `http://192.168.0.101:9000`이라 서명 URL이 사설 주소를 가리킴). 이 결함은 수 주간
 * 어떤 검사에도 걸리지 않았다 — `watch.bapfull.com/` 200·api SHA 일치·`deploy-smoke.mjs`의 라우트
 * 4종 통과, 그 어느 것도 "라우트 안의 미디어가 실제로 재생되는가"는 묻지 않았다. 이것이 규율 23
 * (검사 범위 확장은 순서가 아니라 동반 의무)이 말하는 "검사 밖이라서 생긴 결함"의 정확한 사례다.
 *
 * ── 판정 원리 (2단계) ───────────────────────────────────────────────────────────────
 * ① 호스트 판정(`classifyHostFailures`) — 네트워크 없이 URL의 호스트·스킴만 본다. 사설 IP(RFC1918)·
 *    루프백·내부 TLD(.local/.internal)·http 스킴·Tailscale CGNAT(100.64.0.0/10)는 **그 자체로
 *    이미 실패**다 — 실제로 연결을 시도할 필요도 없고(사설 IP는 CI 러너에서 애초에 라우팅되지 않거나
 *    타임아웃까지 블로킹될 수 있다), 시도해도 브라우저(mixed-content) 또는 일반 인터넷 클라이언트
 *    (사설 대역 미도달)가 결국 못 간다는 결론은 바뀌지 않는다.
 * ② 도달 판정(`classifyReachabilityFailure`) — ①을 통과한 URL에만 실제 GET을 던져 200과 기대
 *    content-type을 확인한다. `deploy-smoke.mjs`의 `classifyRouteFailure`와 같은 수준으로 사유를
 *    구분한다(404=not_found·403=forbidden·5xx=server_error·타임아웃=timeout·기타 네트워크 실패=
 *    request_failed·200인데 예상 밖 상태코드=unexpected_status·200인데 content-type이 다름=
 *    content_type_mismatch). 403은 미디어 체크 전용으로 승격했다 — MinIO 서명 실패·정책 거부의
 *    전형(위임문 예시: `curl https://media.bapfull.com/` → 403 AccessDenied, "서명 없는 접근은 거부").
 *
 * **한 URL이 여러 사유에 동시에 걸릴 수 있고, `classifyHostFailures`는 첫 매치만 반환하지 않고
 * 전부 반환한다.** 대장 #169의 실물 사례(`http://192.168.0.101:9000/...`)는 private-host **이자**
 * insecure-scheme다 — 하나만 골라 버리면 나머지 결함이 검사 결과에서 사라진다.
 *
 * ── 검사 대상(공개 경로에서 실제로 얻는다, 하드코딩 URL 없음) ───────────────────────────
 *   1. `GET /v1/feed?limit=1` → `items[0].thumbnailUrl`(선택 필드 — 썸네일 없으면 생략될 수 있음)
 *   2. `GET /v1/feed/{contentId}/playback` → `hlsUrl`(shared PlaybackInfo의 필수 필드. 이름은
 *      "hls"지만 실제로는 media-worker가 `video/mp4`로 올린 720p 렌디션 GET URL이다 —
 *      `feed.controller.ts` 주석 "hlsUrl은 공개 CDN URL 또는 서명 URL" 참조) · `posterUrl`(선택)
 * 스키마 원천: `packages/shared/src/subscriber/dto.ts`(FeedItem·PlaybackInfo), 업로드 content-type
 * 원천: `services/media-worker/src/processors/{thumbnail,transcode,preview,auto-edit}.ts`
 * (`image/jpeg`·`video/mp4`) — 둘 다 추측이 아니라 코드를 읽고 확정했다.
 *
 * ⚠️ **서명 URL은 만료가 있다** — 이 파일의 어떤 함수도 URL을 캐시·재사용하지 않는다.
 * `checkMediaReachability`가 매 호출마다 `collectMediaTargets`(발급) → `probeMediaTargets`(즉시
 * 소비)를 순서대로 실행하고, 그 사이에 지연·저장 계층을 두지 않는다.
 *
 * ── 피드가 비어 있을 때(published 0건) ────────────────────────────────────────────────
 * "검사할 게 없으니 PASS"로 조용히 넘기지 않는다(규율 21 "없음이 아니라 있는 척"). published 0건은
 * 그 자체로 버그는 아니므로(배포 직후·콘텐츠 미등록 등 정상 상태일 수 있다) `ok:true`로 두어 배포를
 * 막지는 않되, `warnings`에 `empty-feed`를 **항상** 남겨 "확인 안 함"이 로그에서 보이게 한다
 * (monitor-freshness.mjs 규칙 6'의 "침묵은 금지" 원칙과 동일 사고).
 *
 * ── 재시도 없음(의도) ───────────────────────────────────────────────────────────────
 * `monitor-freshness.mjs`의 `probeRoutesWithRetry`(30초 후 1회 재시도)와 달리 이 파일의 프로브에는
 * 재시도가 없다. 이 검사가 잡는 실패(사설 호스트·http 스킴)는 **설정값 문제라 재시도해도 결과가
 * 바뀌지 않는다** — 일시적 블립이 아니라 결정적 오설정이다. 도달 실패(403/404/5xx/timeout)의
 * 일시적 블립 흡수는 monitor-freshness.mjs의 15분 주기 재조회가 자연스러운 재시도 역할을 한다
 * (그쪽 규칙 6' 주석과 동일 논리 — 매 틱마다 재시도하면 오탐만 늘어난다).
 *
 * ── 이 파일이 단일 판정 원천이다 ────────────────────────────────────────────────────
 * `deploy-smoke.mjs`·`monitor-freshness.mjs`가 각자 판정 로직을 베끼면 대장 #195(규칙 사본이
 * 갈라짐)가 재발한다. 두 스크립트 모두 이 파일의 `checkMediaReachability`(+ 출력용
 * `formatMediaVerdictLines`) 하나만 호출한다.
 *
 * ── CLI(단독 실행) ───────────────────────────────────────────────────────────────────
 *   node media-reachability.mjs --api-url https://api.bapfull.com
 *   node media-reachability.mjs --api-url https://api.bapfull.com --json-out ./media-verdict.json
 * `--json-out`(대장 #243 — deploy-rollback.mjs가 이 판정 JSON을 축 입력으로 그대로 소비한다)은
 * `checkMediaReachability`가 이미 계산한 verdict 객체를 그대로 파일에 적을 뿐이다 — 판정 로직은
 * 이 플래그로 한 줄도 바뀌지 않는다.
 */

import { writeFileSync } from 'node:fs';

const DEFAULT_TIMEOUT_MS = 10_000;

// ═══════════════════════════════════════════════════════════════════════════════════
// ① 호스트 판정 — 순수 함수, 네트워크 0회
// ═══════════════════════════════════════════════════════════════════════════════════

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** IPv4 dotted-quad 문자열 → 옥텟 배열(0~255 범위를 벗어나면 null). IPv4가 아니면 null. */
function parseIpv4Octets(hostname) {
  const m = IPV4_RE.exec(hostname);
  if (!m) return null;
  const octets = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  if (octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) return null;
  return octets;
}

function isLoopbackHostname(hostname) {
  const h = hostname.toLowerCase();
  if (h === 'localhost') return true;
  if (h === '::1' || h === '[::1]') return true;
  const octets = parseIpv4Octets(hostname);
  return Boolean(octets && octets[0] === 127);
}

/**
 * RFC1918 사설 대역(10/8·172.16/12·192.168/16) + Tailscale CGNAT(100.64.0.0/10).
 * ⚠️ **100.64.0.0/10은 `100.*` 전체가 아니다.** 두 번째 옥텟이 64~127인 것만 사설이다 —
 * `100.63.255.255`(둘째 옥텟 63)는 공인, `100.128.0.0`(둘째 옥텟 128)도 공인이다. 첫 옥텟만 100인
 * 것과 CGNAT 여부를 혼동하면 공인 IP를 사설로 오판하는 false positive가 난다(경계값은 테스트에서
 * 4점 확인 — 100.63.255.255·100.64.0.0·100.127.255.255·100.128.0.0).
 */
function isPrivateIpv4(octets) {
  const [a, b] = octets;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  return false;
}

function isInternalTld(hostname) {
  const h = hostname.toLowerCase();
  return h.endsWith('.local') || h.endsWith('.internal');
}

/**
 * URL 1건의 호스트·스킴만으로 판정 가능한 실패를 **전부** 모아 반환한다(네트워크 0회, 즉시).
 * 하나의 URL이 여러 조건에 동시에 걸릴 수 있다 — 우선순위로 하나만 골라 버리면 실제로 존재하는
 * 나머지 결함이 검사 결과에서 사라진다(대장 #169 실물: `http://192.168.0.101:9000/...`는
 * private-host이자 insecure-scheme).
 * @param {unknown} urlString
 * @returns {string[]} 빈 배열 = 호스트 판정 통과. 코드: invalid-url·loopback-host·private-host·
 *   internal-host·insecure-scheme
 */
export function classifyHostFailures(urlString) {
  let parsed;
  try {
    parsed = new URL(String(urlString));
  } catch {
    return ['invalid-url'];
  }
  const hostname = parsed.hostname;
  if (!hostname) return ['invalid-url'];

  const failures = [];
  if (isLoopbackHostname(hostname)) {
    failures.push('loopback-host');
  } else {
    const octets = parseIpv4Octets(hostname);
    if (octets && isPrivateIpv4(octets)) failures.push('private-host');
  }
  if (isInternalTld(hostname)) failures.push('internal-host');
  if (parsed.protocol === 'http:') failures.push('insecure-scheme');
  return failures;
}

// ═══════════════════════════════════════════════════════════════════════════════════
// ② 도달 판정 — 프로브(네트워크 I/O, fetch 주입) + 순수 분류 함수
// ═══════════════════════════════════════════════════════════════════════════════════

async function fetchWithTimeout(fetchImpl, url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function isAbortError(err) {
  if (!err) return false;
  if (err.name === 'AbortError' || err.name === 'TimeoutError') return true;
  return /aborted/i.test(String(err.message ?? err));
}

/**
 * 호스트 판정을 통과한 타깃 각각에 실제 GET을 던진다. 호스트 판정에서 이미 걸린 타깃은 네트워크를
 * 아예 타지 않는다(`attempted:false`) — ①은 "네트워크 없이, 즉시"가 계약이다.
 * @param {{source:string,url:string,expectedContentTypePrefix?:string}[]} targets
 * @param {{timeoutMs?:number, fetchImpl?: typeof fetch}} [opts]
 */
export async function probeMediaTargets(targets, { timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl = fetch } = {}) {
  const results = [];
  for (const target of targets ?? []) {
    const hostFailures = classifyHostFailures(target.url);
    if (hostFailures.length > 0) {
      results.push({
        ...target,
        hostFailures,
        attempted: false,
        status: null,
        error: null,
        contentType: null,
        timedOut: false,
      });
      continue;
    }
    try {
      const res = await fetchWithTimeout(fetchImpl, target.url, timeoutMs);
      const contentType =
        typeof res.headers?.get === 'function' ? res.headers.get('content-type') : null;
      results.push({
        ...target,
        hostFailures: [],
        attempted: true,
        status: res.status,
        error: null,
        contentType,
        timedOut: false,
      });
    } catch (err) {
      results.push({
        ...target,
        hostFailures: [],
        attempted: true,
        status: null,
        error: String(err && err.message ? err.message : err),
        contentType: null,
        timedOut: isAbortError(err),
      });
    }
  }
  return results;
}

function contentTypeMatches(contentType, expectedPrefix) {
  if (!expectedPrefix) return true; // 기대치 없으면 판정 생략
  return typeof contentType === 'string' && contentType.toLowerCase().startsWith(expectedPrefix.toLowerCase());
}

/**
 * ②도달 판정 — `probeMediaTargets`가 채운 결과 1건을 분류한다. `deploy-smoke.mjs`의
 * `classifyRouteFailure`와 같은 수준(사유별 구분 코드)이며, 미디어 전용으로 403(forbidden)과
 * content_type_mismatch를 추가했다.
 * @param {{attempted:boolean,timedOut?:boolean,error:string|null,status:number|null,contentType?:string|null,expectedContentTypePrefix?:string}} probed
 * @returns {'timeout'|'request_failed'|'not_found'|'forbidden'|'server_error'|'unexpected_status'|'content_type_mismatch'|null}
 */
export function classifyReachabilityFailure(probed) {
  if (!probed.attempted) return null; // 호스트 판정에서 이미 걸려 네트워크 미시도 — hostFailures가 사유
  if (probed.timedOut) return 'timeout';
  if (probed.error != null) return 'request_failed';
  if (probed.status === 404) return 'not_found';
  if (probed.status === 403) return 'forbidden';
  if (typeof probed.status === 'number' && probed.status >= 500) return 'server_error';
  if (probed.status !== 200) return 'unexpected_status';
  if (!contentTypeMatches(probed.contentType, probed.expectedContentTypePrefix)) return 'content_type_mismatch';
  return null;
}

/** 사람이 읽는 한국어 사유 라벨(CLI 출력·양쪽 배선 스크립트 공용 — 사본 방지). */
export const FAILURE_LABELS = {
  'invalid-url': 'URL 파싱 실패',
  'loopback-host': '루프백 호스트(127.*/localhost/::1)',
  'private-host': '사설 IP(RFC1918 또는 Tailscale CGNAT 100.64.0.0/10)',
  'internal-host': '내부 TLD(.local/.internal)',
  'insecure-scheme': 'http 스킴(https 페이지에서 mixed-content로 차단됨)',
  timeout: '요청 타임아웃',
  request_failed: '요청 실패(네트워크 오류)',
  not_found: 'HTTP 404(오브젝트 없음)',
  forbidden: 'HTTP 403(서명·정책 거부 — MinIO AccessDenied 전형)',
  server_error: '서버 오류(5xx)',
  unexpected_status: '예상 밖 상태코드',
  content_type_mismatch: 'content-type 불일치(예: SPA 폴백 text/html 혼입 의심)',
};

/** 타깃 1건 = 호스트 판정 + 도달 판정을 합쳐 최종 ok/failureKinds를 매긴다(순수). */
export function judgeMediaTarget(probed) {
  const reachabilityFailure = classifyReachabilityFailure(probed);
  const failureKinds = [...(probed.hostFailures ?? []), ...(reachabilityFailure ? [reachabilityFailure] : [])];
  return { ...probed, reachabilityFailure, failureKinds, ok: failureKinds.length === 0 };
}

// ═══════════════════════════════════════════════════════════════════════════════════
// 검사 대상 수집 — 공개 피드 경로에서 실제로 얻는다(순수 추출 함수 + 네트워크 수집 함수 분리)
// ═══════════════════════════════════════════════════════════════════════════════════

/**
 * `GET /v1/feed?limit=1` 응답(JSON.parse된 값)에서 미디어 타깃을 뽑는다(순수, 네트워크 0회).
 * 스키마 원천: `packages/shared/src/subscriber/dto.ts` FeedItem. `thumbnailUrl`은 **선택 필드**다
 * (`feed.service.ts`의 `if (thumb)` — 썸네일이 아직 없는 콘텐츠는 생략될 수 있다).
 * @param {unknown} body
 * @returns {{ contentId: string|null, targets: {source:string,url:string,expectedContentTypePrefix:string}[], emptyFeed: boolean, malformed: boolean }}
 */
export function extractFeedMediaTargets(body) {
  const items = body && typeof body === 'object' && Array.isArray(body.items) ? body.items : null;
  if (items === null) {
    // 응답 형태 자체가 계약과 다름 — "피드가 비었다"와는 다른 사고(스키마 드리프트).
    return { contentId: null, targets: [], emptyFeed: false, malformed: true };
  }
  if (items.length === 0) {
    return { contentId: null, targets: [], emptyFeed: true, malformed: false };
  }
  const first = items[0];
  const targets = [];
  if (typeof first.thumbnailUrl === 'string' && first.thumbnailUrl.length > 0) {
    targets.push({ source: 'feed.thumbnailUrl', url: first.thumbnailUrl, expectedContentTypePrefix: 'image/' });
  }
  const contentId = typeof first.contentId === 'string' && first.contentId.length > 0 ? first.contentId : null;
  return { contentId, targets, emptyFeed: false, malformed: false };
}

/**
 * `GET /v1/feed/:id/playback` 응답에서 미디어 타깃을 뽑는다(순수, 네트워크 0회). `hlsUrl`은 shared
 * `PlaybackInfo`의 **필수 필드**라 정상 응답이면 항상 1개 이상 나온다 — 없으면 계약 위반(malformed).
 * ⚠️ 필드명이 `hlsUrl`이라도 실제로는 mp4 렌디션 GET URL이다(media-worker가 `video/mp4`로 업로드,
 * `feed.controller.ts` 주석 "hlsUrl은 공개 CDN URL 또는 서명 URL") — 기대 content-type은 `video/`.
 * `posterUrl`은 선택(썸네일과 동일하게 `image/`).
 * @param {unknown} body
 */
export function extractPlaybackMediaTargets(body) {
  if (!body || typeof body !== 'object') return { targets: [], malformed: true };
  const hasHlsUrl = typeof body.hlsUrl === 'string' && body.hlsUrl.length > 0;
  const targets = [];
  if (hasHlsUrl) {
    targets.push({ source: 'playback.hlsUrl', url: body.hlsUrl, expectedContentTypePrefix: 'video/' });
  }
  if (typeof body.posterUrl === 'string' && body.posterUrl.length > 0) {
    targets.push({ source: 'playback.posterUrl', url: body.posterUrl, expectedContentTypePrefix: 'image/' });
  }
  return { targets, malformed: !hasHlsUrl };
}

async function fetchJsonWithTimeout(url, { fetchImpl, timeoutMs }) {
  try {
    const res = await fetchWithTimeout(fetchImpl, url, timeoutMs);
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}`, body: null };
    }
    let body;
    try {
      body = await res.json();
    } catch (err) {
      return { ok: false, error: `JSON 파싱 실패: ${err.message}`, body: null };
    }
    return { ok: true, error: null, body };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err), body: null };
  }
}

/**
 * 공개 피드 경로에서 실제 미디어 타깃을 수집한다(네트워크 O). `GET /v1/feed?limit=1` → 항목이
 * 있으면 `GET /v1/feed/{id}/playback`까지 순서대로 부른다. 하드코딩 URL이 아니라 **api가 실제로
 * 발급하는 URL**을 받는 것이 이 함수의 존재 이유다(위임문 B).
 *
 * ⚠️ 서명 URL은 만료가 있다 — 이 함수가 반환한 `targets`는 호출 즉시 `probeMediaTargets`에 넘겨야
 * 한다(캐시·지연 호출 금지). `checkMediaReachability`가 그 순서를 보장한다.
 * @param {{ apiBaseUrl: string, fetchImpl?: typeof fetch, timeoutMs?: number }} opts
 */
export async function collectMediaTargets({ apiBaseUrl, fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const feedUrl = new URL('/v1/feed?limit=1', apiBaseUrl).toString();
  const feedResult = await fetchJsonWithTimeout(feedUrl, { fetchImpl, timeoutMs });
  if (!feedResult.ok) {
    return {
      targets: [],
      emptyFeed: false,
      feedFetchFailed: true,
      feedFetchError: feedResult.error,
      playbackFetchFailed: false,
      playbackFetchError: null,
    };
  }

  const feedExtract = extractFeedMediaTargets(feedResult.body);
  if (feedExtract.malformed) {
    return {
      targets: [],
      emptyFeed: false,
      feedFetchFailed: true,
      feedFetchError: 'GET /v1/feed 응답이 계약 형태({items:[...]}) 와 다름',
      playbackFetchFailed: false,
      playbackFetchError: null,
    };
  }
  if (feedExtract.emptyFeed) {
    return {
      targets: [],
      emptyFeed: true,
      feedFetchFailed: false,
      feedFetchError: null,
      playbackFetchFailed: false,
      playbackFetchError: null,
    };
  }

  const targets = [...feedExtract.targets];

  if (!feedExtract.contentId) {
    // items[0]에 contentId가 없음 — 계약 위반. playback을 부를 키가 없다.
    return {
      targets,
      emptyFeed: false,
      feedFetchFailed: false,
      feedFetchError: null,
      playbackFetchFailed: true,
      playbackFetchError: 'feed 응답 items[0]에 contentId가 없음(계약 위반)',
    };
  }

  const playbackUrl = new URL(
    `/v1/feed/${encodeURIComponent(feedExtract.contentId)}/playback`,
    apiBaseUrl,
  ).toString();
  const playbackResult = await fetchJsonWithTimeout(playbackUrl, { fetchImpl, timeoutMs });
  if (!playbackResult.ok) {
    return {
      targets,
      emptyFeed: false,
      feedFetchFailed: false,
      feedFetchError: null,
      playbackFetchFailed: true,
      playbackFetchError: playbackResult.error,
    };
  }

  const playbackExtract = extractPlaybackMediaTargets(playbackResult.body);
  targets.push(...playbackExtract.targets);

  return {
    targets,
    emptyFeed: false,
    feedFetchFailed: false,
    feedFetchError: null,
    playbackFetchFailed: playbackExtract.malformed,
    playbackFetchError: playbackExtract.malformed
      ? 'GET /v1/feed/:id/playback 응답에 hlsUrl(필수 필드)이 없음(계약 위반)'
      : null,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════════
// 최종 판정 — 순수 함수(네트워크 0회)
// ═══════════════════════════════════════════════════════════════════════════════════

function finalizeMediaVerdict({ failures, warnings, targets }) {
  const ok = failures.length === 0;
  const warningSuffix =
    warnings.length > 0 ? ` | 경고 ${warnings.length}건: ${warnings.map((w) => w.message).join('; ')}` : '';
  return {
    ok,
    status: ok ? 'PASS' : 'FAIL',
    primaryCode: failures[0]?.code ?? warnings[0]?.code ?? 'ok',
    reason:
      (ok ? '전 미디어 URL 도달 확인' : failures.map((f) => `${f.code}: ${f.message}`).join(' | ')) +
      warningSuffix,
    failures,
    warnings,
    targets,
  };
}

/**
 * `collectMediaTargets` + `probeMediaTargets` 결과를 최종 판정한다(순수). `deploy-smoke.mjs`의
 * `judgeResults`·`monitor-freshness.mjs`의 `judgeFreshness`와 동형 반환 형태(ok/status/reason/
 * failures/warnings) — 두 파일이 이 결과를 그대로 자기 판정에 얹을 수 있게 맞췄다.
 *
 * 피드 0건 판정 근거는 파일 헤더 "피드가 비어 있을 때" 절 참조 — `ok:true`이되 `warnings`에
 * `empty-feed`를 항상 남긴다(침묵 금지).
 * @param {{
 *   targets: {source:string,url:string,expectedContentTypePrefix?:string,attempted?:boolean,hostFailures?:string[],status?:number|null,error?:string|null,contentType?:string|null,timedOut?:boolean}[],
 *   emptyFeed?: boolean, feedFetchFailed?: boolean, feedFetchError?: string|null,
 *   playbackFetchFailed?: boolean, playbackFetchError?: string|null,
 * }} input
 */
export function judgeMediaReachability(input) {
  const {
    targets = [],
    emptyFeed = false,
    feedFetchFailed = false,
    feedFetchError = null,
    playbackFetchFailed = false,
    playbackFetchError = null,
  } = input ?? {};

  if (feedFetchFailed) {
    const failures = [
      {
        code: 'feed-fetch-failed',
        message: `GET /v1/feed 수집 실패 — 미디어 도달성 검사 불능: ${feedFetchError ?? '(사유 미상)'}`,
      },
    ];
    return finalizeMediaVerdict({ failures, warnings: [], targets: [] });
  }

  if (emptyFeed) {
    const warnings = [
      {
        code: 'empty-feed',
        message:
          'published 콘텐츠 0건 — 검사할 미디어 URL이 없어 도달성 미검증(PASS로 위장하지 않기 위해 WARN으로 기록, 규율 21)',
      },
    ];
    return {
      ok: true,
      status: 'PASS',
      primaryCode: 'empty-feed',
      reason: warnings[0].message,
      failures: [],
      warnings,
      targets: [],
    };
  }

  const failures = [];
  const warnings = [];

  if (playbackFetchFailed) {
    failures.push({
      code: 'playback-fetch-failed',
      message: `GET /v1/feed/:id/playback 수집 실패 — hlsUrl 도달성 검사 불능: ${playbackFetchError ?? '(사유 미상)'}`,
    });
  }

  const judged = targets.map(judgeMediaTarget);
  for (const t of judged.filter((t) => !t.ok)) {
    const labels = t.failureKinds.map((k) => FAILURE_LABELS[k] ?? k).join(', ');
    failures.push({
      code: t.failureKinds[0],
      failureKinds: t.failureKinds,
      source: t.source,
      url: t.url,
      message: `${t.source}(${t.url}) 도달 불가 — [${t.failureKinds.join(', ')}] ${labels}`,
    });
  }

  if (judged.length === 0 && !playbackFetchFailed) {
    warnings.push({
      code: 'no-media-targets',
      message: 'feed·playback 응답은 정상이나 검사할 미디어 URL을 하나도 얻지 못함(예상 밖 — 스키마 확인 필요)',
    });
  }

  return finalizeMediaVerdict({ failures, warnings, targets: judged });
}

/**
 * `deploy-smoke.mjs`·`monitor-freshness.mjs`가 **공통으로 호출하는 단일 진입점**(대장 #195 "규칙
 * 사본이 갈라짐" 방지 — 두 스크립트는 이 함수 하나만 부르고 판정을 베끼지 않는다).
 * @param {{ apiBaseUrl: string, fetchImpl?: typeof fetch, timeoutMs?: number }} opts
 */
export async function checkMediaReachability({ apiBaseUrl, fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const collected = await collectMediaTargets({ apiBaseUrl, fetchImpl, timeoutMs });
  const probed = await probeMediaTargets(collected.targets, { fetchImpl, timeoutMs });
  return judgeMediaReachability({ ...collected, targets: probed });
}

/**
 * 판정 결과를 사람이 읽는 줄 배열로 만든다(CLI·배선 스크립트 공용 — 출력 형식도 사본을 만들지
 * 않는다). 실패 사유는 코드(`failureKinds`)와 한국어 라벨을 **함께** 찍는다 — 로그만 보고도 정확한
 * 코드 토큰(예: `private-host`)을 알 수 있어야 한다.
 * @param {ReturnType<typeof judgeMediaReachability>} verdict
 * @returns {string[]}
 */
export function formatMediaVerdictLines(verdict) {
  const lines = [];
  for (const t of verdict.targets ?? []) {
    if (t.ok) {
      lines.push(`  ✔ ${t.source}: 도달 확인 (HTTP ${t.status}, ${t.contentType ?? '(content-type 없음)'})`);
    } else {
      const labels = (t.failureKinds ?? []).map((k) => FAILURE_LABELS[k] ?? k).join(', ');
      lines.push(`  ✘ ${t.source} (${t.url}): [${(t.failureKinds ?? []).join(', ')}] ${labels}`);
    }
  }
  for (const w of verdict.warnings ?? []) {
    lines.push(`  ⚠ ${w.code}: ${w.message}`);
  }
  lines.push(`  판정: ${verdict.status} — ${verdict.reason}`);
  return lines;
}

// ═══════════════════════════════════════════════════════════════════════════════════
// CLI
// ═══════════════════════════════════════════════════════════════════════════════════

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--api-url':
        opts.apiUrl = argv[++i];
        break;
      case '--timeout-ms':
        opts.timeoutMs = argv[++i];
        break;
      case '--json-out':
        opts.jsonOut = argv[++i];
        break;
      default:
        throw new Error(`알 수 없는 인자: ${arg}`);
    }
  }
  return opts;
}

async function main() {
  console.log('── 공개 미디어 URL 도달성 검사 (대장 #169) ──');

  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
    return;
  }

  if (!opts.apiUrl) {
    console.error('필수 인자 누락: --api-url');
    process.exitCode = 1;
    return;
  }

  const timeoutMs = opts.timeoutMs ? Number(opts.timeoutMs) : DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    console.error(`잘못된 --timeout-ms: ${opts.timeoutMs}`);
    process.exitCode = 1;
    return;
  }

  console.log(`입력: --api-url ${opts.apiUrl}`);

  let verdict;
  try {
    verdict = await checkMediaReachability({ apiBaseUrl: opts.apiUrl, timeoutMs });
  } catch (err) {
    console.error(`검사 실행 실패: ${err.message}`);
    process.exitCode = 1;
    return;
  }

  for (const line of formatMediaVerdictLines(verdict)) {
    if (line.includes('✘') || line.startsWith('  판정: FAIL')) console.error(line);
    else console.log(line);
  }

  if (opts.jsonOut) {
    writeFileSync(opts.jsonOut, JSON.stringify(verdict, null, 2));
  }

  process.exitCode = verdict.ok ? 0 : 1;
}

const isMainModule = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  main();
}
