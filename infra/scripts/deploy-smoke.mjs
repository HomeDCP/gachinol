#!/usr/bin/env node
/**
 * infra/scripts/deploy-smoke.mjs
 *
 * 배포 후 라우트 스모크(대장 #180 잔여분 ①) — "배포된 이미지에 라우트가 실제로 존재하는가"를
 * CI 안에서 fail-closed로 확인한다.
 *
 * ── 왜 있는가 ────────────────────────────────────────────────────────────────────
 * `verify-deployed-sha.mjs`(SHA 대조)는 "무엇이 배포됐는가"만 확인하고 "그 안에 라우트가 실제로
 * 있는가"는 원리적으로 못 잡는다 — 라우트를 빠뜨린 이미지도 SHA는 정확히 일치한다. 대장 #180이
 * 스스로 적은 해소 판정 기준: *"의도적으로 라우트를 빠뜨린 이미지를 배포했을 때 파이프라인이
 * red가 되는 것(뮤테이션 실증)"*. 이 스크립트가 그것을 담당한다.
 *
 * ── 판정 원리 ────────────────────────────────────────────────────────────────────
 * 라우트가 실재하면 인증·리소스 여부와 무관하게 **≠404**를 준다(401=인증 필요, 200=공개, 등).
 * 라우트가 부재(빠짐)하면 Nest 라우터가 매치를 못 해 **404**를 준다. 그래서 "≠404"가 실재 판정이다.
 * 이 판정은 **음성 대조** 없이는 거짓 통과할 수 있다 — 모든 경로에 200을 주는(예: catch-all) 서버는
 * 실재하지 않는 라우트에도 200을 준다. 그래서 실재하지 않는 임의 경로(`__smoke_absent__<uuid>`)가
 * **정말로 404를 주는지**도 함께 확인한다. 음성 대조가 404가 아니면 판정 자체가 불능이므로 exit 1이다
 * (이 경우는 "실재 확인 실패"가 아니라 "확인 방법 자체가 무효"라는 뜻 — 통과가 아니다).
 *
 * ⭐ (대장 #204) **5xx도 실패다.** 舊 판정식은 `status === 404`만 봐서 DB가 죽어 `/v1/feed`가
 * 500을 내도 "라우트 실재"로 통과시켰다 — 라우트 존재와 서버 정상은 다른 질문인데 하나로 뭉개고
 * 있었다. `judgeResults`가 `status >= 500`도 `routeFailures`에 포함하고, `printResults`는
 * "라우트 부재(404)"와 "서버 오류(5xx)"를 **다른 사고로 구분 출력**한다(사람이 로그를 볼 때 원인
 * 추정이 갈린다 — 404는 배포 누락, 5xx는 런타임 장애).
 *
 * ── 대상 라우트(최소, 하드코딩 — `resolveDefaultRoutes`) ──────────────────────────
 *   /health/version · /health/readiness · /v1/feed · /v1/contents · /v1/resident-uploads/<임의id>
 * `/v1/resident-uploads/<id>`가 **반드시** 포함돼야 한다 — 이 라우트의 404가 대장 #180의 발견
 * 경로였다. `findMissingRequiredRoutes`가 입력 라우트 목록에서 이 5종의 부재를 별도로 잡는다
 * (— `--status-file` 입력이 이 필수 라우트를 빠뜨려도 조용히 통과하지 않도록).
 *
 * ⭐ (대장 #204) **`/health/readiness`는 나머지 4종과 판정 계약이 다르다.** 나머지는 "라우트가
 * 매치되는가"(≠404)만 보지만, readiness는 `services/api/src/health/health.controller.ts`가
 * `PrismaHealthIndicator.pingCheck`(DB `SELECT 1`) 하나만 재는 terminus 헬스체크라 **정확히
 * 200이어야 통과**다(401·404·5xx 전부 실패 — DB가 죽으면 terminus가 503을 낸다). 이 라우트는
 * 코드에 있었지만 **아무도 호출하지 않았다**(규율 21 "있는 척") — 지금 이 스크립트가 그 유일한
 * 호출자다.
 *
 * ⭐ (대장 #204·대장 #91형) **선택 필드 `contentType`** — `--status-file` JSON의 각 route 항목에
 * `contentType`(예: `"application/json; charset=utf-8"`)이 있으면, readiness 항목에 한해
 * `application/json`이 아닐 때도 실패로 잡는다(SPA 폴백이 200과 함께 `text/html`을 주는 오염을
 * 구조적으로 차단 — 대장 #91이 web 쪽에서 겪은 패턴의 재발 방지). **필드가 없으면 그 항목은
 * content-type 판정을 하지 않는다**(舊 status-file 입력과의 호환 — 필드 부재를 실패로 취급하지
 * 않는다).
 *
 * ── 입력 모드 2종(`verify-deployed-sha.mjs`와 동형) ─────────────────────────────
 *   --base-url <url>     : 직접 fetch(테스트·로컬 재현용. 러너에서 제온으로 직접 HTTP가 가는지는
 *                           미확인이므로 실제 배포 워크플로에서는 쓰지 않는다).
 *   --status-file <path> : 이미 수집된 상태 코드 JSON을 읽어 판정만 한다(실제 배포 워크플로가
 *                           쓰는 경로 — `verify-deployed-sha.mjs`의 `--body-file`과 동일한 이유:
 *                           `build-images.yml`의 SHA 대조 스텝이 이미 확립한 SSH+`docker exec`
 *                           경로로 컨테이너 **내부에서** 라우트를 수집하고, 이 스크립트는 그 결과만
 *                           판정한다). JSON 형태: `{"routes":[{"path":"...","status":200|null,
 *                           "error":"..."|null,"contentType":"..."|undefined}, ...],
 *                           "absent":{"path":"...","status":...,"error":...}}`.
 *   두 옵션이 함께 주어지면 `--status-file`이 우선한다(`verify-deployed-sha.mjs`의 body-file 우선과 동일).
 *
 * ── fail-closed ─────────────────────────────────────────────────────────────────
 * 대상 라우트 중 하나라도 404·5xx 또는 요청 실패/타임아웃 → exit 1. readiness는 정확히 200이
 * 아니면(401·404·5xx 포함) → exit 1, 200이어도 `contentType`이 있고 JSON이 아니면 → exit 1.
 * 필수 라우트(위 5종) 중 목록에서 빠진 것이 있음 → exit 1. 음성 대조가 404가 아니거나 요청 실패
 * → exit 1(판정 불능도 통과 아님). 대상 라우트 목록이 비어 있음 → exit 1. `--status-file` 파싱
 * 실패 → exit 1. `--media-base-url`을 줬는데 미디어 도달성이 FAIL(사설 호스트·http 스킴·403/404/
 * 5xx/타임아웃/content-type 불일치) → exit 1(라우트가 전부 통과해도 마찬가지 — 규율 23, 아래 절 참조).
 *
 * ── 규율 24 예외 사유(신규 게이트 2주 report-only 미적용) ───────────────────────────
 * `DISCIPLINES.md` 규율 24는 새 게이트에 2주 report-only를 요구하지만, 이 변경은 **새 게이트가
 * 아니다**: ⓐ 이미 blocking으로 살아있는 게이트(대장 #180)의 **판정식 확장**이다(규율 23 "검사
 * 범위 확장은 순서가 아니라 동반 의무"). ⓑ 2026-09-06 조율자 실측(인터넷 경로, 무토큰) — 대상
 * 6경로(`/health/version`·`/health/readiness`·`/v1/feed`·`/v1/contents`·
 * `/v1/resident-uploads/<uuid>`·부재경로) 중 **5xx가 0건**이라 이번 확장이 false positive를
 * 낼 여지가 없다(실측: 200/200/200/401/401/404). 이 두 근거가 없으면 즉시 blocking은 규율 위반이다.
 *
 * ── 사용법 ────────────────────────────────────────────────────────────────────────
 *   node deploy-smoke.mjs --base-url https://example.com
 *   node deploy-smoke.mjs --status-file ./smoke-status.json
 *
 * ── ⭐ 미디어 도달성 축 (대장 #169, `media-reachability.mjs`) — 선택 플래그 `--media-base-url` ──
 * "라우트가 실재하는가"와 "그 라우트 응답에 실린 미디어 URL이 인터넷에서 실제로 열리는가"는
 * 원리적으로 다른 질문이다(2026-09-12 실기 검증 — 구독자 웹 영상·썸네일이 전부 사설 IP를 가리켜
 * 인터넷에서 열리지 않았는데, 위의 라우트 4종·SHA 대조·`watch.bapfull.com/` 200 중 무엇도 이걸
 * 잡지 못했다). `--status-file`(오늘의 실제 `build-images.yml` 경로)은 SSH+docker exec로 **컨테이너
 * 내부**에서 수집한 값이라 이 축과 의미상 안 맞는다(내부망에서는 사설 IP도 멀쩡히 열린다 — 그게
 * 원 결함이 숨었던 이유다). 그래서 이 축은 `--base-url`/`--status-file`과 **독립된 새 플래그**로
 * 뺐다: 값을 주면(예: `--media-base-url https://api.bapfull.com`) `media-reachability.mjs`의
 * `checkMediaReachability`(공용 판정 함수 — `monitor-freshness.mjs`와 동일 함수, 사본 아님)를
 * 실제 인터넷 경로로 호출해 기존 라우트 판정과 함께 fail-closed로 묶는다. **값을 안 주면 기존
 * 동작과 100% 동일**(건너뛰었다는 로그만 남긴다) — 오늘의 `build-images.yml` 호출부
 * (`--status-file`만 사용)는 이 슬라이스로 전혀 달라지지 않는다.
 * ⚠️ **워크플로에 `--media-base-url`을 실제로 넘기는 배선은 이 슬라이스 범위 밖이다**
 * (`.github/workflows/**`는 소유 파일 밖) — 되면 `build-images.yml`의 SHA 대조 스텝이 이미 아는
 * 공개 API URL(예: `vars.WEB_EXPO_PUBLIC_API_URL`, `monitor.yml`이 쓰는 것과 동일 변수)을 그대로
 * 이 플래그에 얹으면 된다.
 */
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { checkMediaReachability, formatMediaVerdictLines } from './media-reachability.mjs';

