// infra/scripts/deploy-smoke.test.mjs
// 배포 후 라우트 스모크(대장 #180 잔여 ①) 단위 테스트.
//
// ⭐ 핵심은 "SHA는 일치하는데 라우트가 빠진 이미지를 배포했을 때 이 검사가 red가 되는가"다 —
// 아래 로컬 http 서버 기반 "뮤테이션" 블록이 그 증거다: 실제 네트워크 요청을 로컬
// `node:http` 서버로 왕복시켜(외부망 불요) CLI 프로세스가 exit 1을 내는지 확인한다.
//
// ⚠️ 루트 `package.json`의 `test:scripts`에 이 파일을 등재해야 한다 — 잊으면
// `daejang-recheck.test.mjs`의 self-check(test:scripts 등재 검사)가 레드로 잡는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import {
  resolveDefaultRoutes,
  resolveDefaultAbsentPath,
  findMissingRequiredRoutes,
  probeRoutes,
  judgeResults,
  parseStatusFile,
} from './deploy-smoke.mjs';

const SCRIPT_PATH = fileURLToPath(new URL('./deploy-smoke.mjs', import.meta.url));

// ── resolveDefaultRoutes / resolveDefaultAbsentPath ──────────────────────────

test('⭐ resolveDefaultRoutes: 5개 라우트를 반환하고 resident-uploads에 id가 채워진다(대장 #204 — readiness 추가)', () => {
  const routes = resolveDefaultRoutes(() => 'fixed-id');
  assert.deepEqual(routes, [
    '/health/version',
    '/health/readiness',
    '/v1/feed',
    '/v1/contents',
    '/v1/resident-uploads/fixed-id',
  ]);
});

test('resolveDefaultAbsentPath: __smoke_absent__ 접두 + id', () => {
  assert.equal(resolveDefaultAbsentPath(() => 'xyz'), '/v1/__smoke_absent__xyz');
});

// ── findMissingRequiredRoutes ─────────────────────────────────────────────────

test('findMissingRequiredRoutes: 4종 전부 있으면 빈 배열', () => {
  const routes = resolveDefaultRoutes().map((path) => ({ path }));
  assert.deepEqual(findMissingRequiredRoutes(routes), []);
});

test('⭐ findMissingRequiredRoutes: resident-uploads가 빠지면 누락으로 잡는다(대장 #180 발견 경로)', () => {
  const routes = [
    { path: '/health/version' },
    { path: '/health/readiness' },
    { path: '/v1/feed' },
    { path: '/v1/contents' },
  ];
  const missing = findMissingRequiredRoutes(routes);
  assert.deepEqual(missing, ['/v1/resident-uploads/<id>']);
});

test('⭐ findMissingRequiredRoutes: readiness가 빠지면 누락으로 잡는다(대장 #204 — "있는 척"이던 라우트를 필수화)', () => {
  const routes = [
    { path: '/health/version' },
    { path: '/v1/feed' },
    { path: '/v1/contents' },
    { path: '/v1/resident-uploads/abc123' },
  ];
  const missing = findMissingRequiredRoutes(routes);
  assert.deepEqual(missing, ['/health/readiness']);
});

test('findMissingRequiredRoutes: 빈 배열이면 5종 전부 누락(대장 #204 — readiness 추가로 4→5)', () => {
  assert.equal(findMissingRequiredRoutes([]).length, 5);
});

test('findMissingRequiredRoutes: resident-uploads는 정확한 문자열이 아니라 패턴으로 인식한다(랜덤 id)', () => {
  const routes = [
    { path: '/health/version' },
    { path: '/health/readiness' },
    { path: '/v1/feed' },
    { path: '/v1/contents' },
    { path: `/v1/resident-uploads/${'a1b2c3d4-e5f6-47a8-9012-3456789abcde'}` },
  ];
  assert.deepEqual(findMissingRequiredRoutes(routes), []);
});

// ── judgeResults(순수 판정) ────────────────────────────────────────────────────

