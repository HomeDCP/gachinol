#!/usr/bin/env node
/**
 * infra/scripts/monitor-freshness.mjs
 *
 * 의도(main HEAD) vs 실물(서빙 SHA·라우트·readiness·배포 파이프라인 상태) 대조 — 대장 #203, S3.
 * `.github/workflows/monitor.yml`이 15분마다(정각 회피) 이 스크립트를 호출하고, 결과를 집 밖
 * 하트비트 수신기(Healthchecks.io)에 성공/실패로 보고한다.
 *
 * ── 왜 있는가 (docs/plan/exec/ROOT-CAUSE-MONITORING-2026-09.md) ──────────────────────
 * 자동 검사는 "PR·머지 순간"과 "배포 직후 1회"에만 존재했고, 그 뒤 시간축 위에는 아무도 없었다
 * (#170 이미지 12~24일 스테일 · #200 배포 2분 뒤 되돌림 · #202 승인 26시간 방치). 이 스크립트는
 * **새 판정 로직을 만들지 않는다** — 임계(STALE_HOURS) 비교·대기 런 나이 계산·GitHub Actions
 * runs API 정규화 3가지만 신규이고, SHA 추출·라우트 판정은 기존에 이미 게이트①을 통과한 자산을
 * 그대로 import한다:
 *   - `extractSha`      ← verify-deployed-sha.mjs (대장 #186)
 *   - `judgeResults`    ← deploy-smoke.mjs (대장 #180·#204 — 5xx·readiness 판정 포함)
 *
 * ── 입력 검증 먼저 — 단축 SHA 함정 (실측) ─────────────────────────────────────────────
 * `gh api ".../actions/runs?head_sha=9d2a9d8"`(단축 SHA)는 **조용히 0건**을 반환하지만
 * 40자 전체 SHA는 정상적으로 매치한다(§1-0 실측). 그래서 `expect`·`api`·`web` 서빙 SHA
 * 3가지가 **전부 40자 hex가 아니면 다른 어떤 규칙보다 먼저 `bad-sha`로 FAIL**한다(§0).
 *
 * ── 판정 규칙 8종 + 6' (+ 규칙 0 bad-sha 사전검증) ────────────────────────────────────
 *   1  api SHA ≠ expect 이면서 HEAD 나이 ≥ STALE_HOURS         → FAIL api-stale
 *   2  web build-sha 동일 조건                                  → FAIL web-stale
 *   3  judgeResults로 라우트·readiness 실패                     → FAIL route / readiness
 *   4  waiting 런 중 head_sha === expect 의 나이 ≥ STALE_HOURS  → FAIL approval-stale
 *   4' head_sha !== expect 인 waiting 런                        → WARN approval-behind(FAIL 아님)
 *   5  배포 런 conclusion ∈ {failure,cancelled,timed_out,action_required} → FAIL deploy-failed
 *   6  런 success인데 `deploy` 잡이 skipped                      → FAIL deploy-skipped
 *   6' 매치된 배포 런의 jobs 조회 자체가 실패(규칙 6이 그 런에 무력)  → 전량 실패 FAIL jobs-unreachable /
 *      부분 실패(대장 #203 S3 게이트② 반증분 — 조용한 `|| one='[]'` 흡수를 대칭화) → WARN jobs-partial-unreachable
 *   7  GitHub API(runs) 호출 자체가 실패                         → FAIL api-unreachable(조용한 grace 폴백 금지)
 *   8  불일치이나 HEAD 나이 < STALE_HOURS                        → PASS deploying
 * ⭐ 규칙 5·6·6'·7이 이 슬라이스의 핵심이다 — 없으면 대장 #165(Deploy Web 도입 이래 성공 0회)·
 * #156·#161(CI 연속 실패 방치) 유형이 어느 분기로도 가지 않는다.
 *
 * ── 규칙 6'의 전량/부분 구분 근거(심각도 판단) ────────────────────────────────────────
 * `fetch-jobs` 스텝이 매치한 배포 런(N개) 중 jobs 조회가 **전부** 실패하면 규칙 6은 그 틱에서
 * 원리적으로 완전히 무력하다(어떤 success/skipped 조합도 볼 수 없음) — 규칙 7과 동형으로 FAIL.
 * **일부**만 실패하면 나머지 런의 잡 정보로 규칙 6 커버리지가 부분 유지되고, 이 워크플로는 15분
 * 마다 같은 head_sha를 재조회하므로(HEAD가 안 바뀌는 한 run_id 집합이 동일) 다음 틱이 자연스러운
 * 재시도 역할을 한다 — 매 틱의 일시적 GitHub API 블립까지 FAIL로 올리면 오탐이 잦아 규칙 4'
 * (뒤처진 waiting 런)와 같은 판단으로 WARN에 그친다. **단, 침묵은 금지** — WARN도 로그에 반드시
 * 남아 "확인할 게 없음"과 "확인을 못 함"이 구분된다(원 결함의 핵심).
 *
 * ── 순수 함수 vs CLI I/O ─────────────────────────────────────────────────────────────
 * `judgeFreshness`·`normalizeRuns`·`normalizeJobs`는 **순수 함수**다(네트워크 I/O 없음 —
 * `--runs-file`/`--jobs-file`로 이미 수집된 JSON을 정규화·판정만 한다. 테스트 가능성 때문에
 * 이 층은 어떤 경우에도 fetch를 하지 않는다). 네트워크는 오직 `--api-url`/`--web-url` 실프로브
 * 모드(`main()`이 호출하는 `probeRoutesWithRetry`·`fetch`)에만 있고, 거기서만 "실패한 라우트를
 * 30초 후 1회 재프로브"(일시적 블립 허용, 둘 다 실패해야 최종 FAIL) 로직이 적용된다.
 *
 * ── CLI ──────────────────────────────────────────────────────────────────────────────
 *   node monitor-freshness.mjs \
 *     --expect <40자 SHA> --api-url <url> --web-url <url> \
 *     --head-age-hours <n> --runs-file <path> [--jobs-file <path>] [--stale-hours <n>=2]
 *
 * `--runs-file`은 `gh api ".../actions/runs..."` 응답(JSON, `{workflow_runs:[...]}`)이다.
 * 그 호출 자체가 실패했을 때 워크플로가 `{"gachinolFetchFailed":true}` 센티널을 대신 쓰면
 * (파일은 유효한 JSON이라 "입력 파싱 실패"는 아니다) `normalizeRuns`가 `runsUnreachable:true`로
 * 정규화해 규칙 7이 켜진다 — job 자체가 죽어 조용히 넘어가는 것을 막는다.
 *
 * `--jobs-file`은 `{ jobs: [...], attemptedRunIds: string[], unreachableRunIds: string[] }` 스키마다
 * (`monitor.yml`의 `fetch-jobs` 스텝이 기록). 매치된 배포 런 각각의 `gh api .../jobs` 개별 호출이
 * 실패하면 그 run_id를 `unreachableRunIds`에 남긴다(과거처럼 `|| one='[]'`로 조용히 흡수하지 않음
 * — fetch-runs의 gachinolFetchFailed 센티널과 대칭, 대장 #203 S3 게이트② 반증분 수리).
 * `normalizeJobs`가 이를 `jobsFullyUnreachable`/`jobsPartiallyUnreachable`로 정규화해 규칙 6'가 켜진다.
 *
 * ── fail-closed ──────────────────────────────────────────────────────────────────────
 * 필수 인자 누락·`--runs-file`/`--jobs-file` 파일을 읽거나 JSON으로 파싱하는 데 실패 →
 * exit 1(판정까지 가지 않는다 — verify-deployed-sha.mjs·deploy-smoke.mjs와 동형).
 * 판정 결과 `ok:false` → exit 1. `ok:true` → exit 0.
 */