const DEFAULT_TIMEOUT_MS = 10_000;

// ── 기본 라우트 — 순수 데이터/함수 ────────────────────────────────────────────────

/** `{id}` 자리에 랜덤 id가 채워진다. `/health/readiness`는 DB까지 재는 유일한 라우트(대장 #204). */
const ROUTE_TEMPLATES = [
  '/health/version',
  '/health/readiness',
  '/v1/feed',
  '/v1/contents',
  '/v1/resident-uploads/{id}',
];

/** readiness는 나머지 4종과 판정 계약이 달라(정확히 200) 여러 곳에서 참조하는 상수로 뺐다. */
const READINESS_PATH = '/health/readiness';

/**
 * @param {() => string} idGenerator 테스트에서 결정적 값 주입용(기본 randomUUID)
 * @returns {string[]}
 */
export function resolveDefaultRoutes(idGenerator = randomUUID) {
  return ROUTE_TEMPLATES.map((t) => (t.includes('{id}') ? t.replace('{id}', idGenerator()) : t));
}

/**
 * @param {() => string} idGenerator
 * @returns {string}
 */
export function resolveDefaultAbsentPath(idGenerator = randomUUID) {
  return `/v1/__smoke_absent__${idGenerator()}`;
}

/**
 * 대상 라우트 목록이 대장 #180·#204가 지목한 5종 패턴을 전부 포함하는지 확인한다. 특히
 * `/v1/resident-uploads/<id>`는 정확한 문자열이 아니라 **패턴**으로 확인한다(랜덤 id가 매번 다르다).
 * @param {{path: string}[]} routeResults
 * @returns {string[]} 누락된 라우트 라벨(빈 배열=전부 포함)
 */