// readiness는 나머지와 판정 계약이 달라(정확히 200 + 선택적 JSON content-type) 기본값을 따로 준다.
const READINESS_TEST_PATH = '/health/readiness';

function okRoutes() {
  return resolveDefaultRoutes().map((path) => {
    if (path === READINESS_TEST_PATH) {
      return { path, status: 200, error: null, contentType: 'application/json; charset=utf-8' };
    }
    return { path, status: path === '/v1/feed' ? 200 : 401, error: null };
  });
}

test('judgeResults: 전 라우트 실재 + 음성 대조 404면 ok=true', () => {
  const routeResults = okRoutes();
  const absentResult = { path: '/v1/__smoke_absent__x', status: 404, error: null };
  const verdict = judgeResults({ routeResults, absentResult });
  assert.equal(verdict.ok, true);
});

test('⭐ judgeResults: 라우트 하나가 404면 ok=false(라우트 부재 = 이 게이트의 존재 이유)', () => {
  // path로 찾는다(인덱스 하드코딩 금지 — 대장 #204로 readiness가 배열 중간에 끼어들며 인덱스가 밀렸다).
  const routeResults = okRoutes().map((r) => (r.path === '/v1/contents' ? { ...r, status: 404, error: null } : r));
  const absentResult = { path: '/v1/__smoke_absent__x', status: 404, error: null };
  const verdict = judgeResults({ routeResults, absentResult });
  assert.equal(verdict.ok, false, '라우트 404인데 ok=true면 이 게이트는 SHA 대조와 다를 바 없다');
  assert.equal(verdict.routeFailures.length, 1);
});

// ── ⭐ 대장 #204: 5xx 판정 확장 + readiness 편입 (judgeResults, 순수 함수 층) ─────────

test('⭐ judgeResults: 라우트가 5xx면 ok=false — 舊 판정식은 500을 "라우트 실재"로 통과시켰다', () => {
  const routeResults = okRoutes().map((r) => (r.path === '/v1/feed' ? { ...r, status: 500, error: null } : r));
  const absentResult = { path: '/v1/__smoke_absent__x', status: 404, error: null };
  const verdict = judgeResults({ routeResults, absentResult });
  assert.equal(verdict.ok, false, '5xx인데 ok=true면 대장 #204가 재발한다');
  assert.match(verdict.reason, /5xx/);
});

test('judgeResults: readiness가 401이면 ok=false(나머지 라우트와 달리 401도 실패 — 정확히 200이어야 함)', () => {
  const routeResults = okRoutes().map((r) => (r.path === READINESS_TEST_PATH ? { ...r, status: 401 } : r));
  const absentResult = { path: '/v1/__smoke_absent__x', status: 404, error: null };
  const verdict = judgeResults({ routeResults, absentResult });
  assert.equal(verdict.ok, false);
});

test('⭐ judgeResults: readiness가 503이면 ok=false(DB 등 이상 — terminus가 503을 낸다)', () => {
  const routeResults = okRoutes().map((r) => (r.path === READINESS_TEST_PATH ? { ...r, status: 503 } : r));
  const absentResult = { path: '/v1/__smoke_absent__x', status: 404, error: null };
  const verdict = judgeResults({ routeResults, absentResult });
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /readiness/);
});

test('⭐ judgeResults: readiness가 200이어도 content-type이 text/html이면 ok=false(SPA 폴백 오염, 대장 #91형)', () => {
  const routeResults = okRoutes().map((r) =>
    r.path === READINESS_TEST_PATH ? { ...r, status: 200, contentType: 'text/html; charset=utf-8' } : r,
  );
  const absentResult = { path: '/v1/__smoke_absent__x', status: 404, error: null };
  const verdict = judgeResults({ routeResults, absentResult });
  assert.equal(verdict.ok, false);
});