import { readFileSync } from 'node:fs';
import { extractSha } from './verify-deployed-sha.mjs';
import { judgeResults, probeRoutes, resolveDefaultRoutes, resolveDefaultAbsentPath } from './deploy-smoke.mjs';

// ── STALE_HOURS=2h 재검토(2026-09-10, monitor.yml 실가동이 15분이 아니라 2~5시간 간격으로
// 돈다는 게 실측으로 드러난 뒤) — 판단: 그대로 둔다(ⓐ). monitor.yml 헤더의 "실가동 실측" 절
// 참조. 이 상수가 관여하는 것은 규칙 1·2·4·8뿐이다(api-stale·web-stale·approval-stale·
// deploying 경계) — 규칙 3·4'·5·6·6'·7(라우트/readiness·뒤처진 waiting 런·배포 런 실패·deploy
// 잡 skipped·jobs 조회 실패·runs API 불능)은 전부 "grace 무관 즉시 실패/경고"라 이 값과 무관하다.
//
// **왜 이 값이 이 워크플로 자신의 폴링 빈도와 별개 축인가**: staleHours가 재는 것은 "SHA 불일치·
// 승인 대기가 실제로 몇 시간 지속됐는지"(headAgeHours·waitingRun.ageHours — 둘 다 GitHub API의
// 실 타임스탬프와 판정 시각의 차이로, 이 워크플로가 몇 분마다 도는지와 무관하게 계산된다)이지,
// "이 워크플로가 그 사실을 몇 분 만에 알아채는지"가 아니다. 후자는 순전히 **다음 틱이 언제
// 오는가**로 결정된다 — 그래서 staleHours를 올려도 "다음 틱까지 기다려야 한다"는 구조는 그대로다.
//
// **실효 유예 계산(가정 — 표본 3건뿐)**: 명목 grace는 2h지만, 판정은 다음 틱이 돌 때까지 미뤄
// 진다. 불일치가 t0에 시작해 t0+2h에 staleHours를 넘겨도, 그 사실을 알리는 것은 그 이후 첫 틱
// 이다. 관측된 최대 틱 간격(~5시간12분, monitor.yml 헤더 참조)을 더하면 **최악 실효 유예는 명목
// 2h가 아니라 최대 약 7시간12분**(2h + 관측 최대 gap)까지 늘어날 수 있다 — 새 Healthchecks
// 무응답 한도(1h+6h=7h, monitor.yml 헤더 참조)와 자릿수는 비슷하지만 완전히 다른 메커니즘이다
// (이쪽은 "판정이 언제 내려지는가", Healthchecks 쪽은 "판정이 아예 안 왔을 때 언제 알아채는가").
// 표본이 3건(관측 시작 하루 미만)뿐이라 실제 최대 gap은 이보다 클 수 있다 — 확정치가 아니다.
//
// **그래도 2h를 유지하는 근거**: ① staleHours를 올려도 실효 유예의 하한(틱 간격 자체)은 줄지
// 않는다 — 틱이 뜸한 게 병목이지 staleHours가 병목이 아니라서, 값을 올리면 순수 추가 지연만
// 생긴다. ② 실가동 3건은 전부 SHA 일치(`fresh`)라 staleHours가 아예 켜진 적이 없다 — 이 기본값이
// 오탐을 낸 사례가 (표본 부족 하에서도) 지금까지 없다. ③ #202(승인 26시간 방치)류는 2h든 7h든
// 결국 다음 틱에서 잡힌다 — staleHours는 "얼마나 방치돼야 방치로 볼지"의 정책값이지 스케줄
// 불규칙성을 상쇄하는 손잡이가 아니다. 관측 gap이 앞으로 더 벌어지면(예: 하루 1건 수준으로
// 떨어지면) 이 판단은 재검토 대상이다.
const DEFAULT_STALE_HOURS = 2;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_RETRY_DELAY_MS = 30_000;