export function findMissingRequiredRoutes(routeResults) {
  const paths = (routeResults ?? []).map((r) => r.path);
  const requirements = [
    { label: '/health/version', test: (p) => p === '/health/version' },
    { label: READINESS_PATH, test: (p) => p === READINESS_PATH },
    { label: '/v1/feed', test: (p) => p === '/v1/feed' },
    { label: '/v1/contents', test: (p) => p === '/v1/contents' },
    {
      label: '/v1/resident-uploads/<id>',
      test: (p) => /^\/v1\/resident-uploads\/.+/.test(p),
    },
  ];
  return requirements.filter((req) => !paths.some(req.test)).map((req) => req.label);
}

// ── 수집(직접 fetch) — `--base-url` 모드 ────────────────────────────────────────

async function fetchWithTimeout(fetchImpl, url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * `baseUrl` 기준으로 `routes`·`absentPath`를 실제로 fetch해 판정 입력 형태로 수집한다.
 * 네트워크 실패·타임아웃은 예외를 던지지 않고 `{status: null, error: <message>}`로 담는다
 * (개별 라우트 실패가 나머지 수집을 막지 않도록 — 판정은 `judgeResults`가 fail-closed로 한다).
 * @param {{ baseUrl: string, routes: string[], absentPath: string, timeoutMs?: number, fetchImpl?: typeof fetch }} opts
 */
export async function probeRoutes({
  baseUrl,
  routes,
  absentPath,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchImpl = fetch,
}) {
  async function probe(path) {
    const url = new URL(path, baseUrl).toString();
    try {
      const res = await fetchWithTimeout(fetchImpl, url, timeoutMs);
      // contentType: 테스트가 주입하는 목(mock) fetchImpl은 `.headers`가 없을 수 있어
      // optional chaining으로 보호한다(대장 #204 — readiness의 SPA 폴백 오염 판정에 쓰인다.
      // 값이 없으면 그 판정을 건너뛴다, judgeResults 참조).
      const contentType = typeof res.headers?.get === 'function' ? res.headers.get('content-type') : null;
      return { path, status: res.status, error: null, contentType };
    } catch (err) {
      return { path, status: null, error: String(err && err.message ? err.message : err) };
    }
  }

  const routeResults = [];
  for (const path of routes ?? []) {
    routeResults.push(await probe(path));
  }
  const absentResult = await probe(absentPath);
  return { routeResults, absentResult };
}

// ── 판정 — 순수 함수 ───────────────────────────────────────────────────────────────

/** `contentType` 문자열이 JSON 계열인지(대소문자·charset 파라미터 무관하게 판단). */
function isJsonContentType(contentType) {
  return typeof contentType === 'string' && contentType.toLowerCase().includes('application/json');
}

/**
 * 라우트 1건의 실패 여부·분류를 판정한다(대장 #204). `null`이면 실패가 아니다.
 * - `/health/readiness`는 나머지와 판정 계약이 다르다: **정확히 200**이어야 하고(401·404·5xx
 *   전부 실패), `contentType` 필드가 있으면 JSON이 아닐 때도 실패다(필드가 없으면 그 검사는
 *   생략 — 舊 status-file 호환).
 * - 그 외 라우트는 기존과 동일하게 "매치되는가"(≠404)만 보되, **5xx도 이번에 실패로 추가**한다
 *   (舊 판정식은 500을 "라우트 실재"로 통과시켰다).
 * @param {{path:string,status:number|null,error:string|null,contentType?:string|null}} r
 * @returns {'request_failed'|'route_missing'|'server_error'|'readiness_status'|'readiness_content_type'|null}
 */
function classifyRouteFailure(r) {
  if (r.error != null) return 'request_failed';
  if (r.path === READINESS_PATH) {
    if (r.status !== 200) return 'readiness_status';
    if (r.contentType != null && !isJsonContentType(r.contentType)) return 'readiness_content_type';
    return null;
  }
  if (r.status === 404) return 'route_missing';
  if (typeof r.status === 'number' && r.status >= 500) return 'server_error';
  return null;
}

const FAILURE_KIND_LABELS = {
  request_failed: '요청 실패',
  route_missing: '라우트 부재(404)',
  server_error: '서버 오류(5xx)',
  readiness_status: 'readiness 상태코드 이상(200 아님)',
  readiness_content_type: 'readiness content-type 이상(JSON 아님)',
};

/** `routeFailures`를 종류별로 묶어 "라우트 부재"와 "서버 오류"를 구분한 요약 문구를 만든다. */
function summarizeRouteFailures(routeFailures) {
  const counts = new Map();
  for (const r of routeFailures) {
    counts.set(r.failureKind, (counts.get(r.failureKind) ?? 0) + 1);
  }
  return [...counts.entries()].map(([kind, n]) => `${FAILURE_KIND_LABELS[kind] ?? kind} ${n}건`).join(', ');
}

/**
 * @param {{ routeResults: {path:string,status:number|null,error:string|null,contentType?:string|null}[], absentResult: {path:string,status:number|null,error:string|null} }} input
 */
export function judgeResults({ routeResults, absentResult }) {
  const routes = routeResults ?? [];

  if (routes.length === 0) {
    return {
      ok: false,
      reason: '검사 대상 라우트가 비어 있음',
      missingRequiredRoutes: findMissingRequiredRoutes([]),
      routeFailures: [],
      absentOk: false,
    };
  }

  const missingRequiredRoutes = findMissingRequiredRoutes(routes);
  const routeFailures = routes
    .map((r) => ({ ...r, failureKind: classifyRouteFailure(r) }))
    .filter((r) => r.failureKind != null);

  const absentFailed = !absentResult || absentResult.error != null;
  const absentNot404 = !absentFailed && absentResult.status !== 404;
  const absentOk = !absentFailed && !absentNot404;

  const ok = missingRequiredRoutes.length === 0 && routeFailures.length === 0 && absentOk;

  let reason;
  if (ok) {
    reason = '전 대상 라우트 실재 확인 + 음성 대조 정상';
  } else if (missingRequiredRoutes.length > 0) {
    reason = `필수 라우트 누락: ${missingRequiredRoutes.join(', ')}`;
  } else if (routeFailures.length > 0) {
    reason = `라우트 실패 ${routeFailures.length}건 (${summarizeRouteFailures(routeFailures)})`;
  } else if (absentFailed) {
    reason = `음성 대조 요청 실패: ${absentResult ? absentResult.error : '결과 없음'}`;
  } else {
    reason = `음성 대조가 404가 아님(판정 불능): HTTP ${absentResult.status}`;
  }

  return { ok, reason, missingRequiredRoutes, routeFailures, absentOk };
}

/**
 * `--status-file`로 읽은 JSON 본문을 판정 입력 형태로 파싱한다. 실패 시 예외를 던진다
 * (호출부가 fail-closed 메시지를 통일해서 낼 수 있도록 — `verify-deployed-sha.mjs`와 동형).
 * @param {string} content
 * @returns {{ routeResults: object[], absentResult: object }}
 */
export function parseStatusFile(content) {
  let json;
  try {
    json = JSON.parse(content);
  } catch (err) {
    throw new Error(`JSON 파싱 실패: ${err.message}`);
  }
  if (json === null || typeof json !== 'object' || Array.isArray(json)) {
    throw new Error('최상위가 객체가 아님');
  }
  if (!Array.isArray(json.routes) || json.routes.length === 0) {
    throw new Error('"routes" 배열이 없거나 비어 있음');
  }
  for (const r of json.routes) {
    if (!r || typeof r.path !== 'string') {
      throw new Error('"routes" 항목에 "path" 문자열이 없음');
    }
  }
  if (!json.absent || typeof json.absent.path !== 'string') {
    throw new Error('"absent" 객체 또는 "absent.path"가 없음');
  }
  return { routeResults: json.routes, absentResult: json.absent };
}

// ── CLI ─────────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--base-url':
        opts.baseUrl = argv[++i];
        break;
      case '--status-file':
        opts.statusFile = argv[++i];
        break;
      case '--timeout-ms':
        opts.timeoutMs = argv[++i];
        break;
      case '--media-base-url':
        opts.mediaBaseUrl = argv[++i];
        break;
      default:
        throw new Error(`알 수 없는 인자: ${arg}`);
    }
  }
  return opts;
}