test('judgeResults: readiness에 contentType 필드가 없으면 content-type 판정을 생략한다(舊 status-file 호환)', () => {
  const routeResults = okRoutes().map((r) =>
    r.path === READINESS_TEST_PATH ? { path: r.path, status: 200, error: null } : r,
  );
  const absentResult = { path: '/v1/__smoke_absent__x', status: 404, error: null };
  const verdict = judgeResults({ routeResults, absentResult });
  assert.equal(verdict.ok, true, 'contentType 필드가 없는데 실패하면 舊 status-file 입력이 전부 깨진다');
});

test('⭐ judgeResults: 음성 대조가 404가 아니면(모든 경로 200 서버) ok=false — "거짓 통과" 방지', () => {
  const routeResults = okRoutes().map((r) => ({ ...r, status: 200 }));
  const absentResult = { path: '/v1/__smoke_absent__x', status: 200, error: null }; // 무력화된 음성 대조
  const verdict = judgeResults({ routeResults, absentResult });
  assert.equal(verdict.ok, false, '음성 대조가 무력화됐는데 통과하면 이 스크립트의 핵심 요구가 깨진 것');
  assert.match(verdict.reason, /판정 불능/);
});

test('judgeResults: 요청 실패(error 필드)도 라우트 부재와 동일하게 실패로 취급', () => {
  const routeResults = okRoutes();
  routeResults[0] = { ...routeResults[0], status: null, error: 'ETIMEDOUT' };
  const absentResult = { path: '/v1/__smoke_absent__x', status: 404, error: null };
  const verdict = judgeResults({ routeResults, absentResult });
  assert.equal(verdict.ok, false);
});

test('judgeResults: 음성 대조 요청 실패도 exit 대상(통과 아님)', () => {
  const routeResults = okRoutes();
  const absentResult = { path: '/v1/__smoke_absent__x', status: null, error: 'ECONNREFUSED' };
  const verdict = judgeResults({ routeResults, absentResult });
  assert.equal(verdict.ok, false);
});

test('judgeResults: 대상 라우트 목록이 비면 ok=false', () => {
  const verdict = judgeResults({ routeResults: [], absentResult: { path: '/x', status: 404, error: null } });
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /비어 있음/);
});

test('judgeResults: 필수 라우트가 빠지면(목록에 없음) ok=false — 존재하는 라우트가 전부 통과여도', () => {
  const routeResults = [{ path: '/health/version', status: 200, error: null }];
  const absentResult = { path: '/v1/__smoke_absent__x', status: 404, error: null };
  const verdict = judgeResults({ routeResults, absentResult });
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /필수 라우트 누락/);
});

// ── probeRoutes(실 fetch, fetchImpl 주입으로 네트워크 없이 재현) ─────────────────

test('probeRoutes: fetchImpl 주입으로 상태코드를 수집한다(네트워크 없음)', async () => {
  const fetchImpl = async (url) => ({ status: url.includes('/v1/feed') ? 200 : 401 });
  const { routeResults, absentResult } = await probeRoutes({
    baseUrl: 'https://example.invalid',
    routes: ['/health/version', '/v1/feed'],
    absentPath: '/v1/__smoke_absent__x',
    fetchImpl,
  });
  assert.equal(routeResults.length, 2);
  assert.equal(routeResults.find((r) => r.path === '/v1/feed').status, 200);
  assert.equal(absentResult.status, 401); // 이 목은 항상 401 — 판정은 judgeResults 몫
});

test('probeRoutes: fetchImpl이 던지면 error 필드에 담기고(예외를 전파하지 않음)', async () => {
  const fetchImpl = async () => {
    throw new Error('network down');
  };
  const { routeResults } = await probeRoutes({
    baseUrl: 'https://example.invalid',
    routes: ['/health/version'],
    absentPath: '/v1/__smoke_absent__x',
    fetchImpl,
  });
  assert.equal(routeResults[0].status, null);
  assert.match(routeResults[0].error, /network down/);
});