/** 대장 #180·#202 게이트가 걸린 두 워크플로. `deploy` 잡은 이 둘에만 있다(규칙 6 판별에 사용). */
export const DEPLOY_WORKFLOW_NAMES = ['Build Images', 'Deploy Web'];

const FULL_SHA_RE = /^[0-9a-f]{40}$/i;

// ⚠️ 실측(2026-09-07, `gh api .../actions/runs/<id>/jobs`) — GitHub Jobs API의 `name` 필드는
// YAML 잡 키(`deploy:`)가 아니라 **잡의 `name:` 커스텀 표시값**을 그대로 준다. 이 리포의 두
// 배포 워크플로는 각각 `name: deploy (api·media-worker·ai-worker → 제온)`(build-images.yml)·
// `name: deploy (정적 산출물 → 제온 web 컨테이너)`(deploy-web.yml)로 오버라이드돼 있어 정확히
// `'deploy'`와 비교하면 **영원히 매치되지 않는다**(이 슬라이스가 막으려는 "선언은 있는데 구동은
// 없다" 패턴을 규칙 6 자신이 재생산할 뻔했다). `build-images.yml`·`deploy-web.yml`은 소유 파일
// 밖이라 이름을 바꿀 수 없으므로, 여기서는 "deploy로 시작하는 단어"를 매치한다.
const DEPLOY_JOB_NAME_RE = /^deploy\b/i;

/** GitHub Jobs API의 `name`이 이 리포의 배포 잡(`deploy (...)` 표시명)을 가리키는지 판별한다. */
function isDeployJobName(name) {
  return typeof name === 'string' && DEPLOY_JOB_NAME_RE.test(name);
}
const FAILING_DEPLOY_CONCLUSIONS = new Set(['failure', 'cancelled', 'timed_out', 'action_required']);

// ── 순수 함수 — SHA 형식 ────────────────────────────────────────────────────────────

/** 40자 hex인지(대소문자 무관). 단축 SHA·빈 문자열·null·비hex는 전부 false. */
export function isFullSha(value) {
  return typeof value === 'string' && FULL_SHA_RE.test(value);
}

function shaEquals(a, b) {
  return typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
}

// ── 순수 함수 — GitHub Actions runs/jobs 응답 정규화 ──────────────────────────────────

function ageHoursSince(isoString, nowMs) {
  const t = Date.parse(isoString);
  if (!Number.isFinite(t)) return 0;
  return (nowMs - t) / (1000 * 60 * 60);
}

