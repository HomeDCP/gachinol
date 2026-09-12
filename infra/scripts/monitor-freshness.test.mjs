// infra/scripts/monitor-freshness.test.mjs
// 의도(main HEAD) vs 실물 대조 판정(대장 #203, S3) 단위 테스트.
//
// ⭐ 핵심은 "규칙 5·6·7이 없으면 #165(Deploy Web 성공 0회)·#156·#161(CI 연속 실패 방치) 유형이
// 어느 분기로도 가지 않는다"는 것 — 아래 각 절이 8개 규칙 + 규칙 0(bad-sha)을 개별로 고정한다.
//
// ⚠️ 루트 `package.json`의 `test:scripts`에 이 파일을 등재해야 한다(daejang-recheck.test.mjs의
// self-check가 잊으면 레드로 잡는다).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import {
  isFullSha,
  normalizeRuns,
  normalizeJobs,
  judgeFreshness,
  probeRoutesWithRetry,
  DEPLOY_WORKFLOW_NAMES,
} from './monitor-freshness.mjs';
import { resolveDefaultRoutes } from './deploy-smoke.mjs';

const SCRIPT_PATH = fileURLToPath(new URL('./monitor-freshness.mjs', import.meta.url));

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);

// ── isFullSha ──────────────────────────────────────────────────────────────────────

test('isFullSha: 40자 소문자 hex는 true', () => {
  assert.equal(isFullSha(SHA_A), true);
});

test('isFullSha: 대문자 hex도 true(대소문자 무관)', () => {
  assert.equal(isFullSha(SHA_A.toUpperCase()), true);
});

test('⭐ isFullSha: 단축 SHA(7자)는 false — GitHub API가 조용히 0건을 주는 함정의 근본 원인', () => {
  assert.equal(isFullSha('9d2a9d8'), false);
});

test('isFullSha: 빈 문자열은 false', () => {
  assert.equal(isFullSha(''), false);
});

test('isFullSha: 40자이지만 비hex 문자가 섞이면 false', () => {
  assert.equal(isFullSha('g'.repeat(40)), false);
});

test('isFullSha: null/undefined는 false', () => {
  assert.equal(isFullSha(null), false);
  assert.equal(isFullSha(undefined), false);
});

test('isFullSha: 41자(너무 김)는 false', () => {
  assert.equal(isFullSha(`${SHA_A}a`), false);
});

// ── normalizeRuns ──────────────────────────────────────────────────────────────────

function rawRun(overrides) {
  return {
    id: 1,
    status: 'completed',
    conclusion: 'success',
    head_sha: SHA_A,
    created_at: '2026-09-07T00:00:00Z',
    html_url: 'https://github.com/HomeDCP/gachinol/actions/runs/1',
    name: 'Deploy Web',
    ...overrides,
  };
}

test('normalizeRuns: waiting 런과 배포 워크플로 completed 런을 각각 분류한다', () => {
  const raw = {
    workflow_runs: [
      rawRun({ id: 1, status: 'waiting', conclusion: null, name: 'Build Images' }),
      rawRun({ id: 2, status: 'completed', conclusion: 'success', name: 'Deploy Web' }),
    ],
  };
  const { waitingRuns, deployRuns, runsUnreachable } = normalizeRuns(raw, { nowMs: Date.parse('2026-09-07T01:00:00Z') });
  assert.equal(runsUnreachable, false);
  assert.equal(waitingRuns.length, 1);
  assert.equal(deployRuns.length, 1);
  assert.equal(waitingRuns[0].workflowName, 'Build Images');
  assert.equal(deployRuns[0].workflowName, 'Deploy Web');
});

test('⭐ normalizeRuns: DEPLOY_WORKFLOW_NAMES에 없는 워크플로(예: CI)는 deployRuns에서 제외한다(규칙 5 오탐 방지)', () => {
  const raw = {
    workflow_runs: [rawRun({ id: 1, status: 'completed', conclusion: 'failure', name: 'CI' })],
  };
  const { deployRuns } = normalizeRuns(raw, { nowMs: Date.now() });
  assert.equal(deployRuns.length, 0, 'CI 실패까지 배포 실패로 잡으면 PR마다 오탐이 난다');
});

test('normalizeRuns: DEPLOY_WORKFLOW_NAMES는 정확히 Build Images·Deploy Web 2종', () => {
  assert.deepEqual(DEPLOY_WORKFLOW_NAMES, ['Build Images', 'Deploy Web']);
});

test('⭐ normalizeRuns: gachinolFetchFailed 센티널 → runsUnreachable=true(규칙 7 입력)', () => {
  const { waitingRuns, deployRuns, runsUnreachable } = normalizeRuns({ gachinolFetchFailed: true }, { nowMs: Date.now() });
  assert.equal(runsUnreachable, true);
  assert.deepEqual(waitingRuns, []);
  assert.deepEqual(deployRuns, []);
});

test('⭐ normalizeRuns: workflow_runs가 배열이 아니면(형태 오염) runsUnreachable=true — 조용한 grace 폴백 금지', () => {
  assert.equal(normalizeRuns({}, { nowMs: Date.now() }).runsUnreachable, true);
  assert.equal(normalizeRuns({ workflow_runs: 'not-array' }, { nowMs: Date.now() }).runsUnreachable, true);
  assert.equal(normalizeRuns(null, { nowMs: Date.now() }).runsUnreachable, true);
});

test('normalizeRuns: 같은 id가 중복 수집돼도(예: waiting 필터+일반 목록 병합) 한 번만 센다', () => {
  const raw = {
    workflow_runs: [
      rawRun({ id: 7, status: 'waiting', name: 'Build Images' }),
      rawRun({ id: 7, status: 'waiting', name: 'Build Images' }),
    ],
  };
  const { waitingRuns } = normalizeRuns(raw, { nowMs: Date.now() });
  assert.equal(waitingRuns.length, 1);
});

test('normalizeRuns: ageHours는 created_at부터 nowMs까지의 시간을 시간 단위로 환산한다', () => {
  const raw = { workflow_runs: [rawRun({ id: 1, status: 'waiting', created_at: '2026-09-05T00:00:00Z' })] };
  const nowMs = Date.parse('2026-09-06T02:00:00Z'); // 26시간 뒤 — #202 실측치와 동형
  const { waitingRuns } = normalizeRuns(raw, { nowMs });
  assert.equal(Math.round(waitingRuns[0].ageHours), 26);
});

// ── normalizeJobs ──────────────────────────────────────────────────────────────────
// 스키마(대장 #203 S3 게이트② 수리 — `fetch-jobs` 스텝이 기록):
//   { jobs: [...], attemptedRunIds: string[], unreachableRunIds: string[] }
// 舊 스키마(순수 배열)는 "실패 신호 없음"으로 하위호환 처리한다(아래 별도 절).

const EMPTY_JOBS_INFO = { jobs: [], attemptedRunIds: [], unreachableRunIds: [], jobsFullyUnreachable: false, jobsPartiallyUnreachable: false };

function jobsFile(overrides) {
  return { jobs: [], attemptedRunIds: [], unreachableRunIds: [], ...overrides };
}

test('normalizeJobs: jobs 배열을 정규화하고 conclusion/runConclusion 기본값은 null', () => {
  const result = normalizeJobs(jobsFile({ jobs: [{ name: 'deploy' }, { name: 'build', conclusion: 'success', runConclusion: 'success' }] }));
  assert.deepEqual(result.jobs, [
    { name: 'deploy', conclusion: null, runConclusion: null },
    { name: 'build', conclusion: 'success', runConclusion: 'success' },
  ]);
  assert.equal(result.jobsFullyUnreachable, false);
  assert.equal(result.jobsPartiallyUnreachable, false);
});

test('normalizeJobs: 배열도 객체도 아니면(null/undefined/{}) 전부-빈 기본값 — 크래시 없음', () => {
  assert.deepEqual(normalizeJobs(null), EMPTY_JOBS_INFO);
  assert.deepEqual(normalizeJobs(undefined), EMPTY_JOBS_INFO);
  assert.deepEqual(normalizeJobs({}), EMPTY_JOBS_INFO);
});

test('normalizeJobs: jobs 항목 중 name이 문자열이 아닌 것은 걸러낸다', () => {
  const result = normalizeJobs(jobsFile({ jobs: [{ conclusion: 'success' }, { name: 42 }] }));
  assert.deepEqual(result.jobs, []);
});