test('probeRoutes: 타임아웃(AbortSignal) 시 error로 담긴다', async () => {
  const fetchImpl = (url, { signal }) =>
    new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('The operation was aborted')));
    });
  const { routeResults } = await probeRoutes({
    baseUrl: 'https://example.invalid',
    routes: ['/health/version'],
    absentPath: '/v1/__smoke_absent__x',
    timeoutMs: 20,
    fetchImpl,
  });
  assert.equal(routeResults[0].status, null);
  assert.match(routeResults[0].error, /aborted/);
});

// ── parseStatusFile ────────────────────────────────────────────────────────────

test('parseStatusFile: 정상 JSON을 파싱한다', () => {
  const content = JSON.stringify({
    routes: [{ path: '/health/version', status: 200, error: null }],
    absent: { path: '/v1/__smoke_absent__x', status: 404, error: null },
  });
  const { routeResults, absentResult } = parseStatusFile(content);
  assert.equal(routeResults.length, 1);
  assert.equal(absentResult.status, 404);
});

test('parseStatusFile: JSON 파싱 실패 시 예외', () => {
  assert.throws(() => parseStatusFile('not json'), /JSON 파싱 실패/);
});

test('parseStatusFile: routes가 빈 배열이면 예외', () => {
  const content = JSON.stringify({ routes: [], absent: { path: '/x' } });
  assert.throws(() => parseStatusFile(content), /routes.*비어/);
});

test('parseStatusFile: absent가 없으면 예외', () => {
  const content = JSON.stringify({ routes: [{ path: '/x' }] });
  assert.throws(() => parseStatusFile(content), /absent/);
});

test('parseStatusFile: routes 항목에 path가 없으면 예외', () => {
  const content = JSON.stringify({ routes: [{ status: 200 }], absent: { path: '/x' } });
  assert.throws(() => parseStatusFile(content), /path/);
});

// ── CLI(--status-file, 네트워크 없이 재현) ────────────────────────────────────────