/**
 * `gh api ".../actions/runs..."` 원본 응답(JSON.parse된 값)을 `judgeFreshness` 입력으로
 * 정규화한다. 네트워크 호출을 하지 않는 순수 함수 — 실패 신호는 입력 자체로 전달된다
 * (`.workflow_runs`가 배열이 아니거나 `gachinolFetchFailed:true` 센티널 → `runsUnreachable:true`).
 * 같은 런이 여러 소스(예: status=waiting 필터 + 일반 목록)에서 중복 수집됐을 수 있어 `id` 기준
 * 중복 제거를 먼저 한다.
 *
 * @param {unknown} rawRuns
 * @param {{ nowMs: number }} opts
 * @returns {{ waitingRuns: object[], deployRuns: object[], runsUnreachable: boolean }}
 */
export function normalizeRuns(rawRuns, { nowMs }) {
  const isUsable = rawRuns && typeof rawRuns === 'object' && Array.isArray(rawRuns.workflow_runs);
  if (!isUsable || rawRuns.gachinolFetchFailed === true) {
    return { waitingRuns: [], deployRuns: [], runsUnreachable: true };
  }

  const dedup = new Map();
  for (const r of rawRuns.workflow_runs) {
    if (r && r.id !== undefined && r.id !== null && !dedup.has(r.id)) {
      dedup.set(r.id, r);
    }
  }
  const runs = [...dedup.values()];

  const waitingRuns = runs
    .filter((r) => r.status === 'waiting')
    .map((r) => ({
      id: r.id,
      headSha: r.head_sha,
      ageHours: ageHoursSince(r.created_at, nowMs),
      htmlUrl: r.html_url ?? null,
      workflowName: r.name ?? null,
    }));

  const deployRuns = runs
    .filter((r) => r.status === 'completed' && DEPLOY_WORKFLOW_NAMES.includes(r.name))
    .map((r) => ({
      id: r.id,
      headSha: r.head_sha,
      conclusion: r.conclusion ?? null,
      htmlUrl: r.html_url ?? null,
      workflowName: r.name ?? null,
    }));

  return { waitingRuns, deployRuns, runsUnreachable: false };
}

/**
 * jobs 원본을 정규화한다. `--jobs-file`이 아예 주어지지 않은 경우 `main()`은 이 함수를 호출하지
 * 않고 전부-빈 기본값을 쓴다(규칙 6/6'는 "선택" — 정보가 없으면 그저 발동하지 않는다. 규칙 7의
 * "조용한 grace 폴백 금지"와는 다른 축: jobs 정보 부재는 runs API 자체의 실패가 아니다).
 *
 * 기대 스키마(`monitor.yml`의 `fetch-jobs` 스텝이 기록):
 *   `{ jobs: {name,conclusion,runConclusion}[], attemptedRunIds: string[], unreachableRunIds: string[] }`
 * `unreachableRunIds`는 매치된 배포 런 중 `gh api .../jobs` 개별 호출이 실패한 run_id 목록이다
 * (조용히 `[]`로 흡수하지 않고 남긴 것 — 대장 #203 S3 게이트② 반증분). attemptedRunIds 대비
 * unreachableRunIds의 비율로 전량/부분을 가른다:
 *   - `jobsFullyUnreachable`  : 시도한 런 전부가 조회 실패 → 규칙 6이 이 틱에서 완전히 무력
 *   - `jobsPartiallyUnreachable`: 일부만 실패 → 나머지 런으로 규칙 6 커버리지 부분 유지
 *
 * 구버전 호환: `rawJobs`가 순수 배열이면(舊 스키마) 실패 신호가 없다는 뜻으로 취급한다 — 이
 * 리포의 유일한 생산자(`fetch-jobs` 스텝)는 이제 항상 객체 스키마를 쓰므로 프로덕션 경로는
 * 아니지만, 입력이 이 함수 하나로 수렴하므로 방어적으로 남겨 크래시 대신 "신호 없음"으로 떨어진다.
 *
 * @param {unknown} rawJobs
 * @returns {{
 *   jobs: { name: string, conclusion: string|null, runConclusion: string|null }[],
 *   attemptedRunIds: string[],
 *   unreachableRunIds: string[],
 *   jobsFullyUnreachable: boolean,
 *   jobsPartiallyUnreachable: boolean,
 * }}
 */