test('normalizeJobs: 舊 스키마(순수 배열)는 하위호환 — jobs만 채우고 실패 신호는 없음(false)', () => {
  const result = normalizeJobs([{ name: 'deploy', conclusion: 'success', runConclusion: 'success' }]);
  assert.deepEqual(result.jobs, [{ name: 'deploy', conclusion: 'success', runConclusion: 'success' }]);
  assert.equal(result.jobsFullyUnreachable, false);
  assert.equal(result.jobsPartiallyUnreachable, false);
  assert.deepEqual(result.unreachableRunIds, []);
});

// ── normalizeJobs — ⭐ 전량/부분 실패 판정(대장 #203 S3 게이트② 반증분 수리 핵심) ─────────

test('⭐ normalizeJobs: 시도한 런 전부가 unreachableRunIds에 있으면 jobsFullyUnreachable=true', () => {
  const result = normalizeJobs(jobsFile({ attemptedRunIds: ['200', '201'], unreachableRunIds: ['200', '201'] }));
  assert.equal(result.jobsFullyUnreachable, true);
  assert.equal(result.jobsPartiallyUnreachable, false);
});

test('⭐ normalizeJobs: 시도한 런 중 일부만 unreachableRunIds에 있으면 jobsPartiallyUnreachable=true(전량 아님)', () => {
  const result = normalizeJobs(
    jobsFile({ jobs: [{ name: 'deploy', conclusion: 'success', runConclusion: 'success' }], attemptedRunIds: ['200', '201'], unreachableRunIds: ['201'] }),
  );
  assert.equal(result.jobsFullyUnreachable, false, '일부만 실패했는데 전량으로 판정하면 나머지 런의 정상 커버리지를 과장하는 FAIL을 낸다');
  assert.equal(result.jobsPartiallyUnreachable, true);
  assert.deepEqual(result.unreachableRunIds, ['201']);
});

test('normalizeJobs: unreachableRunIds가 비어 있으면(전량 성공) 둘 다 false', () => {
  const result = normalizeJobs(jobsFile({ attemptedRunIds: ['200', '201'], unreachableRunIds: [] }));
  assert.equal(result.jobsFullyUnreachable, false);
  assert.equal(result.jobsPartiallyUnreachable, false);
});

test('normalizeJobs: attemptedRunIds가 비어 있으면(매치된 배포 런 0건) unreachableRunIds가 있어도 신호 없음', () => {
  // fetch-jobs 스텝은 run_ids가 0건이면 애초에 attemptedRunIds도 채우지 않는다 — "확인할 게
  // 없음"과 "확인을 못 함"을 구분하는 것이 이 수리의 핵심이므로, attempted=0이면 unreachable이
  // 무엇이든(정상 산출물이라면 항상 []) 실패로 취급하지 않는다.
  const result = normalizeJobs(jobsFile({ attemptedRunIds: [], unreachableRunIds: ['999'] }));
  assert.equal(result.jobsFullyUnreachable, false);
  assert.equal(result.jobsPartiallyUnreachable, false);
});

test('normalizeJobs: unreachableRunIds에 attemptedRunIds 밖의 id가 섞여도(오염 입력) 교집합만 센다', () => {
  const result = normalizeJobs(jobsFile({ attemptedRunIds: ['200', '201'], unreachableRunIds: ['201', '999-not-attempted'] }));
  assert.equal(result.jobsFullyUnreachable, false, '실제로는 부분 실패인데 오염된 여분 id 때문에 전량으로 과대평가되면 안 된다');
  assert.equal(result.jobsPartiallyUnreachable, true);
  assert.deepEqual(result.unreachableRunIds, ['201']);
});

test('normalizeJobs: attemptedRunIds·unreachableRunIds가 숫자로 와도(JSON 원본은 GitHub run id가 숫자) 문자열로 캐스팅해 비교', () => {
  const result = normalizeJobs(jobsFile({ attemptedRunIds: [200, 201], unreachableRunIds: [201] }));
  assert.equal(result.jobsPartiallyUnreachable, true);
  assert.deepEqual(result.unreachableRunIds, ['201']);
});

// ── judgeFreshness: 공용 baseline ────────────────────────────────────────────────────

function baseInput(overrides = {}) {
  return {
    expectSha: SHA_A,
    apiSha: SHA_A,
    webSha: SHA_A,
    routeVerdict: null,
    headAgeHours: 0,
    staleHours: 2,
    waitingRuns: [],
    deployRuns: [],
    deployJobs: [],
    runsUnreachable: false,
    jobsFullyUnreachable: false,
    jobsPartiallyUnreachable: false,
    ...overrides,
  };
}

test('judgeFreshness: 전 축 일치 + 이상 없음 → PASS fresh', () => {
  const result = judgeFreshness(baseInput());
  assert.equal(result.ok, true);
  assert.equal(result.status, 'PASS');
  assert.equal(result.primaryCode, 'fresh');
  assert.deepEqual(result.failures, []);
});

// ── 규칙 0 — bad-sha (입력 검증 먼저) ─────────────────────────────────────────────────

test('⭐ judgeFreshness: expect가 단축 SHA면 다른 규칙보다 먼저 bad-sha로 FAIL', () => {
  const result = judgeFreshness(baseInput({ expectSha: '9d2a9d8' }));
  assert.equal(result.ok, false);
  assert.equal(result.primaryCode, 'bad-sha');
  assert.deepEqual(result.failures[0].fields, ['expect']);
});

test('judgeFreshness: expect가 빈 문자열이면 bad-sha', () => {
  const result = judgeFreshness(baseInput({ expectSha: '' }));
  assert.equal(result.primaryCode, 'bad-sha');
});

test('judgeFreshness: api SHA가 비hex(40자, g 포함)면 bad-sha', () => {
  const result = judgeFreshness(baseInput({ apiSha: 'g'.repeat(40) }));
  assert.equal(result.ok, false);
  assert.equal(result.primaryCode, 'bad-sha');
  assert.deepEqual(result.failures[0].fields, ['api']);
});

test('judgeFreshness: web SHA가 단축이면 bad-sha', () => {
  const result = judgeFreshness(baseInput({ webSha: 'abcdef1' }));
  assert.equal(result.primaryCode, 'bad-sha');
  assert.deepEqual(result.failures[0].fields, ['web']);
});

test('judgeFreshness: 여러 필드가 동시에 불량이면 fields에 전부 나열', () => {
  const result = judgeFreshness(baseInput({ expectSha: '', apiSha: null, webSha: SHA_A }));
  assert.deepEqual(result.failures[0].fields, ['expect', 'api']);
});

test('judgeFreshness: bad-sha면 라우트·대기런 등 다른 입력이 있어도 그 규칙들을 평가하지 않는다(short-circuit)', () => {
  const result = judgeFreshness(
    baseInput({
      expectSha: 'short',
      runsUnreachable: true, // 규칙 7도 참이지만 bad-sha가 먼저 이긴다
    }),
  );
  assert.equal(result.failures.length, 1);
  assert.equal(result.primaryCode, 'bad-sha');
});

// ── 규칙 1 — api-stale (경계값) ───────────────────────────────────────────────────────

test('judgeFreshness: api 불일치 + HEAD 나이가 STALE_HOURS 직전(1.999h)이면 아직 FAIL 아님(PASS deploying)', () => {
  const result = judgeFreshness(baseInput({ apiSha: SHA_B, headAgeHours: 1.999 }));
  assert.equal(result.ok, true);
  assert.equal(result.primaryCode, 'deploying');
});

test('⭐ judgeFreshness: api 불일치 + HEAD 나이가 STALE_HOURS 정각(2h)이면 FAIL api-stale(경계 포함)', () => {
  const result = judgeFreshness(baseInput({ apiSha: SHA_B, headAgeHours: 2 }));
  assert.equal(result.ok, false);
  assert.equal(result.primaryCode, 'api-stale');
});

test('judgeFreshness: api 불일치 + HEAD 나이가 STALE_HOURS 직후(2.001h)면 FAIL api-stale', () => {
  const result = judgeFreshness(baseInput({ apiSha: SHA_B, headAgeHours: 2.001 }));
  assert.equal(result.ok, false);
  assert.equal(result.primaryCode, 'api-stale');
});

test('judgeFreshness: api가 일치하면 나이가 아무리 많아도 api-stale이 뜨지 않는다', () => {
  const result = judgeFreshness(baseInput({ apiSha: SHA_A, headAgeHours: 1000 }));
  assert.equal(result.failures.some((f) => f.code === 'api-stale'), false);
});

// ── 규칙 2 — web-stale (경계값, api와 동형) + 한쪽만 스테일 ────────────────────────────