function printResults({ routeResults, absentResult, verdict }) {
  for (const r of routeResults) {
    // 대장 #204: "라우트 부재"(404)와 "서버 오류"(5xx)는 사람이 볼 때 다른 사고다 — 구분 출력.
    const kind = classifyRouteFailure(r);
    if (kind === 'request_failed') {
      console.error(`  ✘ ${r.path}: 요청 실패 — ${r.error}`);
    } else if (kind === 'route_missing') {
      console.error(`  ✘ ${r.path}: HTTP 404 (라우트 부재)`);
    } else if (kind === 'server_error') {
      console.error(`  ✘ ${r.path}: HTTP ${r.status} (서버 오류 — 5xx, 대장 #204)`);
    } else if (kind === 'readiness_status') {
      console.error(`  ✘ ${r.path}: HTTP ${r.status} (readiness는 정확히 200이어야 함 — DB 등 이상 의심)`);
    } else if (kind === 'readiness_content_type') {
      console.error(
        `  ✘ ${r.path}: HTTP ${r.status}, content-type "${r.contentType}" (JSON 아님 — SPA 폴백 오염 의심)`,
      );
    } else {
      console.log(`  ✔ ${r.path}: HTTP ${r.status} (라우트 실재)`);
    }
  }
  if (verdict.missingRequiredRoutes.length > 0) {
    console.error(`  ✘ 필수 라우트가 검사 대상 목록 자체에 없음: ${verdict.missingRequiredRoutes.join(', ')}`);
  }
  if (absentResult) {
    if (absentResult.error != null) {
      console.error(`  ✘ 음성 대조(${absentResult.path}): 요청 실패 — ${absentResult.error}`);
    } else if (absentResult.status !== 404) {
      console.error(
        `  ✘ 음성 대조(${absentResult.path}): HTTP ${absentResult.status} (404가 아님 — 판정 불능)`,
      );
    } else {
      console.log(`  ✔ 음성 대조(${absentResult.path}): HTTP 404 (정상)`);
    }
  }
}