export function normalizeJobs(rawJobs) {
  const empty = { jobs: [], attemptedRunIds: [], unreachableRunIds: [], jobsFullyUnreachable: false, jobsPartiallyUnreachable: false };

  if (Array.isArray(rawJobs)) {
    // 구버전 호환(위 docblock 참조) — 배열 그대로면 실패 신호가 없다는 뜻.
    return { ...empty, jobs: normalizeJobEntries(rawJobs) };
  }

  const isUsable = rawJobs && typeof rawJobs === 'object' && Array.isArray(rawJobs.jobs);
  if (!isUsable) return empty;

  const attemptedRunIds = Array.isArray(rawJobs.attemptedRunIds) ? rawJobs.attemptedRunIds.map(String) : [];
  const unreachableRunIdsRaw = Array.isArray(rawJobs.unreachableRunIds) ? rawJobs.unreachableRunIds.map(String) : [];
  const attemptedSet = new Set(attemptedRunIds);
  // unreachableRunIds는 attemptedRunIds의 부분집합이어야 정상 산출물이다 — 오염된 입력에서도
  // 전량/부분 판정이 과대평가되지 않도록 교집합만 센다.
  const unreachableSet = new Set(unreachableRunIdsRaw.filter((id) => attemptedSet.has(id)));

  const jobsFullyUnreachable = attemptedSet.size > 0 && unreachableSet.size === attemptedSet.size;
  const jobsPartiallyUnreachable = !jobsFullyUnreachable && unreachableSet.size > 0;

  return {
    jobs: normalizeJobEntries(rawJobs.jobs),
    attemptedRunIds: [...attemptedSet],
    unreachableRunIds: [...unreachableSet],
    jobsFullyUnreachable,
    jobsPartiallyUnreachable,
  };
}

function normalizeJobEntries(rawJobs) {
  return rawJobs
    .filter((j) => j && typeof j.name === 'string')
    .map((j) => ({
      name: j.name,
      conclusion: j.conclusion ?? null,
      runConclusion: j.runConclusion ?? null,
    }));
}

// ── 순수 함수 — 핵심 판정 ────────────────────────────────────────────────────────────

/**
 * @param {{
 *   expectSha: string,
 *   apiSha: string|null,
 *   webSha: string|null,
 *   routeVerdict?: {ok:boolean,reason:string,routeFailures?:object[],missingRequiredRoutes?:string[]}|null,
 *   headAgeHours: number,
 *   staleHours: number,
 *   waitingRuns?: {headSha:string,ageHours:number,htmlUrl?:string|null,workflowName?:string|null}[],
 *   deployRuns?: {headSha:string,conclusion:string|null,htmlUrl?:string|null,workflowName?:string|null}[],
 *   deployJobs?: {name:string,conclusion:string|null,runConclusion:string|null}[],
 *   runsUnreachable?: boolean,
 *   jobsFullyUnreachable?: boolean,
 *   jobsPartiallyUnreachable?: boolean,
 * }} input
 * @returns {{ok:boolean,status:'PASS'|'FAIL',primaryCode:string,reason:string,failures:object[],warnings:object[]}}
 */