test('judgeFreshness: web 불일치 + STALE_HOURS 직전이면 FAIL 아님', () => {
  const result = judgeFreshness(baseInput({ webSha: SHA_B, headAgeHours: 1.999 }));
  assert.equal(result.ok, true);
  assert.equal(result.primaryCode, 'deploying');
});

test('⭐ judgeFreshness: web 불일치 + STALE_HOURS 정각이면 FAIL web-stale', () => {
  const result = judgeFreshness(baseInput({ webSha: SHA_B, headAgeHours: 2 }));
  assert.equal(result.ok, false);
  assert.equal(result.primaryCode, 'web-stale');
});

test('⭐ judgeFreshness: api만 스테일이면 api-stale만 뜨고 web-stale은 뜨지 않는다', () => {
  const result = judgeFreshness(baseInput({ apiSha: SHA_B, webSha: SHA_A, headAgeHours: 10 }));
  const codes = result.failures.map((f) => f.code);
  assert.deepEqual(codes, ['api-stale']);
});

test('⭐ judgeFreshness: web만 스테일이면 web-stale만 뜨고 api-stale은 뜨지 않는다', () => {
  const result = judgeFreshness(baseInput({ apiSha: SHA_A, webSha: SHA_B, headAgeHours: 10 }));
  const codes = result.failures.map((f) => f.code);
  assert.deepEqual(codes, ['web-stale']);
});

test('judgeFreshness: api·web 둘 다 스테일이면 둘 다 failures에 담긴다', () => {
  const result = judgeFreshness(baseInput({ apiSha: SHA_B, webSha: SHA_B, headAgeHours: 10 }));
  const codes = result.failures.map((f) => f.code);
  assert.deepEqual(codes, ['api-stale', 'web-stale']);
});

// ── 규칙 3 — route/readiness(judgeResults 재사용) ────────────────────────────────────

const ROUTE_VERDICT_OK = {
  ok: true,
  reason: '전 대상 라우트 실재 확인 + 음성 대조 정상',
  routeFailures: [],
  missingRequiredRoutes: [],
};

test('judgeFreshness: routeVerdict.ok=true면 규칙 3 실패 없음', () => {
  const result = judgeFreshness(baseInput({ routeVerdict: ROUTE_VERDICT_OK }));
  assert.equal(result.ok, true);
});

test('judgeFreshness: routeVerdict가 null(라우트 검사 생략)이어도 크래시 없이 통과', () => {
  const result = judgeFreshness(baseInput({ routeVerdict: null }));
  assert.equal(result.ok, true);
});

test('⭐ judgeFreshness: 라우트 부재(404)면 code=route', () => {
  const routeVerdict = {
    ok: false,
    reason: '라우트 실패 1건 (라우트 부재(404) 1건)',
    routeFailures: [{ path: '/v1/contents', status: 404, error: null, failureKind: 'route_missing' }],
    missingRequiredRoutes: [],
  };
  const result = judgeFreshness(baseInput({ routeVerdict }));
  assert.equal(result.ok, false);
  assert.equal(result.primaryCode, 'route');
});

test('⭐ judgeFreshness: 5xx(서버 오류)면 code=route(readiness 아님)', () => {
  const routeVerdict = {
    ok: false,
    reason: '라우트 실패 1건 (서버 오류(5xx) 1건)',
    routeFailures: [{ path: '/v1/feed', status: 500, error: null, failureKind: 'server_error' }],
    missingRequiredRoutes: [],
  };
  const result = judgeFreshness(baseInput({ routeVerdict }));
  assert.equal(result.primaryCode, 'route');
});

test('⭐ judgeFreshness: readiness 상태코드 이상이면 code=readiness(route와 구분)', () => {
  const routeVerdict = {
    ok: false,
    reason: '라우트 실패 1건 (readiness 상태코드 이상(200 아님) 1건)',
    routeFailures: [{ path: '/health/readiness', status: 503, error: null, failureKind: 'readiness_status' }],
    missingRequiredRoutes: [],
  };
  const result = judgeFreshness(baseInput({ routeVerdict }));
  assert.equal(result.primaryCode, 'readiness');
});

test('judgeFreshness: readiness content-type 이상이면 code=readiness', () => {
  const routeVerdict = {
    ok: false,
    reason: '라우트 실패 1건 (readiness content-type 이상(JSON 아님) 1건)',
    routeFailures: [{ path: '/health/readiness', status: 200, error: null, failureKind: 'readiness_content_type' }],
    missingRequiredRoutes: [],
  };
  const result = judgeFreshness(baseInput({ routeVerdict }));
  assert.equal(result.primaryCode, 'readiness');
});

test('judgeFreshness: 필수 라우트 목록 자체에 readiness가 없으면(missingRequiredRoutes) code=readiness', () => {
  const routeVerdict = {
    ok: false,
    reason: '필수 라우트 누락: /health/readiness',
    routeFailures: [],
    missingRequiredRoutes: ['/health/readiness'],
  };
  const result = judgeFreshness(baseInput({ routeVerdict }));
  assert.equal(result.primaryCode, 'readiness');
});

// ── 규칙 4/4' — 승인 대기 런 ───────────────────────────────────────────────────────────

test('⭐ judgeFreshness: waiting 런의 head_sha===expect이고 나이≥STALE_HOURS면 FAIL approval-stale(대장 #202 재현)', () => {
  const result = judgeFreshness(
    baseInput({ waitingRuns: [{ headSha: SHA_A, ageHours: 26, workflowName: 'Build Images', htmlUrl: 'https://x/1' }] }),
  );
  assert.equal(result.ok, false);
  assert.equal(result.primaryCode, 'approval-stale');
  assert.equal(result.failures[0].htmlUrl, 'https://x/1');
});

test('judgeFreshness: waiting 런의 head_sha===expect이지만 나이<STALE_HOURS면 아직 FAIL 아님', () => {
  const result = judgeFreshness(baseInput({ waitingRuns: [{ headSha: SHA_A, ageHours: 0.5, workflowName: 'Build Images' }] }));
  assert.equal(result.ok, true);
  assert.equal(result.warnings.length, 0);
});

test('⭐ judgeFreshness: waiting 런의 head_sha!==expect면 WARN만(FAIL 아님 — 뒤처진 런이 영구 FAIL을 만들지 않게)', () => {
  const result = judgeFreshness(
    baseInput({ waitingRuns: [{ headSha: SHA_B, ageHours: 100, workflowName: 'Deploy Web' }] }),
  );
  assert.equal(result.ok, true, '뒤처진 waiting 런은 WARN이지 FAIL이 아니어야 한다');
  assert.equal(result.warnings.length, 1);
  assert.equal(result.warnings[0].code, 'approval-behind');
});

test('judgeFreshness: waiting 런 여러 건이 섞이면 각각 독립 판정된다', () => {
  const result = judgeFreshness(
    baseInput({
      waitingRuns: [
        { headSha: SHA_A, ageHours: 26, workflowName: 'Build Images' },
        { headSha: SHA_A, ageHours: 26, workflowName: 'Deploy Web' },
        { headSha: SHA_B, ageHours: 5, workflowName: 'CI' },
      ],
    }),
  );
  assert.equal(result.failures.filter((f) => f.code === 'approval-stale').length, 2);
  assert.equal(result.warnings.length, 1);
});

// ── 규칙 5 — 배포 런 conclusion 실패류(4종 전수) ──────────────────────────────────────

for (const conclusion of ['failure', 'cancelled', 'timed_out', 'action_required']) {
  test(`⭐ judgeFreshness: 배포 런 conclusion=${conclusion}이면 FAIL deploy-failed(grace 무관)`, () => {
    const result = judgeFreshness(
      baseInput({
        headAgeHours: 0, // grace 무관임을 보이기 위해 일부러 STALE_HOURS 미만으로 둔다
        deployRuns: [{ headSha: SHA_A, conclusion, workflowName: 'Deploy Web', htmlUrl: 'https://x/run' }],
      }),
    );
    assert.equal(result.ok, false, `${conclusion}인데 통과하면 대장 #165/#156/#161 유형을 못 잡는다`);
    assert.equal(result.primaryCode, 'deploy-failed');
    assert.equal(result.failures[0].htmlUrl, 'https://x/run');
  });
}

test('judgeFreshness: 배포 런 conclusion=success면 규칙 5 발동 없음', () => {
  const result = judgeFreshness(baseInput({ deployRuns: [{ headSha: SHA_A, conclusion: 'success', workflowName: 'Deploy Web' }] }));
  assert.equal(result.ok, true);
});