function withTempFile(content, run) {
  const dir = mkdtempSync(join(tmpdir(), 'deploy-smoke-'));
  const file = join(dir, 'status.json');
  writeFileSync(file, content, 'utf8');
  try {
    return run(file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function runCli(args) {
  try {
    const stdout = execFileSync('node', [SCRIPT_PATH, ...args], { encoding: 'utf8' });
    return { code: 0, stdout };
  } catch (err) {
    return { code: err.status ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

// ── CLI를 로컬 http 서버와 "같은 프로세스"에서 왕복시키는 뮤테이션 테스트 전용 헬퍼 ─────
// ⚠️ 함정(실측): `execFileSync`(동기)로 CLI를 실행하면 이 테스트 프로세스의 이벤트 루프가
// execFileSync가 끝날 때까지 완전히 멈춘다 — 그런데 그 CLI 자식 프로세스가 접속하려는 http
// 서버도 **같은 프로세스**(이 테스트 러너)에서 떠 있으므로, 서버의 요청 핸들러가 이벤트 루프
// 정지 때문에 전혀 실행되지 못해 자식이 타임아웃(기본 10s)까지 응답을 못 받고 죽는다(실측:
// 테스트 3건이 각 50초씩 걸리며 전부 "요청 실패"로 오판정됐다). 비동기 `execFile`을 `await`하면
// 이 프로세스의 이벤트 루프가 살아있는 채로 자식을 기다리므로 서버가 정상 응답한다.
const execFileAsync = promisify(execFile);

async function runCliAsync(args) {
  try {
    const { stdout } = await execFileAsync('node', [SCRIPT_PATH, ...args]);
    return { code: 0, stdout };
  } catch (err) {
    return { code: err.code ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

function listenAsync(server) {
  return new Promise((resolvePromise) => {
    server.listen(0, '127.0.0.1', () => resolvePromise(server.address().port));
  });
}

function closeAsync(server) {
  return new Promise((resolvePromise) => server.close(() => resolvePromise()));
}

// 대장 #204: readiness가 5종째 필수 라우트로 편입됐다 — 기본 정상 픽스처에도 포함해야
// "정상 케이스"가 실제로 정상이다(빠뜨리면 이 픽스처 자체가 필수 라우트 누락으로 실패한다).
function validStatusFileContent() {
  return JSON.stringify({
    routes: [
      { path: '/health/version', status: 200, error: null },
      { path: '/health/readiness', status: 200, error: null, contentType: 'application/json; charset=utf-8' },
      { path: '/v1/feed', status: 200, error: null },
      { path: '/v1/contents', status: 401, error: null },
      { path: '/v1/resident-uploads/abc123', status: 401, error: null },
    ],
    absent: { path: '/v1/__smoke_absent__deadbeef', status: 404, error: null },
  });
}

/** `validStatusFileContent()`에서 `path`가 일치하는 route 항목만 `overrides`로 덮어쓴 JSON을 만든다.
 *  `overrides`에 `undefined` 값을 주면(예: `{contentType: undefined}`) `JSON.stringify`가 그 키를
 *  통째로 생략하므로 "필드 자체가 없는" 상태-파일 입력을 재현할 수 있다(舊 호환 케이스 재현용). */
function statusFileWithRouteOverride(path, overrides) {
  const payload = JSON.parse(validStatusFileContent());
  const idx = payload.routes.findIndex((r) => r.path === path);
  if (idx === -1) throw new Error(`fixture route not found: ${path}`);
  payload.routes[idx] = { ...payload.routes[idx], ...overrides };
  return JSON.stringify(payload);
}

/** `validStatusFileContent()`에서 `path` 항목을 통째로 제거한 JSON을 만든다(필수 라우트 누락 재현용). */
function statusFileWithoutRoute(path) {
  const payload = JSON.parse(validStatusFileContent());
  payload.routes = payload.routes.filter((r) => r.path !== path);
  return JSON.stringify(payload);
}

test('CLI: --status-file 정상 케이스는 exit 0', () => {
  withTempFile(validStatusFileContent(), (file) => {
    const { code, stdout } = runCli(['--status-file', file]);
    assert.equal(code, 0, stdout);
    assert.match(stdout, /판정: PASS/);
  });
});

// ── ⭐ 대장 #204 — 5xx 판정 확장 + readiness 편입 (CLI, --status-file) ─────────────

for (const status of [500, 502, 503]) {
  test(`⭐ CLI: /v1/feed가 HTTP ${status}면 exit 1(舊 판정식은 5xx를 "라우트 실재"로 통과시켰다)`, () => {
    const content = statusFileWithRouteOverride('/v1/feed', { status, error: null });
    withTempFile(content, (file) => {
      const { code, stderr } = runCli(['--status-file', file]);
      assert.equal(code, 1, `HTTP ${status}인데 exit 0이면 대장 #204가 재발한다`);
      assert.match(stderr, /5xx/);
    });
  });
}

test('⭐ CLI: /health/readiness가 상태 목록에서 통째로 빠지면 exit 1(필수 라우트 누락)', () => {
  const content = statusFileWithoutRoute('/health/readiness');
  withTempFile(content, (file) => {
    const { code, stderr } = runCli(['--status-file', file]);
    assert.equal(code, 1);
    assert.match(stderr, /health\/readiness/);
  });
});

test('⭐ CLI: readiness가 HTTP 503이면 exit 1(DB 등 연결 이상 — terminus가 503을 낸다)', () => {
  const content = statusFileWithRouteOverride('/health/readiness', { status: 503, error: null });
  withTempFile(content, (file) => {
    const { code, stderr } = runCli(['--status-file', file]);
    assert.equal(code, 1);
    assert.match(stderr, /readiness/);
  });
});

test('⭐ CLI: readiness가 200인데 content-type이 text/html이면 exit 1(SPA 폴백 오염, 대장 #91형)', () => {
  const content = statusFileWithRouteOverride('/health/readiness', {
    status: 200,
    contentType: 'text/html; charset=utf-8',
  });
  withTempFile(content, (file) => {
    const { code, stderr } = runCli(['--status-file', file]);
    assert.equal(code, 1);
    assert.match(stderr, /JSON/);
  });
});

test('CLI: readiness에 contentType 필드가 없으면 content-type 판정을 생략하고 exit 0(舊 status-file 호환)', () => {
  const content = statusFileWithRouteOverride('/health/readiness', { contentType: undefined });
  withTempFile(content, (file) => {
    const { code, stdout } = runCli(['--status-file', file]);
    assert.equal(code, 0, stdout);
    assert.match(stdout, /판정: PASS/);
  });
});

test('CLI: --base-url/--status-file 둘 다 없으면 exit 1', () => {
  const { code, stderr } = runCli([]);
  assert.equal(code, 1);
  assert.match(stderr, /--base-url 또는 --status-file/);
});

test('CLI: 존재하지 않는 --status-file은 exit 1(요청 실패 취급)', () => {
  const { code, stderr } = runCli(['--status-file', '/no/such/file/on/purpose.json']);
  assert.equal(code, 1);
  assert.match(stderr, /상태 파일 로드 실패/);
});

test('CLI: 알 수 없는 인자는 exit 1', () => {
  const { code, stderr } = runCli(['--bogus']);
  assert.equal(code, 1);
  assert.match(stderr, /알 수 없는 인자/);
});

// ── ⭐ CLI 뮤테이션 실증 — 로컬 http 서버 왕복(외부망 불요) ────────────────────────
// 대장 #180이 스스로 적은 해소 판정 기준: "의도적으로 라우트를 빠뜨린 이미지를 배포했을 때
// 파이프라인이 red가 되는 것". 아래 두 테스트가 그것을 CLI 프로세스 수준에서 직접 재현한다.

test('⭐ CLI 뮤테이션: 정상 배포(5라우트 실재 + 음성 대조 404)는 --base-url로 exit 0', async () => {
  // resident-uploads/<random-id>는 매번 다른 경로라 프리픽스 매칭이 필요해 http.createServer
  // 콜백을 직접 구성한다. CLI는 반드시 `runCliAsync`(비동기)로 실행한다 — 위 헬퍼 주석 참조.
  const server = createServer((req, res) => {
    if (req.url === '/health/version') return res.writeHead(200).end();
    // readiness는 정확히 200 + JSON content-type이어야 통과(대장 #204) — 나머지처럼 빈 200이면
    // content-type 헤더가 없어 그 검사만 건너뛰지만, 여기서는 실제 운영 응답(JSON)을 재현한다.
    if (req.url === '/health/readiness') {
      return res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' }).end('{"status":"ok"}');
    }
    if (req.url === '/v1/feed') return res.writeHead(200).end();
    if (req.url === '/v1/contents') return res.writeHead(401).end();
    if (req.url.startsWith('/v1/resident-uploads/')) return res.writeHead(401).end();
    return res.writeHead(404).end(); // 음성 대조 포함 — 매핑 안 된 전부 404
  });
  const port = await listenAsync(server);
  try {
    const { code, stdout } = await runCliAsync(['--base-url', `http://127.0.0.1:${port}`]);
    assert.equal(code, 0, stdout);
    assert.match(stdout, /판정: PASS/);
  } finally {
    await closeAsync(server);
  }
});

test('⭐ CLI 뮤테이션 ①: resident-uploads 라우트가 빠진(404) 이미지를 배포하면 exit 1(대장 #180 재현)', async () => {
  const server = createServer((req, res) => {
    if (req.url === '/health/version') return res.writeHead(200).end();
    if (req.url === '/v1/feed') return res.writeHead(200).end();
    if (req.url === '/v1/contents') return res.writeHead(401).end();
    // resident-uploads 라우트를 빠뜨린 이미지 재현 — 어떤 경로든 404(catch-all이 없어서 404)
    return res.writeHead(404).end();
  });
  const port = await listenAsync(server);
  try {
    const { code, stderr } = await runCliAsync(['--base-url', `http://127.0.0.1:${port}`]);
    assert.equal(code, 1, 'resident-uploads가 404인데 exit 0이면 대장 #180이 재발한다');
    assert.match(stderr, /resident-uploads/);
  } finally {
    await closeAsync(server);
  }
});

test('⭐ CLI 뮤테이션 ②: 모든 경로에 200을 주는 서버(음성 대조 무력화)는 exit 1(거짓 통과 방지)', async () => {
  const server = createServer((_req, res) => {
    res.writeHead(200); // catch-all — 실재하지 않는 경로에도 200을 주는 고장난 라우터를 재현
    res.end();
  });
  const port = await listenAsync(server);
  try {
    const { code, stderr } = await runCliAsync(['--base-url', `http://127.0.0.1:${port}`]);
    assert.equal(code, 1, '음성 대조가 무력화됐는데 exit 0이면 "거짓 통과" 방지 요구가 깨진 것');
    assert.match(stderr, /판정 불능/);
  } finally {
    await closeAsync(server);
  }
});

test('CLI 뮤테이션 ③: 접속 자체가 실패(요청 실패)하면 exit 1', () => {
  // 로컬에서 아무도 듣지 않는 포트로 접속 시도 — ECONNREFUSED 재현
  const { code, stderr } = runCli(['--base-url', 'http://127.0.0.1:1', '--timeout-ms', '500']);
  assert.equal(code, 1);
  assert.match(stderr, /요청 실패/);
});

// ── ⭐ 대장 #169 — 미디어 도달성 축(`--media-base-url`) 배선 ────────────────────────

test('⭐ CLI: --media-base-url 미지정이면 미디어 검사 없이 건너뛴다(오늘의 build-images.yml 호출부와 무회귀)', () => {
  withTempFile(validStatusFileContent(), (file) => {
    const { code, stdout } = runCli(['--status-file', file]);
    assert.equal(code, 0, stdout);
    assert.match(stdout, /미디어 도달성 검사: 건너뜀/);
  });
});

test('⭐ CLI 뮤테이션 ④(대장 #169): 라우트가 전부 통과해도 미디어 URL이 사설/루프백 호스트면 exit 1', async () => {
  // 라우트 축(--base-url)과 미디어 축(--media-base-url)을 같은 로컬 서버로 함께 재현한다 —
  // 두 플래그가 독립적으로 동작함을 증명(값이 같아도, 달라도 무방하다는 설계 그대로).
  const server = createServer((req, res) => {
    if (req.url === '/health/version') return res.writeHead(200).end();
    if (req.url === '/health/readiness') {
      return res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' }).end('{"status":"ok"}');
    }
    if (req.url === '/v1/contents') return res.writeHead(401).end();
    if (req.url.startsWith('/v1/resident-uploads/')) return res.writeHead(401).end();
    if (req.url === '/v1/feed?limit=1') {
      return res
        .writeHead(200, { 'content-type': 'application/json' })
        .end(JSON.stringify({ items: [{ contentId: 'c1', thumbnailUrl: 'http://127.0.0.1:9/x.jpg' }] }));
    }
    if (req.url === '/v1/feed/c1/playback') {
      return res
        .writeHead(200, { 'content-type': 'application/json' })
        .end(JSON.stringify({ hlsUrl: 'http://127.0.0.1:9/x.mp4' }));
    }
    if (req.url === '/v1/feed') return res.writeHead(200).end(); // 라우트 스모크용(존재만 확인)
    return res.writeHead(404).end(); // 음성 대조 포함
  });
  const port = await listenAsync(server);
  try {
    const baseUrl = `http://127.0.0.1:${port}`;
    const { code, stdout, stderr } = await runCliAsync(['--base-url', baseUrl, '--media-base-url', baseUrl]);
    assert.equal(code, 1, '라우트는 전부 실재인데 미디어가 루프백 호스트면 exit 0이면 안 된다');
    assert.match(stdout + stderr, /loopback-host/);
  } finally {
    await closeAsync(server);
  }
});