export function judgeFreshness(input) {
  const {
    expectSha,
    apiSha,
    webSha,
    routeVerdict = null,
    headAgeHours,
    staleHours,
    waitingRuns = [],
    deployRuns = [],
    deployJobs = [],
    runsUnreachable = false,
    jobsFullyUnreachable = false,
    jobsPartiallyUnreachable = false,
  } = input ?? {};

  // ── 규칙 0 (입력 검증 먼저) — 단축 SHA 함정. 다른 어떤 규칙보다 먼저 확인하고 short-circuit한다.
  const badFields = [];
  if (!isFullSha(expectSha)) badFields.push('expect');
  if (!isFullSha(apiSha)) badFields.push('api');
  if (!isFullSha(webSha)) badFields.push('web');
  if (badFields.length > 0) {
    const message = `SHA가 40자 hex가 아님(단축 SHA는 GitHub API에서 조용히 0건이 되는 함정 방지): ${badFields.join(', ')}`;
    return {
      ok: false,
      status: 'FAIL',
      primaryCode: 'bad-sha',
      reason: message,
      failures: [{ rule: 0, code: 'bad-sha', message, fields: badFields }],
      warnings: [],
    };
  }

  const failures = [];
  const warnings = [];

  // ── 규칙 1 — api SHA 드리프트 지속 ──
  const apiMismatch = !shaEquals(apiSha, expectSha);
  if (apiMismatch && headAgeHours >= staleHours) {
    failures.push({
      rule: 1,
      code: 'api-stale',
      message: `api SHA 불일치 지속: expect=${expectSha} actual=${apiSha} (HEAD 나이 ${headAgeHours}h ≥ ${staleHours}h)`,
    });
  }

  // ── 규칙 2 — web build-sha 드리프트 지속 ──
  const webMismatch = !shaEquals(webSha, expectSha);
  if (webMismatch && headAgeHours >= staleHours) {
    failures.push({
      rule: 2,
      code: 'web-stale',
      message: `web build-sha 불일치 지속: expect=${expectSha} actual=${webSha} (HEAD 나이 ${headAgeHours}h ≥ ${staleHours}h)`,
    });
  }

  // ── 규칙 3 — 라우트·readiness(judgeResults 재사용, staleHours 무관 — 즉시 실패) ──
  if (routeVerdict && routeVerdict.ok === false) {
    const readinessKinds = new Set(['readiness_status', 'readiness_content_type']);
    const hasReadinessFailure = (routeVerdict.routeFailures ?? []).some((f) => readinessKinds.has(f.failureKind));
    const missingReadiness = (routeVerdict.missingRequiredRoutes ?? []).some((label) => label.includes('readiness'));
    failures.push({
      rule: 3,
      code: hasReadinessFailure || missingReadiness ? 'readiness' : 'route',
      message: `라우트 스모크 실패: ${routeVerdict.reason}`,
    });
  }

  // ── 규칙 4/4' — 승인 대기 런 ──
  for (const run of waitingRuns) {
    if (shaEquals(run.headSha, expectSha)) {
      if (run.ageHours >= staleHours) {
        failures.push({
          rule: 4,
          code: 'approval-stale',
          message: `승인 대기 방치: ${run.workflowName ?? '(이름 없음)'} — 대기 ${run.ageHours}h ≥ ${staleHours}h`,
          htmlUrl: run.htmlUrl ?? null,
        });
      }
      // head_sha === expect이고 아직 staleHours 미만이면 정상 대기 — 판정 없음(규칙 8과는 다른 축).
    } else {
      // 규율: 뒤처진 런(다른 커밋을 기다리는 중)이 영구 FAIL을 만들지 않게 WARN에 그친다.
      warnings.push({
        rule: '4-prime',
        code: 'approval-behind',
        message: `뒤처진 승인 대기 런(head_sha≠expect): ${run.workflowName ?? '(이름 없음)'} sha=${run.headSha ?? '?'}`,
        htmlUrl: run.htmlUrl ?? null,
      });
    }
  }

  // ── 규칙 5 — 배포 런 conclusion이 실패류 (grace 무관 — 즉시 실패, 런 URL 동봉) ──
  for (const run of deployRuns) {
    if (FAILING_DEPLOY_CONCLUSIONS.has(run.conclusion)) {
      failures.push({
        rule: 5,
        code: 'deploy-failed',
        message: `배포 런 실패(conclusion=${run.conclusion}): ${run.workflowName ?? '(이름 없음)'}`,
        htmlUrl: run.htmlUrl ?? null,
      });
    }
  }

  // ── 규칙 6 — 런은 success인데 `deploy` 잡이 skipped(preflight 시크릿 소실 의심) ──
  for (const job of deployJobs ?? []) {
    if (isDeployJobName(job.name) && job.runConclusion === 'success' && job.conclusion === 'skipped') {
      failures.push({
        rule: 6,
        code: 'deploy-skipped',
        message: 'success 런인데 deploy 잡이 skipped — preflight 시크릿 소실 의심(대장 #165·#156·#161 유형)',
      });
    }
  }

  // ── 규칙 6' — 배포 런과 매치된 jobs 조회 자체가 실패(규칙 6이 그 런에 무력) ──
  // 전량 실패면 규칙 6이 이 틱에서 어떤 success/skipped 조합도 볼 수 없다 — 규칙 7과 동형 FAIL.
  // 부분 실패는 나머지 런의 잡 정보로 규칙 6 커버리지가 일부 유지되고, 15분 주기 재조회가
  // 자연스러운 재시도 역할을 하므로 매 틱의 일시적 API 블립까지 FAIL로 올리면 오탐이 잦다 —
  // 규칙 4'(뒤처진 waiting 런)와 같은 판단으로 WARN에 그친다. 침묵은 금지(WARN도 로그에 남는다 —
  // 원 결함은 "확인할 게 없음"과 "확인을 못 함"이 구분 불가능했던 것이지, WARN 자체가 아니다).
  if (jobsFullyUnreachable) {
    failures.push({
      rule: '6-prime',
      code: 'jobs-unreachable',
      message: '배포 런과 매치된 jobs 조회가 전량 실패 — 규칙 6(deploy-skipped)이 이 틱에서 완전히 무력화됨(조용한 grace 폴백 금지)',
    });
  } else if (jobsPartiallyUnreachable) {
    warnings.push({
      rule: '6-prime',
      code: 'jobs-partial-unreachable',
      message: '배포 런과 매치된 jobs 조회 중 일부가 실패 — 그 런에 한해 규칙 6(deploy-skipped) 커버리지 없음(나머지 런은 정상 판정)',
    });
  }

  // ── 규칙 7 — GitHub API(runs) 호출 자체가 실패 — 조용한 grace 폴백 금지 ──
  if (runsUnreachable) {
    failures.push({
      rule: 7,
      code: 'api-unreachable',
      message: 'GitHub API(actions/runs) 조회 자체가 실패함 — 대기 런·배포 런 상태를 알 수 없음(조용한 grace 폴백 금지)',
    });
  }

  const ok = failures.length === 0;
  const warningSuffix =
    warnings.length > 0 ? ` | 경고 ${warnings.length}건: ${warnings.map((w) => w.message).join('; ')}` : '';

  if (!ok) {
    return {
      ok: false,
      status: 'FAIL',
      primaryCode: failures[0].code,
      reason: failures.map((f) => `${f.code}: ${f.message}`).join(' | ') + warningSuffix,
      failures,
      warnings,
    };
  }

  // ── 규칙 8 — 불일치이나 HEAD 나이 < STALE_HOURS(아직 배포 전파 유예 구간) ──
  if (apiMismatch || webMismatch) {
    return {
      ok: true,
      status: 'PASS',
      primaryCode: 'deploying',
      reason: `deploying — SHA 불일치이나 HEAD 나이 ${headAgeHours}h < ${staleHours}h(유예 구간)` + warningSuffix,
      failures,
      warnings,
    };
  }

  return {
    ok: true,
    status: 'PASS',
    primaryCode: 'fresh',
    reason: '전 축 일치 · 이상 없음' + warningSuffix,
    failures,
    warnings,
  };
}