test('judgeFreshness: 배포 런 conclusion=skipped/neutral은 규칙 5의 4종에 속하지 않아 발동 없음', () => {
  const result = judgeFreshness(
    baseInput({
      deployRuns: [
        { headSha: SHA_A, conclusion: 'skipped', workflowName: 'Deploy Web' },
        { headSha: SHA_A, conclusion: 'neutral', workflowName: 'Build Images' },
      ],
    }),
  );
  assert.equal(result.ok, true);
});

// ── 규칙 6 — success인데 deploy 잡 skipped ────────────────────────────────────────────

test('⭐ judgeFreshness: 런 success인데 deploy 잡이 skipped면 FAIL deploy-skipped(preflight 시크릿 소실 의심)', () => {
  const result = judgeFreshness(
    baseInput({ deployJobs: [{ name: 'deploy', conclusion: 'skipped', runConclusion: 'success' }] }),
  );
  assert.equal(result.ok, false);
  assert.equal(result.primaryCode, 'deploy-skipped');
});

test('judgeFreshness: deploy 잡이 success면 규칙 6 발동 없음', () => {
  const result = judgeFreshness(
    baseInput({ deployJobs: [{ name: 'deploy', conclusion: 'success', runConclusion: 'success' }] }),
  );
  assert.equal(result.ok, true);
});

test('judgeFreshness: skipped인 잡 이름이 deploy가 아니면(예: build) 규칙 6 발동 없음', () => {
  const result = judgeFreshness(
    baseInput({ deployJobs: [{ name: 'build', conclusion: 'skipped', runConclusion: 'success' }] }),
  );
  assert.equal(result.ok, true);
});

test('⭐ judgeFreshness: 실측 GitHub Jobs API 표시명("deploy (api·media-worker·ai-worker → 제온)")도 매치한다', () => {
  // 실측(2026-09-07, gh api .../actions/runs/<id>/jobs): 잡의 name 필드는 YAML 키 'deploy'가
  // 아니라 build-images.yml:170/deploy-web.yml:348의 커스텀 name: 표시값 그대로다. 정확히
  // 'deploy'와만 비교하면 이 규칙이 실제로는 영원히 발동하지 않는다(이 슬라이스가 막으려는
  // "선언은 있는데 구동은 없다" 패턴을 규칙 6 자신이 재생산할 뻔한 실측 버그).
  const result = judgeFreshness(
    baseInput({
      deployJobs: [
        { name: 'deploy (api·media-worker·ai-worker → 제온)', conclusion: 'skipped', runConclusion: 'success' },
      ],
    }),
  );
  assert.equal(result.ok, false, '실제 잡 표시명과 매치하지 못하면 규칙 6이 프로덕션에서 죽어 있는 것');
  assert.equal(result.primaryCode, 'deploy-skipped');
});

test('judgeFreshness: deploy-web.yml의 실측 표시명("deploy (정적 산출물 → 제온 web 컨테이너)")도 매치한다', () => {
  const result = judgeFreshness(
    baseInput({
      deployJobs: [{ name: 'deploy (정적 산출물 → 제온 web 컨테이너)', conclusion: 'skipped', runConclusion: 'success' }],
    }),
  );
  assert.equal(result.ok, false);
  assert.equal(result.primaryCode, 'deploy-skipped');
});

test('judgeFreshness: "deployment-status"처럼 deploy로 시작하지만 다른 단어인 잡 이름은 매치하지 않는다(오탐 방지)', () => {
  const result = judgeFreshness(
    baseInput({ deployJobs: [{ name: 'deployment-status', conclusion: 'skipped', runConclusion: 'success' }] }),
  );
  assert.equal(result.ok, true);
});

test('judgeFreshness: 런 자체가 success가 아니면(runConclusion=failure) deploy skipped여도 규칙 6은 발동 안 함(규칙 5가 별도로 잡을 몫)', () => {
  const result = judgeFreshness(
    baseInput({ deployJobs: [{ name: 'deploy', conclusion: 'skipped', runConclusion: 'failure' }] }),
  );
  assert.equal(result.ok, true);
});

// ── 규칙 6' — jobs 조회 자체 실패(대장 #203 S3 게이트②에서 반증된 舊 `|| one='[]'` 조용한 흡수 수리) ──

test('⭐ judgeFreshness: jobsFullyUnreachable=true면 FAIL jobs-unreachable(규칙 6이 이 틱에서 완전히 무력)', () => {
  const result = judgeFreshness(baseInput({ jobsFullyUnreachable: true }));
  assert.equal(result.ok, false);
  assert.equal(result.primaryCode, 'jobs-unreachable');
});

test('⭐ judgeFreshness: jobsPartiallyUnreachable=true면 WARN jobs-partial-unreachable(FAIL 아님)', () => {
  const result = judgeFreshness(baseInput({ jobsPartiallyUnreachable: true }));
  assert.equal(result.ok, true, '부분 실패는 나머지 런의 커버리지가 유지되므로 매 틱 FAIL로 올리면 오탐이 잦다(규칙 4\'와 동일 판단)');
  assert.equal(result.warnings.length, 1);
  assert.equal(result.warnings[0].code, 'jobs-partial-unreachable');
});

test('judgeFreshness: jobsFullyUnreachable=false·jobsPartiallyUnreachable=false(기본값)면 규칙 6\' 발동 없음', () => {
  const result = judgeFreshness(baseInput());
  assert.equal(result.ok, true);
  assert.equal(result.warnings.length, 0);
});

test('judgeFreshness: 다른 실패(예: deploy-skipped)와 jobsPartiallyUnreachable 경고가 동시에 있어도 failures/warnings 양쪽에 각각 담긴다', () => {
  const result = judgeFreshness(
    baseInput({
      deployJobs: [{ name: 'deploy', conclusion: 'skipped', runConclusion: 'success' }],
      jobsPartiallyUnreachable: true,
    }),
  );
  assert.equal(result.ok, false);
  assert.equal(result.primaryCode, 'deploy-skipped', '이미 확정 FAIL이 있으면 그 코드가 primaryCode를 유지한다(warnings는 부수정보)');
  assert.equal(result.warnings.some((w) => w.code === 'jobs-partial-unreachable'), true);
});

test('⭐ judgeFreshness: jobsFullyUnreachable=true가 jobsPartiallyUnreachable=true와 동시에 서도(정상 생산자는 상호배타적이지만) 전량이 우선해 FAIL', () => {
  const result = judgeFreshness(baseInput({ jobsFullyUnreachable: true, jobsPartiallyUnreachable: true }));
  assert.equal(result.ok, false);
  assert.equal(result.primaryCode, 'jobs-unreachable');
  assert.equal(result.warnings.some((w) => w.code === 'jobs-partial-unreachable'), false, '전량 실패로 확정되면 부분 실패 경고를 중복으로 얹지 않는다');
});

// ── 규칙 7 — GitHub API(runs) 호출 자체 실패 ──────────────────────────────────────────

test('⭐ judgeFreshness: runsUnreachable=true면 FAIL api-unreachable — 조용한 grace 폴백 금지', () => {
  const result = judgeFreshness(baseInput({ runsUnreachable: true }));
  assert.equal(result.ok, false);
  assert.equal(result.primaryCode, 'api-unreachable');
});

test('judgeFreshness: runsUnreachable과 다른 실패가 동시에 있으면 failures에 둘 다 담긴다', () => {
  const result = judgeFreshness(baseInput({ runsUnreachable: true, apiSha: SHA_B, headAgeHours: 10 }));
  const codes = result.failures.map((f) => f.code).sort();
  assert.deepEqual(codes, ['api-stale', 'api-unreachable'].sort());
});

// ── 규칙 8 — PASS deploying ───────────────────────────────────────────────────────────

test('judgeFreshness: 불일치가 있어도 다른 실패가 전혀 없고 나이<STALE_HOURS면 PASS deploying', () => {
  const result = judgeFreshness(baseInput({ apiSha: SHA_B, webSha: SHA_B, headAgeHours: 0.1, staleHours: 2 }));
  assert.equal(result.ok, true);
  assert.equal(result.status, 'PASS');
  assert.equal(result.primaryCode, 'deploying');
});

test('judgeFreshness: STALE_HOURS=0이면 어떤 불일치도 즉시 stale로 판정된다(경계 하한)', () => {
  const result = judgeFreshness(baseInput({ apiSha: SHA_B, headAgeHours: 0, staleHours: 0 }));
  assert.equal(result.ok, false);
  assert.equal(result.primaryCode, 'api-stale');
});