async function main() {
  console.log('── 배포 후 라우트 스모크 (대장 #180) ──');

  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
    return;
  }

  if (!opts.baseUrl && !opts.statusFile) {
    console.error('필수 인자 누락: --base-url 또는 --status-file 중 하나');
    process.exitCode = 1;
    return;
  }

  let routeResults;
  let absentResult;

  if (opts.statusFile) {
    let raw;
    try {
      raw = readFileSync(opts.statusFile, 'utf8');
    } catch (err) {
      console.error(`상태 파일 로드 실패: ${opts.statusFile} — ${err.message}`);
      process.exitCode = 1;
      return;
    }
    try {
      ({ routeResults, absentResult } = parseStatusFile(raw));
    } catch (err) {
      console.error(`상태 파일 파싱 실패(${opts.statusFile}): ${err.message}`);
      process.exitCode = 1;
      return;
    }
    console.log(`입력: --status-file ${opts.statusFile}`);
  } else {
    const timeoutMs = opts.timeoutMs ? Number(opts.timeoutMs) : DEFAULT_TIMEOUT_MS;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      console.error(`잘못된 --timeout-ms: ${opts.timeoutMs}`);
      process.exitCode = 1;
      return;
    }
    const routes = resolveDefaultRoutes();
    const absentPath = resolveDefaultAbsentPath();
    console.log(`입력: --base-url ${opts.baseUrl}`);
    try {
      ({ routeResults, absentResult } = await probeRoutes({
        baseUrl: opts.baseUrl,
        routes,
        absentPath,
        timeoutMs,
      }));
    } catch (err) {
      console.error(`검사 실행 실패: ${err.message}`);
      process.exitCode = 1;
      return;
    }
  }

  const verdict = judgeResults({ routeResults, absentResult });
  printResults({ routeResults, absentResult, verdict });

  // ⭐ 미디어 도달성(대장 #169) — 선택 축. `--media-base-url`이 없으면 기존 동작과 100% 동일하게
  // 라우트 판정만으로 exit code가 정해진다(오늘의 build-images.yml 호출부는 이 플래그를 안 준다).
  let mediaVerdict = null;
  if (opts.mediaBaseUrl) {
    console.log(`\n── 미디어 도달성 검사(대장 #169, --media-base-url ${opts.mediaBaseUrl}) ──`);
    try {
      mediaVerdict = await checkMediaReachability({ apiBaseUrl: opts.mediaBaseUrl });
    } catch (err) {
      mediaVerdict = {
        ok: false,
        status: 'FAIL',
        reason: `검사 실행 실패: ${err.message}`,
        failures: [{ code: 'execution-failed', message: err.message }],
        warnings: [],
        targets: [],
      };
    }
    for (const line of formatMediaVerdictLines(mediaVerdict)) {
      if (line.includes('✘') || line.startsWith('  판정: FAIL')) console.error(line);
      else console.log(line);
    }
  } else {
    console.log('\n미디어 도달성 검사: 건너뜀(--media-base-url 미지정)');
  }

  const overallOk = verdict.ok && (mediaVerdict ? mediaVerdict.ok : true);
  if (!overallOk) {
    const reasons = [
      !verdict.ok ? `라우트: ${verdict.reason}` : null,
      mediaVerdict && !mediaVerdict.ok ? `미디어: ${mediaVerdict.reason}` : null,
    ].filter(Boolean);
    console.error(`\n판정: FAIL — ${reasons.join(' | ')}`);
    process.exitCode = 1;
    return;
  }

  console.log(`\n판정: PASS — ${verdict.reason}${mediaVerdict ? ` | 미디어: ${mediaVerdict.reason}` : ''}`);
}

const isMainModule = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  main();
}