// ── 실 프로브(네트워크 I/O) — `--api-url`/`--web-url` 모드 전용 ───────────────────────

/**
 * `deploy-smoke.mjs`의 `probeRoutes`를 감싸 "일시적 블립" 내성을 더한다: 1차 판정이 실패면
 * `delayMs` 후 **실패한 라우트만** 재프로브하고, 재프로브에서도 실패한 라우트만 최종 실패로
 * 남긴다(둘 다 실패해야 FAIL). 필수 라우트 자체가 목록에서 빠진 경우(구성 문제)는 재시도로
 * 해결되지 않으므로 즉시 반환한다.
 *
 * ⚠️ 이 함수만 네트워크 I/O·시간 지연을 가진다 — `judgeFreshness`는 절대 이걸 호출하지 않는다.
 *
 * @param {{ baseUrl: string, routes: string[], absentPath: string, timeoutMs?: number,
 *   fetchImpl?: typeof fetch, delayMs?: number, sleepImpl?: (ms:number) => Promise<void> }} opts
 */
export async function probeRoutesWithRetry({
  baseUrl,
  routes,
  absentPath,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchImpl = fetch,
  delayMs = DEFAULT_RETRY_DELAY_MS,
  sleepImpl,
}) {
  const sleep = sleepImpl ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));

  const attempt1 = await probeRoutes({ baseUrl, routes, absentPath, timeoutMs, fetchImpl });
  const verdict1 = judgeResults(attempt1);
  if (verdict1.ok) {
    return { routeResults: attempt1.routeResults, absentResult: attempt1.absentResult, verdict: verdict1, retried: false };
  }

  const failingPaths = new Set(verdict1.routeFailures.map((f) => f.path));
  if (failingPaths.size === 0) {
    // routeFailures는 비었는데 ok=false → missingRequiredRoutes만 원인(구성 문제, 재시도 무의미).
    return { routeResults: attempt1.routeResults, absentResult: attempt1.absentResult, verdict: verdict1, retried: false };
  }

  await sleep(delayMs);

  const retryRoutePaths = routes.filter((p) => failingPaths.has(p));
  const attempt2 = await probeRoutes({ baseUrl, routes: retryRoutePaths, absentPath, timeoutMs, fetchImpl });

  const mergedRouteResults = attempt1.routeResults.map((r) => {
    if (!failingPaths.has(r.path)) return r;
    return attempt2.routeResults.find((r2) => r2.path === r.path) ?? r;
  });
  // 음성 대조는 재시도 시 항상 최신값으로 갱신한다(비용이 낮고, 최초 실패 시에만 재시도하므로
  // 매번 30초씩 걸리지 않는다).
  const merged = { routeResults: mergedRouteResults, absentResult: attempt2.absentResult };
  const verdict2 = judgeResults(merged);
  return { routeResults: merged.routeResults, absentResult: merged.absentResult, verdict: verdict2, retried: true };
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--expect':
        opts.expect = argv[++i];
        break;
      case '--api-url':
        opts.apiUrl = argv[++i];
        break;
      case '--web-url':
        opts.webUrl = argv[++i];
        break;
      case '--stale-hours':
        opts.staleHours = argv[++i];
        break;
      case '--head-age-hours':
        opts.headAgeHours = argv[++i];
        break;
      case '--runs-file':
        opts.runsFile = argv[++i];
        break;
      case '--jobs-file':
        opts.jobsFile = argv[++i];
        break;
      default:
        throw new Error(`알 수 없는 인자: ${arg}`);
    }
  }
  return opts;
}