// ── ⭐ 규칙 9(대장 #169) — checkMediaReachability 재사용, grace 무관 즉시 실패 ─────────────

test('judgeFreshness: mediaVerdict가 없으면(null, 舊 호출부) 규칙 9는 관여하지 않는다(무회귀)', () => {
  const result = judgeFreshness(baseInput({ mediaVerdict: null }));
  assert.equal(result.ok, true);
  assert.equal(result.primaryCode, 'fresh');
});

test('⭐ judgeFreshness: mediaVerdict.ok=false면 headAgeHours=0이어도 즉시 FAIL media-unreachable(staleHours 무관 — 규칙 3과 동형)', () => {
  const mediaVerdict = {
    ok: false,
    reason: 'private-host: feed.thumbnailUrl(http://192.168.0.101:9000/x.jpg) 도달 불가 — [private-host, insecure-scheme] ...',
    warnings: [],
  };
  const result = judgeFreshness(baseInput({ headAgeHours: 0, staleHours: 2, mediaVerdict }));
  assert.equal(result.ok, false);
  assert.equal(result.primaryCode, 'media-unreachable');
  assert.match(result.reason, /private-host/);
});

test('judgeFreshness: mediaVerdict.ok=true인데 warnings가 있으면(예: empty-feed) FAIL은 아니고 전체 warnings로 승격된다(침묵 금지)', () => {
  const mediaVerdict = {
    ok: true,
    reason: 'published 콘텐츠 0건 — 검사할 미디어 URL이 없어 도달성 미검증',
    warnings: [{ code: 'empty-feed', message: 'published 콘텐츠 0건 — 검사할 미디어 URL이 없어 도달성 미검증' }],
  };
  const result = judgeFreshness(baseInput({ mediaVerdict }));
  assert.equal(result.ok, true);
  assert.ok(result.warnings.some((w) => w.code === 'empty-feed'));
  assert.match(result.reason, /empty-feed|검사할 미디어 URL이 없어/);
});

test('judgeFreshness: 미디어 실패 + 다른 축(api-stale) 실패가 동시에 있으면 failures 양쪽에 다 담긴다', () => {
  const mediaVerdict = { ok: false, reason: 'forbidden: playback.hlsUrl 도달 불가', warnings: [] };
  const result = judgeFreshness(
    baseInput({ apiSha: SHA_B, headAgeHours: 5, staleHours: 2, mediaVerdict }),
  );
  assert.equal(result.ok, false);
  const codes = result.failures.map((f) => f.code);
  assert.ok(codes.includes('api-stale'));
  assert.ok(codes.includes('media-unreachable'));
});

// ── probeRoutesWithRetry — 일시적 블립 내성(30초 후 1회 재프로브) ─────────────────────

function instantSleep() {
  return Promise.resolve();
}

// ⚠️ judgeResults는 필수 라우트 5종이 목록 자체에 없으면 그것만으로 ok=false를 낸다
// (findMissingRequiredRoutes) — 그래서 "재시도" 자체를 겨냥한 테스트는 5종을 전부 채운
// resolveDefaultRoutes()를 써야 한다(마지막 "필수 라우트 누락" 테스트만 일부러 예외).
const FULL_ROUTES = resolveDefaultRoutes(() => 'fixedid1234');
const READINESS_PATH = '/health/readiness';

function makeFetchImpl(statusByPath) {
  return async (url) => {
    if (url.includes('__smoke_absent__')) return { status: 404, headers: { get: () => null } };
    const path = new URL(url).pathname;
    const status = Object.prototype.hasOwnProperty.call(statusByPath, path) ? statusByPath[path] : 200;
    const contentType = path === READINESS_PATH ? 'application/json' : null;
    return { status, headers: { get: () => contentType } };
  };
}

test('probeRoutesWithRetry: 1차 판정이 전부 정상이면 재시도하지 않는다', async () => {
  const { verdict, retried } = await probeRoutesWithRetry({
    baseUrl: 'https://example.invalid',
    routes: FULL_ROUTES,
    absentPath: '/v1/__smoke_absent__x',
    fetchImpl: makeFetchImpl({}),
    sleepImpl: instantSleep,
  });
  assert.equal(retried, false);
  assert.equal(verdict.ok, true, verdict.reason);
});

test('⭐ probeRoutesWithRetry: 일시적 블립(1차 실패·2차 성공)이면 최종 ok=true(둘 다 실패해야 FAIL)', async () => {
  let versionCallCount = 0;
  const fetchImpl = async (url) => {
    if (url.includes('__smoke_absent__')) return { status: 404, headers: { get: () => null } };
    const path = new URL(url).pathname;
    if (path === '/health/version') {
      versionCallCount += 1;
      // 1차에서만 500(블립), 재시도(2차)에서는 200으로 회복.
      return versionCallCount === 1
        ? { status: 500, headers: { get: () => null } }
        : { status: 200, headers: { get: () => null } };
    }
    const contentType = path === READINESS_PATH ? 'application/json' : null;
    return { status: 200, headers: { get: () => contentType } };
  };
  const { verdict, retried } = await probeRoutesWithRetry({
    baseUrl: 'https://example.invalid',
    routes: FULL_ROUTES,
    absentPath: '/v1/__smoke_absent__x',
    fetchImpl,
    sleepImpl: instantSleep,
  });
  assert.equal(retried, true);
  assert.equal(verdict.ok, true, `일시적 블립인데 최종 FAIL이면 재프로브 내성이 없는 것: ${verdict.reason}`);
});

test('⭐ probeRoutesWithRetry: 1차·2차 모두 실패한 라우트는 최종 FAIL로 남는다', async () => {
  const { verdict, retried } = await probeRoutesWithRetry({
    baseUrl: 'https://example.invalid',
    routes: FULL_ROUTES,
    absentPath: '/v1/__smoke_absent__x',
    fetchImpl: makeFetchImpl({ '/health/version': 500 }),
    sleepImpl: instantSleep,
  });
  assert.equal(retried, true);
  assert.equal(verdict.ok, false, '지속 실패인데 통과하면 이 재시도 로직이 결함을 가린다');
  assert.equal(verdict.routeFailures.some((f) => f.path === '/health/version'), true);
});

test('probeRoutesWithRetry: 실패 원인이 필수 라우트 누락뿐이면(구성 문제) 재시도하지 않는다', async () => {
  const fetchImpl = async (url) =>
    url.includes('__smoke_absent__') ? { status: 404, headers: { get: () => null } } : { status: 200, headers: { get: () => 'application/json' } };
  let sleepCalled = false;
  const { verdict, retried } = await probeRoutesWithRetry({
    baseUrl: 'https://example.invalid',
    routes: ['/v1/feed'], // 필수 5종 중 4종이 누락된 상태 — 재시도로 해결 안 됨
    absentPath: '/v1/__smoke_absent__x',
    fetchImpl,
    sleepImpl: () => {
      sleepCalled = true;
      return instantSleep();
    },
  });
  assert.equal(retried, false);
  assert.equal(verdict.ok, false);
  assert.equal(sleepCalled, false, '재시도가 무의미한 상황에서 30초 지연을 또 기다리면 안 된다');
});

// ── CLI 헬퍀 (deploy-smoke.test.mjs와 동형) ────────────────────────────────────────────

