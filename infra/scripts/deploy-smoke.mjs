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
 * ── 대상 라우트(최소, 하드코딩 — `resolveDefaultRoutes`) ──────────────────────────
 *   /health/version · /v1/feed · /v1/contents · /v1/resident-uploads/<임의id>
 * `/v1/resident-uploads/<id>`가 **반드시** 포함돼야 한다 — 이 라우트의 404가 대장 #180의 발견
 * 경로였다. `findMissingRequiredRoutes`가 입력 라우트 목록에서 이 4종의 부재를 별도로 잡는다
 * (— `--status-file` 입력이 이 필수 라우트를 빠뜨려도 조용히 통과하지 않도록).
 *
 * ── 입력 모드 2종(`verify-deployed-sha.mjs`와 동형) ─────────────────────────────
 *   --base-url <url>     : 직접 fetch(테스트·로컬 재현용. 러너에서 제온으로 직접 HTTP가 가는지는
 *                           미확인이므로 실제 배포 워크플로에서는 쓰지 않는다).
 *   --status-file <path> : 이미 수집된 상태 코드 JSON을 읽어 판정만 한다(실제 배포 워크플로가
 *                           쓰는 경로 — `verify-deployed-sha.mjs`의 `--body-file`과 동일한 이유:
 *                           `build-images.yml`의 SHA 대조 스텝이 이미 확립한 SSH+`docker exec`
 *                           경로로 컨테이너 **내부에서** 라우트를 수집하고, 이 스크립트는 그 결과만
 *                           판정한다). JSON 형태: `{"routes":[{"path":"...","status":200|null,
 *                           "error":"..."|null}, ...], "absent":{"path":"...","status":...,"error":...}}`.
 *   두 옵션이 함께 주어지면 `--status-file`이 우선한다(`verify-deployed-sha.mjs`의 body-file 우선과 동일).
 *
 * ── fail-closed ─────────────────────────────────────────────────────────────────
 * 대상 라우트 중 하나라도 404 또는 요청 실패/타임아웃 → exit 1. 필수 라우트(위 4종) 중 목록에서
 * 빠진 것이 있음 → exit 1. 음성 대조가 404가 아니거나 요청 실패 → exit 1(판정 불능도 통과 아님).
 * 대상 라우트 목록이 비어 있음 → exit 1. `--status-file` 파싱 실패 → exit 1.
 *
 * ── 사용법 ────────────────────────────────────────────────────────────────────────
 *   node deploy-smoke.mjs --base-url https://example.com
 *   node deploy-smoke.mjs --status-file ./smoke-status.json
 */
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const DEFAULT_TIMEOUT_MS = 10_000;

// ── 기본 라우트 — 순수 데이터/함수 ────────────────────────────────────────────────

/** `{id}` 자리에 랜덤 id가 채워진다. */
const ROUTE_TEMPLATES = ['/health/version', '/v1/feed', '/v1/contents', '/v1/resident-uploads/{id}'];

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
 * 대상 라우트 목록이 대장 #180이 지목한 4종 패턴을 전부 포함하는지 확인한다. 특히
 * `/v1/resident-uploads/<id>`는 정확한 문자열이 아니라 **패턴**으로 확인한다(랜덤 id가 매번 다르다).
 * @param {{path: string}[]} routeResults
 * @returns {string[]} 누락된 라우트 라벨(빈 배열=전부 포함)
 */
export function findMissingRequiredRoutes(routeResults) {
  const paths = (routeResults ?? []).map((r) => r.path);
  const requirements = [
    { label: '/health/version', test: (p) => p === '/health/version' },
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
      return { path, status: res.status, error: null };
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

/**
 * @param {{ routeResults: {path:string,status:number|null,error:string|null}[], absentResult: {path:string,status:number|null,error:string|null} }} input
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
  const routeFailures = routes.filter((r) => r.error != null || r.status === 404);

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
    reason = `라우트 부재/요청 실패 ${routeFailures.length}건`;
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
      default:
        throw new Error(`알 수 없는 인자: ${arg}`);
    }
  }
  return opts;
}

function printResults({ routeResults, absentResult, verdict }) {
  for (const r of routeResults) {
    if (r.error != null) {
      console.error(`  ✘ ${r.path}: 요청 실패 — ${r.error}`);
    } else if (r.status === 404) {
      console.error(`  ✘ ${r.path}: HTTP 404 (라우트 부재)`);
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

  if (!verdict.ok) {
    console.error(`\n판정: FAIL — ${verdict.reason}`);
    process.exitCode = 1;
    return;
  }

  console.log(`\n판정: PASS — ${verdict.reason}`);
}

const isMainModule = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  main();
}