function loadJsonFile(path, label) {
  const raw = readFileSync(path, 'utf8'); // ENOENT 등은 호출부가 잡아 exit 1 메시지를 통일한다.
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`${label} JSON 파싱 실패(${path}): ${err.message}`);
  }
}

async function probeSha(kind, url, fetchImpl) {
  try {
    const target = kind === 'api' ? new URL('/health/version', url).toString() : url;
    const res = await fetchImpl(target);
    if (!res.ok) return null;
    return extractSha(kind, await res.text());
  } catch {
    return null; // 네트워크 실패·타임아웃 → null(judgeFreshness의 bad-sha 경로로 수렴 — §0 참조)
  }
}

function printResult(result, context) {
  const line = `[monitor-freshness] ${result.status} (${result.primaryCode}) — ${result.reason}`;
  if (result.ok) {
    console.log(line);
  } else {
    console.error(line);
  }
  console.log(JSON.stringify({ ...result, context }, null, 2));
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
    return;
  }

  const missing = [];
  if (!opts.expect) missing.push('--expect');
  if (!opts.apiUrl) missing.push('--api-url');
  if (!opts.webUrl) missing.push('--web-url');
  if (!opts.runsFile) missing.push('--runs-file');
  if (opts.headAgeHours === undefined) missing.push('--head-age-hours');
  if (missing.length > 0) {
    console.error(`필수 인자 누락: ${missing.join(', ')}`);
    process.exitCode = 1;
    return;
  }

  const staleHours = opts.staleHours !== undefined ? Number(opts.staleHours) : DEFAULT_STALE_HOURS;
  if (!Number.isFinite(staleHours) || staleHours < 0) {
    console.error(`잘못된 --stale-hours: ${opts.staleHours}`);
    process.exitCode = 1;
    return;
  }

  const headAgeHours = Number(opts.headAgeHours);
  if (!Number.isFinite(headAgeHours) || headAgeHours < 0) {
    console.error(`잘못된 --head-age-hours: ${opts.headAgeHours}`);
    process.exitCode = 1;
    return;
  }

  let rawRuns;
  try {
    rawRuns = loadJsonFile(opts.runsFile, '--runs-file');
  } catch (err) {
    console.error(`--runs-file 로드 실패: ${opts.runsFile} — ${err.message}`);
    process.exitCode = 1;
    return;
  }

  let jobsInfo = { jobs: [], attemptedRunIds: [], unreachableRunIds: [], jobsFullyUnreachable: false, jobsPartiallyUnreachable: false };
  if (opts.jobsFile) {
    let rawJobs;
    try {
      rawJobs = loadJsonFile(opts.jobsFile, '--jobs-file');
    } catch (err) {
      console.error(`--jobs-file 로드 실패: ${opts.jobsFile} — ${err.message}`);
      process.exitCode = 1;
      return;
    }
    jobsInfo = normalizeJobs(rawJobs);
  }

  const nowMs = Date.now();
  const { waitingRuns, deployRuns, runsUnreachable } = normalizeRuns(rawRuns, { nowMs });

  const [apiSha, webSha] = await Promise.all([
    probeSha('api', opts.apiUrl, fetch),
    probeSha('web', opts.webUrl, fetch),
  ]);

  const routes = resolveDefaultRoutes();
  const absentPath = resolveDefaultAbsentPath();
  const { verdict: routeVerdict } = await probeRoutesWithRetry({ baseUrl: opts.apiUrl, routes, absentPath });

  const result = judgeFreshness({
    expectSha: opts.expect,
    apiSha,
    webSha,
    routeVerdict,
    headAgeHours,
    staleHours,
    waitingRuns,
    deployRuns,
    deployJobs: jobsInfo.jobs,
    runsUnreachable,
    jobsFullyUnreachable: jobsInfo.jobsFullyUnreachable,
    jobsPartiallyUnreachable: jobsInfo.jobsPartiallyUnreachable,
  });

  printResult(result, {
    expectSha: opts.expect,
    apiSha,
    webSha,
    headAgeHours,
    staleHours,
    waitingRunCount: waitingRuns.length,
    deployRunCount: deployRuns.length,
    runsUnreachable,
    jobsAttemptedRunIds: jobsInfo.attemptedRunIds,
    jobsUnreachableRunIds: jobsInfo.unreachableRunIds,
  });

  process.exitCode = result.ok ? 0 : 1;
}

const isMainModule = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  main();
}