// ⚠️ 함정(실측): `run(dir)`이 비동기(Promise 반환)인데 이 헬퍼가 그 완료를 `await`하지 않으면
// `finally`의 `rmSync`가 콜백 본문이 실제로 파일을 읽기도 전에 임시 디렉터리를 지워버린다
// (deploy-smoke.test.mjs의 `withTempFile`은 동기 콜백만 받아서 이 문제가 없었다 — 여기서는
// `runCliAsync`를 쓰므로 반드시 `await`해야 한다).
async function withTempDir(run) {
  const dir = mkdtempSync(join(tmpdir(), 'monitor-freshness-'));
  try {
    return await run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

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

// ── CLI — 필수 인자 누락 ────────────────────────────────────────────────────────────

test('CLI: --expect 누락이면 exit 1', async () => {
  const { code, stderr } = await runCliAsync(['--api-url', 'http://x', '--web-url', 'http://y', '--runs-file', 'x.json', '--head-age-hours', '0']);
  assert.equal(code, 1);
  assert.match(stderr, /필수 인자 누락/);
});

test('CLI: --runs-file 누락이면 exit 1', async () => {
  const { code, stderr } = await runCliAsync(['--expect', SHA_A, '--api-url', 'http://x', '--web-url', 'http://y', '--head-age-hours', '0']);
  assert.equal(code, 1);
  assert.match(stderr, /필수 인자 누락/);
});

test('CLI: 알 수 없는 인자는 exit 1', async () => {
  const { code, stderr } = await runCliAsync(['--nope', '1']);
  assert.equal(code, 1);
  assert.match(stderr, /알 수 없는 인자/);
});

// ── CLI — ⭐ 입력 파싱 실패 exit 1 ─────────────────────────────────────────────────────

test('⭐ CLI: --runs-file이 유효한 JSON이 아니면 exit 1(판정까지 가지 않는다)', async () => {
  await withTempDir(async (dir) => {
    const runsFile = join(dir, 'runs.json');
    writeFileSync(runsFile, 'not json', 'utf8');
    const { code, stderr } = await runCliAsync([
      '--expect', SHA_A,
      '--api-url', 'http://127.0.0.1:1', // 도달 불필요 — runs-file 파싱 단계에서 먼저 죽는다
      '--web-url', 'http://127.0.0.1:1',
      '--head-age-hours', '0',
      '--runs-file', runsFile,
    ]);
    assert.equal(code, 1);
    assert.match(stderr, /--runs-file 로드 실패/);
  });
});

test('⭐ CLI: --jobs-file이 유효한 JSON이 아니면 exit 1', async () => {
  await withTempDir(async (dir) => {
    const runsFile = join(dir, 'runs.json');
    const jobsFile = join(dir, 'jobs.json');
    writeFileSync(runsFile, JSON.stringify({ workflow_runs: [] }), 'utf8');
    writeFileSync(jobsFile, '{not valid', 'utf8');
    const { code, stderr } = await runCliAsync([
      '--expect', SHA_A,
      '--api-url', 'http://127.0.0.1:1',
      '--web-url', 'http://127.0.0.1:1',
      '--head-age-hours', '0',
      '--runs-file', runsFile,
      '--jobs-file', jobsFile,
    ]);
    assert.equal(code, 1);
    assert.match(stderr, /--jobs-file 로드 실패/);
  });
});

test('CLI: --stale-hours가 숫자가 아니면 exit 1', async () => {
  await withTempDir(async (dir) => {
    const runsFile = join(dir, 'runs.json');
    writeFileSync(runsFile, JSON.stringify({ workflow_runs: [] }), 'utf8');
    const { code, stderr } = await runCliAsync([
      '--expect', SHA_A,
      '--api-url', 'http://127.0.0.1:1',
      '--web-url', 'http://127.0.0.1:1',
      '--head-age-hours', '0',
      '--runs-file', runsFile,
      '--stale-hours', 'abc',
    ]);
    assert.equal(code, 1);
    assert.match(stderr, /잘못된 --stale-hours/);
  });
});

// ── CLI — 종단 간(로컬 http 서버, 실제 네트워크 없이 전체 배선 검증) ───────────────────

function createApiServer(sha) {
  return createServer((req, res) => {
    const url = req.url ?? '';
    if (url === '/health/version') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ sha }));
      return;
    }
    if (url === '/health/readiness') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }
    // ⭐ 대장 #169 — checkMediaReachability가 규칙 9로 항상 이 경로를 실제로 친다(`--api-url` 재사용,
    // 워크플로 무변경으로 실동작하는 것과 동형으로 이 종단 테스트에서도 실제 네트워크 왕복시킨다).
    // 빈 피드(items:[])로 응답 — emptyFeed는 ok:true(경고만 추가)라 기존 5개 CLI 종단 테스트의
    // exit code 기대값을 하나도 건드리지 않는다(라우트/SHA/jobs 축과 독립적인 축이라는 설계 증명).
    if (url === '/v1/feed?limit=1') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ items: [] }));
      return;
    }
    if (url === '/v1/feed' || url === '/v1/contents' || url.startsWith('/v1/resident-uploads/')) {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ message: 'unauthorized' }));
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ message: 'not found' }));
  });
}

function createWebServer(sha) {
  return createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><html><head><meta name="build-sha" content="${sha}"></head><body></body></html>`);
  });
}

test('⭐ CLI 종단: SHA·라우트·readiness 전부 일치하면 exit 0(판정: PASS fresh) — 실제 네트워크 왕복', async () => {
  const apiServer = createApiServer(SHA_A);
  const webServer = createWebServer(SHA_A);
  const apiPort = await listenAsync(apiServer);
  const webPort = await listenAsync(webServer);
  try {
    await withTempDir(async (dir) => {
      const runsFile = join(dir, 'runs.json');
      writeFileSync(runsFile, JSON.stringify({ workflow_runs: [] }), 'utf8');
      const { code, stdout } = await runCliAsync([
        '--expect', SHA_A,
        '--api-url', `http://127.0.0.1:${apiPort}`,
        '--web-url', `http://127.0.0.1:${webPort}/`,
        '--head-age-hours', '0',
        '--runs-file', runsFile,
      ]);
      assert.equal(code, 0, stdout);
      assert.match(stdout, /PASS \(fresh\)/);
    });
  } finally {
    await closeAsync(apiServer);
    await closeAsync(webServer);
  }
});

test('⭐ CLI 종단: SHA 불일치 + HEAD 나이 초과면 exit 1(판정: FAIL api-stale/web-stale)', async () => {
  const apiServer = createApiServer(SHA_B); // 서빙 SHA가 expect(SHA_A)와 다름
  const webServer = createWebServer(SHA_B);
  const apiPort = await listenAsync(apiServer);
  const webPort = await listenAsync(webServer);
  try {
    await withTempDir(async (dir) => {
      const runsFile = join(dir, 'runs.json');
      writeFileSync(runsFile, JSON.stringify({ workflow_runs: [] }), 'utf8');
      const { code, stdout } = await runCliAsync([
        '--expect', SHA_A,
        '--api-url', `http://127.0.0.1:${apiPort}`,
        '--web-url', `http://127.0.0.1:${webPort}/`,
        '--head-age-hours', '100',
        '--stale-hours', '2',
        '--runs-file', runsFile,
      ]);
      assert.equal(code, 1);
      // ⚠️ ok=false일 때 한 줄 요약은 stderr로 간다(deploy-smoke.mjs printResults와 동형 관례) —
      // JSON 본문은 성공/실패 무관하게 항상 stdout으로 가므로 그쪽에서 primaryCode를 확인한다.
      assert.match(stdout, /"primaryCode": "api-stale"/);
    });
  } finally {
    await closeAsync(apiServer);
    await closeAsync(webServer);
  }
});

test('CLI 종단: --runs-file에 gachinolFetchFailed 센티널이면 exit 1(판정: FAIL api-unreachable)', async () => {
  const apiServer = createApiServer(SHA_A);
  const webServer = createWebServer(SHA_A);
  const apiPort = await listenAsync(apiServer);
  const webPort = await listenAsync(webServer);
  try {
    await withTempDir(async (dir) => {
      const runsFile = join(dir, 'runs.json');
      writeFileSync(runsFile, JSON.stringify({ gachinolFetchFailed: true }), 'utf8');
      const { code, stdout } = await runCliAsync([
        '--expect', SHA_A,
        '--api-url', `http://127.0.0.1:${apiPort}`,
        '--web-url', `http://127.0.0.1:${webPort}/`,
        '--head-age-hours', '0',
        '--runs-file', runsFile,
      ]);
      assert.equal(code, 1);
      assert.match(stdout, /"primaryCode": "api-unreachable"/);
    });
  } finally {
    await closeAsync(apiServer);
    await closeAsync(webServer);
  }
});

// ── CLI 종단 — ⭐ --jobs-file 전량/부분 실패(대장 #203 S3 게이트② 반증분 수리, fetch-jobs 산출물 스키마 그대로) ──

test('⭐ CLI 종단: --jobs-file이 전량 unreachable이면 exit 1(판정: FAIL jobs-unreachable) — 조용한 grace 폴백 금지', async () => {
  const apiServer = createApiServer(SHA_A);
  const webServer = createWebServer(SHA_A);
  const apiPort = await listenAsync(apiServer);
  const webPort = await listenAsync(webServer);
  try {
    await withTempDir(async (dir) => {
      const runsFile = join(dir, 'runs.json');
      const jobsFile = join(dir, 'jobs.json');
      writeFileSync(runsFile, JSON.stringify({ workflow_runs: [] }), 'utf8');
      // fetch-jobs 스텝이 매치된 배포 런 2건 모두 jobs API 호출에 실패했을 때 남기는 정확한 산출물 형태.
      writeFileSync(jobsFile, JSON.stringify({ jobs: [], attemptedRunIds: ['200', '201'], unreachableRunIds: ['200', '201'] }), 'utf8');
      const { code, stdout } = await runCliAsync([
        '--expect', SHA_A,
        '--api-url', `http://127.0.0.1:${apiPort}`,
        '--web-url', `http://127.0.0.1:${webPort}/`,
        '--head-age-hours', '0',
        '--runs-file', runsFile,
        '--jobs-file', jobsFile,
      ]);
      assert.equal(code, 1, 'jobs 조회가 전량 실패했는데 exit 0이면 이 수리가 다시 조용한 폴백으로 되돌아간 것');
      assert.match(stdout, /"primaryCode": "jobs-unreachable"/);
    });
  } finally {
    await closeAsync(apiServer);
    await closeAsync(webServer);
  }
});

test('⭐ CLI 종단: --jobs-file이 부분 unreachable이면 exit 0(판정: PASS, WARN jobs-partial-unreachable 동봉) — FAIL 아님', async () => {
  const apiServer = createApiServer(SHA_A);
  const webServer = createWebServer(SHA_A);
  const apiPort = await listenAsync(apiServer);
  const webPort = await listenAsync(webServer);
  try {
    await withTempDir(async (dir) => {
      const runsFile = join(dir, 'runs.json');
      const jobsFile = join(dir, 'jobs.json');
      writeFileSync(runsFile, JSON.stringify({ workflow_runs: [] }), 'utf8');
      // run 200은 성공적으로 조회됐고(정상 deploy 잡) run 201만 jobs API 호출 실패.
      writeFileSync(
        jobsFile,
        JSON.stringify({
          jobs: [{ name: 'deploy', conclusion: 'success', runConclusion: 'success' }],
          attemptedRunIds: ['200', '201'],
          unreachableRunIds: ['201'],
        }),
        'utf8',
      );
      const { code, stdout } = await runCliAsync([
        '--expect', SHA_A,
        '--api-url', `http://127.0.0.1:${apiPort}`,
        '--web-url', `http://127.0.0.1:${webPort}/`,
        '--head-age-hours', '0',
        '--runs-file', runsFile,
        '--jobs-file', jobsFile,
      ]);
      assert.equal(code, 0, stdout);
      assert.match(stdout, /"primaryCode": "fresh"/);
      assert.match(stdout, /jobs-partial-unreachable/);
    });
  } finally {
    await closeAsync(apiServer);
    await closeAsync(webServer);
  }
});

test('⭐ CLI 종단(대장 #169): 라우트·SHA·jobs 전부 정상이어도 미디어 URL이 사설 호스트면 exit 1(판정: FAIL media-unreachable)', async () => {
  // createApiServer를 그대로 쓰지 않는다 — 이 테스트만 /v1/feed?limit=1이 사설 IP를 가리키는
  // 피드 항목을 내줘야 한다(대장 #169 실물 재현). 나머지 라우트는 정상(createApiServer와 동형).
  const apiServer = createServer((req, res) => {
    const url = req.url ?? '';
    if (url === '/health/version') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ sha: SHA_A }));
      return;
    }
    if (url === '/health/readiness') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }
    if (url === '/v1/feed?limit=1') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({ items: [{ contentId: 'c1', thumbnailUrl: 'http://192.168.0.101:9000/x.jpg' }] }),
      );
      return;
    }
    if (url === '/v1/feed/c1/playback') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ hlsUrl: 'http://192.168.0.101:9000/720p.mp4' }));
      return;
    }
    if (url === '/v1/feed' || url === '/v1/contents' || url.startsWith('/v1/resident-uploads/')) {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ message: 'unauthorized' }));
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ message: 'not found' }));
  });
  const webServer = createWebServer(SHA_A);
  const apiPort = await listenAsync(apiServer);
  const webPort = await listenAsync(webServer);
  try {
    await withTempDir(async (dir) => {
      const runsFile = join(dir, 'runs.json');
      writeFileSync(runsFile, JSON.stringify({ workflow_runs: [] }), 'utf8');
      const { code, stdout } = await runCliAsync([
        '--expect', SHA_A,
        '--api-url', `http://127.0.0.1:${apiPort}`,
        '--web-url', `http://127.0.0.1:${webPort}/`,
        '--head-age-hours', '0',
        '--runs-file', runsFile,
      ]);
      assert.equal(code, 1, stdout);
      assert.match(stdout, /"primaryCode": "media-unreachable"/);
      assert.match(stdout, /private-host/);
      assert.match(stdout, /insecure-scheme/);
    });
  } finally {
    await closeAsync(apiServer);
    await closeAsync(webServer);
  }
});

// ── `.github/workflows/monitor.yml`의 fetch-jobs 스텝(bash) 자체를 실행해 검증 ─────────────
// 위 CLI 테스트들은 monitor-freshness.mjs(소비측)만 검증한다 — jobs.json을 **실제로 만드는**
// bash 스텝 자체의 실패 처리(개별 run의 `gh api .../jobs` 실패를 대칭적으로 기록하는지)는
// 여기서만 검증된다(대장 #203 S3 게이트②가 지적한 커버리지 0 구간). 파일을 복사해 사본을
// 테스트하지 않는다 — monitor.yml에서 매번 그대로 추출해서 실행한다(사본과 원본이 갈라지는
// 사고를 구조적으로 차단).
//
// ⚠️ PyYAML 대신 Node 문자열 파싱으로 추출한다(신규 의존성 0 — 이 리포에는 YAML 파서가 없고
// 여기서 새로 추가하지 않는다). YAML 블록 스칼라(`run: |`)의 들여쓰기 규칙만 이용하는 좁은
// 목적의 추출기이며, PyYAML(`yaml.safe_load(...)['jobs']['monitor']['steps']`)로 뽑은 것과
// 바이트 단위로 동일함을 게이트①에서 별도 확인했다(트레일링 개행 1줄 차이 제외 — 문법 무관).
//
// ⚠️ bash 3.2(macOS 기본 `/bin/bash`)에는 `mapfile` 내장 명령이 없다(bash≥4 전용). 이 저장소의
// CI는 ubuntu-latest(bash 5)라 실제 운영 경로는 문제없지만, 로컬 개발 macOS에서도 이 테스트가
// 똑같이 통과해야 하므로 `mapfile`을 셸 함수로 셔밍한다. bash는 별칭→함수→내장→외부명령 순으로
// 명령을 찾으므로 이 함수는 bash≥4의 진짜 mapfile 내장이 있어도 항상 먼저 잡힌다 — 즉 로컬(3.2)과
// CI(5.x) 양쪽에서 **동일한 셔밍된 구현**으로 통일해서 돈다는 뜻이다. 이 스텝이 실제로 쓰는
// 유일한 형태(`mapfile -t var < <(...)`, 줄 단위로 배열 채우기)만 지원한다.
//
// ⚠️ 실 `jq` 바이너리에 의존한다(fetch-jobs 스텝 자체가 그렇다 — 이 리포의 다른 게이트도 동일
// 전제다). `gh`만 테스트 전용 fake로 대체한다.

const WORKFLOW_YAML_PATH = fileURLToPath(new URL('../../.github/workflows/monitor.yml', import.meta.url));

function extractWorkflowRunBlock(yamlText, stepId) {
  const lines = yamlText.split('\n');
  const idLineIdx = lines.findIndex((l) => l.trim() === `id: ${stepId}`);
  if (idLineIdx === -1) throw new Error(`step id를 찾을 수 없음: ${stepId}`);

  let stepStartIdx = idLineIdx;
  while (stepStartIdx >= 0 && !/^\s*- name:/.test(lines[stepStartIdx])) stepStartIdx -= 1;
  if (stepStartIdx < 0) throw new Error(`step 시작(- name:)을 찾을 수 없음: ${stepId}`);
  const stepIndent = lines[stepStartIdx].match(/^(\s*)/)[1].length;

  let runLineIdx = idLineIdx;
  while (runLineIdx < lines.length && !/^\s*run:\s*\|/.test(lines[runLineIdx])) runLineIdx += 1;
  if (runLineIdx >= lines.length) throw new Error(`run 블록(run: |)을 찾을 수 없음: ${stepId}`);

  const bodyLines = [];
  for (let i = runLineIdx + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === '') {
      bodyLines.push('');
      continue;
    }
    const indent = line.match(/^(\s*)/)[1].length;
    if (indent <= stepIndent) break;
    bodyLines.push(line);
  }

  const nonBlank = bodyLines.filter((l) => l.trim() !== '');
  if (nonBlank.length === 0) throw new Error(`run 블록 본문이 비어 있음: ${stepId}`);
  const minIndent = Math.min(...nonBlank.map((l) => l.match(/^(\s*)/)[1].length));
  return bodyLines.map((l) => (l.length >= minIndent ? l.slice(minIndent) : l)).join('\n');
}

const MAPFILE_SHIM = `
mapfile() {
  local flag="$1" name="$2" line quoted
  if [ "$flag" != "-t" ]; then
    echo "mapfile shim: unsupported flags: $*" >&2
    return 1
  fi
  eval "$name=()"
  while IFS= read -r line; do
    printf -v quoted '%q' "$line"
    eval "$name+=($quoted)"
  done
}
`;

function withTempDirSync(run) {
  const dir = mkdtempSync(join(tmpdir(), 'monitor-fetch-jobs-'));
  try {
    return run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * `monitor.yml`의 `fetch-jobs` 스텝을 그대로 추출해 fake `gh`와 함께 실행한다.
 * @param {{ ghScript: string, runsWorkflowRuns: object[] }} opts
 * @returns {{ code: number, stdout: string, stderr: string, jobsJson: unknown }}
 */
function runFetchJobsStep({ ghScript, runsWorkflowRuns }) {
  const stepScript = extractWorkflowRunBlock(readFileSync(WORKFLOW_YAML_PATH, 'utf8'), 'fetch-jobs');
  return withTempDirSync((dir) => {
    const binDir = join(dir, 'bin');
    mkdirSync(binDir, { recursive: true });
    const ghPath = join(binDir, 'gh');
    writeFileSync(ghPath, ghScript, 'utf8');
    chmodSync(ghPath, 0o755);
    writeFileSync(join(dir, 'runs.json'), JSON.stringify({ workflow_runs: runsWorkflowRuns }), 'utf8');

    const env = {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH}`,
      REPO: 'HomeDCP/gachinol',
      EXPECT_SHA: SHA_A,
      GH_TOKEN: 'fake-token-for-test-only',
    };

    // spawnSync(execFileSync 대신): 성공/실패 어느 쪽이든 stdout·stderr를 균일하게 캡처한다
    // (execFileSync는 성공 시 stderr를 부모 프로세스로 그대로 통과시켜 버려 테스트 로그가
    // fake gh의 stderr로 오염되고, 성공 경로에서는 stderr를 assert할 수도 없다).
    const proc = spawnSync('bash', ['-c', MAPFILE_SHIM + stepScript], { cwd: dir, env, encoding: 'utf8' });
    const code = proc.status ?? 1;
    const stdout = proc.stdout ?? '';
    const stderr = proc.stderr ?? '';
    const jobsJson = JSON.parse(readFileSync(join(dir, 'jobs.json'), 'utf8'));
    return { code, stdout, stderr, jobsJson };
  });
}

function runConclusionOf(id, name, headSha, conclusion) {
  return { id, status: 'completed', conclusion, head_sha: headSha, name, html_url: `https://x/${id}` };
}

const GH_FAIL_RUN_201 = `#!/usr/bin/env bash
if [[ "$1" == "api" && "$2" == *"/actions/runs/201/jobs" ]]; then
  echo "simulated jobs api failure for run 201" >&2
  exit 1
fi
if [[ "$1" == "api" && "$2" == *"/actions/runs/200/jobs" ]]; then
  echo '{"jobs":[{"name":"deploy (api·media-worker·ai-worker → 제온)","conclusion":"success"}]}'
  exit 0
fi
echo "fake gh: unhandled args: $*" >&2
exit 99
`;

const GH_FAIL_ALL = `#!/usr/bin/env bash
if [[ "$1" == "api" && "$2" == *"/actions/runs/"*"/jobs" ]]; then
  echo "simulated jobs api failure (all)" >&2
  exit 1
fi
echo "fake gh: unhandled args: $*" >&2
exit 99
`;

const GH_SUCCEED_ALL = `#!/usr/bin/env bash
if [[ "$1" == "api" && "$2" == *"/actions/runs/200/jobs" ]]; then
  echo '{"jobs":[{"name":"deploy (api·media-worker·ai-worker → 제온)","conclusion":"success"}]}'
  exit 0
fi
if [[ "$1" == "api" && "$2" == *"/actions/runs/201/jobs" ]]; then
  echo '{"jobs":[{"name":"deploy (정적 산출물 → 제온 web 컨테이너)","conclusion":"success"}]}'
  exit 0
fi
echo "fake gh: unhandled args: $*" >&2
exit 99
`;

const TWO_DEPLOY_RUNS = [
  runConclusionOf(200, 'Build Images', SHA_A, 'success'),
  runConclusionOf(201, 'Deploy Web', SHA_A, 'success'),
];

test('⭐ fetch-jobs 스텝(bash): 매치된 배포 런 중 1건만 jobs 조회 실패 — 그 run_id만 unreachableRunIds에 남고 나머지는 정상 수집(부분 실패, 게이트② 반증분 재현 시나리오)', () => {
  const { code, stderr, jobsJson } = runFetchJobsStep({ ghScript: GH_FAIL_RUN_201, runsWorkflowRuns: TWO_DEPLOY_RUNS });
  assert.equal(code, 0, '개별 run의 jobs 조회 실패가 스텝 전체를 죽이면 안 된다(judge 스텝까지 도달시켜야 함 — fetch-runs와 동형)');
  assert.deepEqual(jobsJson.attemptedRunIds.sort(), ['200', '201']);
  assert.deepEqual(jobsJson.unreachableRunIds, ['201']);
  assert.equal(jobsJson.jobs.length, 1, 'run 200(성공)의 잡은 남아 있어야 한다');
  assert.equal(jobsJson.jobs[0].name, 'deploy (api·media-worker·ai-worker → 제온)');
  assert.match(stderr, /::warning::gachinol jobs fetch failed for run 201/, '실패가 GH Actions 로그에도 보여야 한다(침묵 금지)');
});

test('⭐ fetch-jobs 스텝(bash): 매치된 배포 런 전부의 jobs 조회가 실패하면 jobs=[]·unreachableRunIds=attemptedRunIds 전부(전량 실패가 "확인할 게 없음"과 구분됨)', () => {
  const { code, jobsJson } = runFetchJobsStep({ ghScript: GH_FAIL_ALL, runsWorkflowRuns: TWO_DEPLOY_RUNS });
  assert.equal(code, 0);
  assert.deepEqual(jobsJson.jobs, []);
  assert.deepEqual(jobsJson.attemptedRunIds.sort(), ['200', '201']);
  assert.deepEqual(jobsJson.unreachableRunIds.sort(), ['200', '201']);
});

test('fetch-jobs 스텝(bash): 전부 성공하면(회귀 없음) unreachableRunIds=[]·jobs에 두 런 모두 담긴다', () => {
  const { code, jobsJson } = runFetchJobsStep({ ghScript: GH_SUCCEED_ALL, runsWorkflowRuns: TWO_DEPLOY_RUNS });
  assert.equal(code, 0);
  assert.deepEqual(jobsJson.unreachableRunIds, []);
  assert.equal(jobsJson.jobs.length, 2);
});

test('fetch-jobs 스텝(bash): 매치되는 배포 런이 0건이면(다른 이름/다른 SHA) attemptedRunIds도 []("확인할 게 없음"과 "확인 못 함"의 경계)', () => {
  const { code, jobsJson } = runFetchJobsStep({
    ghScript: GH_SUCCEED_ALL,
    runsWorkflowRuns: [runConclusionOf(999, 'CI', SHA_A, 'success')],
  });
  assert.equal(code, 0);
  assert.deepEqual(jobsJson, { jobs: [], attemptedRunIds: [], unreachableRunIds: [] });
});

test('fetch-jobs 스텝(bash) → 실제 monitor-freshness.mjs 판정까지 종단(전량 실패 시나리오가 정말 FAIL로 이어지는지)', () => {
  const { jobsJson } = runFetchJobsStep({ ghScript: GH_FAIL_ALL, runsWorkflowRuns: TWO_DEPLOY_RUNS });
  const normalized = normalizeJobs(jobsJson);
  assert.equal(normalized.jobsFullyUnreachable, true);
  const verdict = judgeFreshness({
    expectSha: SHA_A,
    apiSha: SHA_A,
    webSha: SHA_A,
    headAgeHours: 0,
    staleHours: 2,
    deployJobs: normalized.jobs,
    jobsFullyUnreachable: normalized.jobsFullyUnreachable,
    jobsPartiallyUnreachable: normalized.jobsPartiallyUnreachable,
  });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.primaryCode, 'jobs-unreachable');
});
