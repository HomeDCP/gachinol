// infra/scripts/deploy-rollback.test.mjs
// 배포 자동 롤백 코어(대장 #243 태스크①) 단위 테스트.
//
// ⭐ 핵심은 "6축 각각의 실패가 올바른 판정(롤백/경보만/에스컬레이션)으로 이어지는가"와
// "생성된 원격 명령이 2026-09-12 사고(대장 #215 — IMAGE_TAG 누락으로 latest 폴백)를 구조적으로
// 재현할 수 없는가"다. 뮤테이션 실증(작업 순서 6)은 별도로 소스를 직접 편집해 이 테스트가
// red가 되는지 확인한다 — 이 파일 자체는 정상 계약을 property로 고정한다.
//
// ⚠️ 루트 package.json의 `test:scripts`에 이 파일을 등재해야 한다 — 잊으면
// `daejang-recheck.test.mjs`의 self-check(test:scripts 등재 검사)가 레드로 잡는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  REQUIRED_SERVICES,
  DEFAULT_ROLLBACK_MODE,
  parseCaptureRawText,
  validateCaptureEntries,
  buildCapture,
  deriveRepoPart,
  generateRollbackPlan,
  parseMigrationsChangedFile,
  hasMigrationsChanged,
  classifyMediaVerdictForRollback,
  decideRollback,
  computeFinalVerdict,
  formatRecoveryRunbook,
} from './deploy-rollback.mjs';

const SCRIPT_PATH = fileURLToPath(new URL('./deploy-rollback.mjs', import.meta.url));

// ── 픽스처 헬퍼 ────────────────────────────────────────────────────────────────────

const VALID_RAW_CAPTURE = [
  'api|ghcr.io/homedcp/gachinol-api:latest|sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa|1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b',
  'media-worker|ghcr.io/homedcp/gachinol-media-worker:latest|sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb|1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b',
  'ai-worker|ghcr.io/homedcp/gachinol-ai-worker:latest|sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc|1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b',
].join('\n');

function validCapture(overrides = {}) {
  return buildCapture(VALID_RAW_CAPTURE, { capturedAt: '2026-09-26T00:00:00.000Z', runId: 'run1', ...overrides });
}

function okAxis(reason) {
  return { ok: true, reason: reason ?? null };
}
function failAxis(reason) {
  return { ok: false, reason: reason ?? '실패' };
}

/** 6축 전부 통과하는 기본 axes — 각 테스트가 원하는 축만 덮어쓴다. */
function passingAxes(overrides = {}) {
  return {
    apiSha: okAxis(),
    routes: okAxis(),
    workers: [
      { name: 'media-worker', ok: true, reason: null },
      { name: 'ai-worker', ok: true, reason: null },
    ],
    media: null,
    ...overrides,
  };
}

function mediaVerdict(failures, warnings = []) {
  return { ok: failures.length === 0, status: failures.length === 0 ? 'PASS' : 'FAIL', reason: 'test', failures, warnings, targets: [] };
}

function hostFailureMedia(codes = ['private-host']) {
  return mediaVerdict([{ code: codes[0], failureKinds: codes, source: 'feed.thumbnailUrl', url: 'http://x', message: 'x' }]);
}
function reachFailureMedia(code = 'not_found') {
  return mediaVerdict([{ code, failureKinds: [code], source: 'playback.hlsUrl', url: 'https://x', message: 'x' }]);
}
function unknownCodeMedia(code = 'some-brand-new-code') {
  return mediaVerdict([{ code, failureKinds: [code], source: 'playback.hlsUrl', url: 'https://x', message: 'x' }]);
}
function emptyFeedMedia() {
  return { ok: true, status: 'PASS', reason: 'empty', failures: [], warnings: [{ code: 'empty-feed', message: 'x' }], targets: [] };
}

let tmpDirs = [];
function makeTmpDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}
function writeTemp(prefix, filename, content) {
  const dir = makeTmpDir(prefix);
  const path = join(dir, filename);
  writeFileSync(path, content);
  return path;
}

test.after(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
});

// ═══════════════════════════════════════════════════════════════════════════════════
// capture — 파싱·검증
// ═══════════════════════════════════════════════════════════════════════════════════

test('parseCaptureRawText: 정상 3줄을 파싱한다(주석·빈 줄 무시)', () => {
  const raw = `# comment\n\n${VALID_RAW_CAPTURE}\n`;
  const entries = parseCaptureRawText(raw);
  assert.equal(entries.length, 3);
  assert.deepEqual(
    entries.map((e) => e.service),
    ['api', 'media-worker', 'ai-worker'],
  );
});

test('parseCaptureRawText: 필드 개수가 4개가 아니면 parseError', () => {
  const entries = parseCaptureRawText('api|onlyref|imageid');
  assert.equal(entries.length, 1);
  assert.match(entries[0].parseError, /필드 4개/);
});

test('buildCapture: 정상 입력 → ok:true, 3서비스 전부 채워짐', () => {
  const capture = validCapture();
  assert.equal(capture.ok, true);
  assert.deepEqual(Object.keys(capture.services).sort(), [...REQUIRED_SERVICES].sort());
  assert.equal(capture.services.api.gitSha, '1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b');
});

test('⭐ capture 거부: 서비스 결손(3개 중 1개 빠짐)', () => {
  const twoLines = VALID_RAW_CAPTURE.split('\n').slice(0, 2).join('\n');
  const capture = buildCapture(twoLines);
  assert.equal(capture.ok, false);
  assert.ok(capture.rejections.some((r) => r.includes('서비스 결손: ai-worker')));
});

test('⭐ capture 거부: gitSha 공백', () => {
  const raw = 'api|ghcr.io/x/gachinol-api:latest|sha256:' + 'a'.repeat(64) + '|\n' +
    VALID_RAW_CAPTURE.split('\n').slice(1).join('\n');
  const capture = buildCapture(raw);
  assert.equal(capture.ok, false);
  assert.ok(capture.rejections.some((r) => r.includes('api') && r.includes('gitSha')));
});

test('⭐ capture 거부: gitSha가 "unknown"(Dockerfile ARG 기본값 — 빌드 스탬프 미주입)', () => {
  const lines = VALID_RAW_CAPTURE.split('\n');
  lines[0] = 'api|ghcr.io/homedcp/gachinol-api:latest|sha256:' + 'a'.repeat(64) + '|unknown';
  const capture = buildCapture(lines.join('\n'));
  assert.equal(capture.ok, false);
  assert.ok(capture.rejections.some((r) => r.includes('unknown')));
});

test('⭐ capture 거부: ref가 digest 고정 참조(@sha256:...) — 재태그 파생 불가', () => {
  const lines = VALID_RAW_CAPTURE.split('\n');
  lines[0] =
    'api|ghcr.io/homedcp/gachinol-api@sha256:' +
    'd'.repeat(64) +
    '|sha256:' +
    'a'.repeat(64) +
    '|1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b';
  const capture = buildCapture(lines.join('\n'));
  assert.equal(capture.ok, false);
  assert.ok(capture.rejections.some((r) => r.includes('digest 고정')));
});

test('⭐ capture 거부: imageId가 sha256 형식이 아님', () => {
  const lines = VALID_RAW_CAPTURE.split('\n');
  lines[0] = 'api|ghcr.io/homedcp/gachinol-api:latest|not-a-digest|1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b';
  const capture = buildCapture(lines.join('\n'));
  assert.equal(capture.ok, false);
  assert.ok(capture.rejections.some((r) => r.includes('imageId')));
});

test('validateCaptureEntries: 서비스 중복 라인은 거부', () => {
  const raw = VALID_RAW_CAPTURE + '\n' + VALID_RAW_CAPTURE.split('\n')[0];
  const capture = buildCapture(raw);
  assert.equal(capture.ok, false);
  assert.ok(capture.rejections.some((r) => r.includes('중복')));
});

// ═══════════════════════════════════════════════════════════════════════════════════
// deriveRepoPart / generateRollbackPlan
// ═══════════════════════════════════════════════════════════════════════════════════

test('deriveRepoPart: 마지막 ":" 앞부분을 취한다(일반 레지스트리)', () => {
  assert.equal(deriveRepoPart('ghcr.io/homedcp/gachinol-api:latest'), 'ghcr.io/homedcp/gachinol-api');
});

test('⭐ deriveRepoPart: 레지스트리 하드코딩이 아니다 — 포트 있는 다른 레지스트리도 옳게 파생', () => {
  assert.equal(
    deriveRepoPart('registry.example.com:5001/team/gachinol-api:sha-abc123'),
    'registry.example.com:5001/team/gachinol-api',
  );
  // ghcr.io가 코드 안에 하드코딩돼 있었다면 이 케이스가 깨진다(다른 레지스트리 문자열이 섞이지 않음을 직접 확인).
  assert.ok(!deriveRepoPart('registry.example.com:5001/team/gachinol-api:sha-abc123').includes('ghcr.io'));
});

test('generateRollbackPlan: runId 없으면 throw', () => {
  assert.throws(() => generateRollbackPlan({ capture: validCapture(), runId: undefined }), /runId/);
});

test('generateRollbackPlan: capture가 ok:false면 throw', () => {
  const badCapture = buildCapture('api|x|y|z');
  assert.throws(() => generateRollbackPlan({ capture: badCapture, runId: 'r1' }), /capture가 유효하지 않음/);
});

test('generateRollbackPlan: 3서비스 각각 docker tag 명령을 만든다(imageId → repoPart:rollback-runId)', () => {
  const plan = generateRollbackPlan({ capture: validCapture(), runId: 'run42' });
  assert.equal(plan.tagSuffix, 'rollback-run42');
  for (const svc of REQUIRED_SERVICES) {
    const expectedRepo = `ghcr.io/homedcp/gachinol-${svc}`;
    assert.ok(
      plan.commands.some((c) => c.startsWith('docker tag') && c.includes(expectedRepo + ':rollback-run42')),
      `${svc} 태그 명령 누락: ${JSON.stringify(plan.commands)}`,
    );
  }
});

test('⭐⭐ generateRollbackPlan: remoteCommand에 "IMAGE_TAG="가 반드시 포함된다(대장 #215 방지)', () => {
  const plan = generateRollbackPlan({ capture: validCapture(), runId: 'run42' });
  assert.match(plan.remoteCommand, /export IMAGE_TAG=rollback-run42/);
});

test('⭐⭐ generateRollbackPlan: remoteCommand에 "pull"이 포함되지 않는다(rollback-* 태그는 GHCR에 없다)', () => {
  const plan = generateRollbackPlan({ capture: validCapture(), runId: 'run42' });
  assert.ok(!/\bpull\b/.test(plan.remoteCommand), `pull이 섞여 있으면 안 됨: ${plan.remoteCommand}`);
});

test('⭐⭐ generateRollbackPlan: remoteCommand에 "--no-deps"가 반드시 포함된다(web·cloudflared 연쇄 재기동 방지)', () => {
  const plan = generateRollbackPlan({ capture: validCapture(), runId: 'run42' });
  assert.match(plan.remoteCommand, /--no-deps/);
});

test('generateRollbackPlan: compose up 대상은 api·media-worker·ai-worker 3개뿐(web·cloudflared 제외)', () => {
  const plan = generateRollbackPlan({ capture: validCapture(), runId: 'run42' });
  const composeLine = plan.commands.find((c) => c.includes('docker compose'));
  assert.match(composeLine, /up -d --no-build --no-deps api media-worker ai-worker\s*$/);
  assert.ok(!composeLine.includes('web'));
  assert.ok(!composeLine.includes('cloudflared'));
});

// ═══════════════════════════════════════════════════════════════════════════════════
// 마이그레이션 변경 목록 파싱
// ═══════════════════════════════════════════════════════════════════════════════════

test('parseMigrationsChangedFile: 빈 파일 → 빈 배열, hasMigrationsChanged=false', () => {
  assert.deepEqual(parseMigrationsChangedFile(''), []);
  assert.equal(hasMigrationsChanged(''), false);
});

test('parseMigrationsChangedFile: 주석·빈 줄 무시하고 실제 경로만 남긴다', () => {
  const content = '# comment\n\nservices/api/prisma/migrations/20260101_x/migration.sql\n';
  assert.deepEqual(parseMigrationsChangedFile(content), ['services/api/prisma/migrations/20260101_x/migration.sql']);
  assert.equal(hasMigrationsChanged(content), true);
});

// ═══════════════════════════════════════════════════════════════════════════════════
// classifyMediaVerdictForRollback — 호스트 계열 vs 도달 계열
// ═══════════════════════════════════════════════════════════════════════════════════

test('classifyMediaVerdictForRollback: media=null → 실패 없음', () => {
  const r = classifyMediaVerdictForRollback(null);
  assert.equal(r.hasHostFailure, false);
  assert.equal(r.hasReachabilityFailure, false);
});

test('classifyMediaVerdictForRollback: ok:true(빈 피드 포함) → 실패 없음', () => {
  const r = classifyMediaVerdictForRollback(emptyFeedMedia());
  assert.equal(r.hasHostFailure, false);
  assert.equal(r.hasReachabilityFailure, false);
});

for (const code of ['invalid-url', 'loopback-host', 'private-host', 'internal-host', 'insecure-scheme']) {
  test(`classifyMediaVerdictForRollback: 호스트 계열 코드 "${code}" → hasHostFailure`, () => {
    const r = classifyMediaVerdictForRollback(hostFailureMedia([code]));
    assert.equal(r.hasHostFailure, true);
    assert.equal(r.hasReachabilityFailure, false);
  });
}

for (const code of [
  'timeout',
  'request_failed',
  'not_found',
  'forbidden',
  'server_error',
  'unexpected_status',
  'content_type_mismatch',
  'feed-fetch-failed',
  'playback-fetch-failed',
]) {
  test(`classifyMediaVerdictForRollback: 도달 계열 코드 "${code}" → hasReachabilityFailure(호스트 아님)`, () => {
    const r = classifyMediaVerdictForRollback(reachFailureMedia(code));
    assert.equal(r.hasHostFailure, false);
    assert.equal(r.hasReachabilityFailure, true);
  });
}

test('⭐⭐ classifyMediaVerdictForRollback: 미지의 코드는 호스트도 도달도 아니다(방향 반전, 대장 #243 2026-09-26)', () => {
  const r = classifyMediaVerdictForRollback(hostFailureMedia(['some-brand-new-code']));
  assert.equal(r.hasHostFailure, false);
  assert.equal(r.hasReachabilityFailure, false);
  assert.deepEqual(r.unknownCodes, ['some-brand-new-code']);
});

// ═══════════════════════════════════════════════════════════════════════════════════
// decideRollback — 6축 × (통과/실패) + 우선 규칙(마이그레이션)
// ═══════════════════════════════════════════════════════════════════════════════════

test('decideRollback: 6축 전부 통과 → rollback=false, escalate=""', () => {
  const result = decideRollback({ capture: validCapture(), migrationsChanged: false, axes: passingAxes(), runId: 'r1' });
  assert.equal(result.rollback, false);
  assert.equal(result.escalate, '');
  assert.equal(result.anyAxisFailed, false);
  assert.equal(result.plan, null);
});

test('축1) api SHA 대조 실패 → rollback', () => {
  const result = decideRollback({
    capture: validCapture(),
    migrationsChanged: false,
    axes: passingAxes({ apiSha: failAxis('SHA 불일치') }),
    runId: 'r1',
  });
  assert.equal(result.rollback, true);
  assert.ok(result.reasons.some((r) => r.includes('api SHA')));
  assert.ok(result.plan, 'rollback=true면 plan이 생성돼야 함');
});

test('축2) 라우트/readiness 검증 실패 → rollback', () => {
  const result = decideRollback({
    capture: validCapture(),
    migrationsChanged: false,
    axes: passingAxes({ routes: failAxis('404 route_missing') }),
    runId: 'r1',
  });
  assert.equal(result.rollback, true);
  assert.ok(result.reasons.some((r) => r.includes('라우트')));
});

test('축4) 워커(media-worker) SHA 대조 실패 → rollback', () => {
  const result = decideRollback({
    capture: validCapture(),
    migrationsChanged: false,
    axes: passingAxes({
      workers: [
        { name: 'media-worker', ok: false, reason: 'GIT_SHA 불일치' },
        { name: 'ai-worker', ok: true, reason: null },
      ],
    }),
    runId: 'r1',
  });
  assert.equal(result.rollback, true);
  assert.ok(result.reasons.some((r) => r.includes('media-worker')));
});

test('축4) 워커(ai-worker) SHA 대조 실패 → rollback', () => {
  const result = decideRollback({
    capture: validCapture(),
    migrationsChanged: false,
    axes: passingAxes({
      workers: [
        { name: 'media-worker', ok: true, reason: null },
        { name: 'ai-worker', ok: false, reason: 'GIT_SHA 미검출' },
      ],
    }),
    runId: 'r1',
  });
  assert.equal(result.rollback, true);
  assert.ok(result.reasons.some((r) => r.includes('ai-worker')));
});

test('⭐ 축5) 미디어 호스트 계열 실패 → rollback(네트워크 0회 판정, 결정적 오설정)', () => {
  const result = decideRollback({
    capture: validCapture(),
    migrationsChanged: false,
    axes: passingAxes({ media: hostFailureMedia(['private-host']) }),
    runId: 'r1',
  });
  assert.equal(result.rollback, true);
  assert.ok(result.reasons.some((r) => r.includes('호스트 계열')));
});

test('⭐ 축6) 미디어 도달 계열 실패 → 롤백 안 함(경보만), 그러나 anyAxisFailed=true', () => {
  const result = decideRollback({
    capture: validCapture(),
    migrationsChanged: false,
    axes: passingAxes({ media: reachFailureMedia('server_error') }),
    runId: 'r1',
  });
  assert.equal(result.rollback, false);
  assert.equal(result.escalate, '');
  assert.equal(result.anyAxisFailed, true);
  assert.equal(result.plan, null);
  assert.ok(result.reasons.some((r) => r.includes('경보만')));
});

test('⭐⭐ 미지의 미디어 실패 코드 → rollback=false + escalate="media-unknown-code"(경보만이 아니다)', () => {
  const result = decideRollback({
    capture: validCapture(),
    migrationsChanged: false,
    axes: passingAxes({ media: unknownCodeMedia('some-brand-new-code') }),
    runId: 'r1',
  });
  assert.equal(result.rollback, false);
  assert.equal(result.escalate, 'media-unknown-code');
  assert.equal(result.plan, null);
  assert.equal(result.anyAxisFailed, true);
  assert.ok(result.reasons.some((r) => r.includes('some-brand-new-code')));
});

test('⭐⭐ 미지 코드는 다른 축이 롤백을 요구해도 escalate가 이긴다(마이그레이션 미변경 시)', () => {
  const result = decideRollback({
    capture: validCapture(),
    migrationsChanged: false,
    axes: passingAxes({ apiSha: failAxis('SHA 불일치'), media: unknownCodeMedia() }),
    runId: 'r1',
  });
  assert.equal(result.rollback, false);
  assert.equal(result.escalate, 'media-unknown-code');
  assert.equal(result.plan, null);
});

test('우선순위: 마이그레이션 변경 + 미지 코드가 동시에 있으면 schema-drift가 더 우선한다', () => {
  const result = decideRollback({
    capture: validCapture(),
    migrationsChanged: true,
    axes: passingAxes({ apiSha: failAxis('SHA 불일치'), media: unknownCodeMedia() }),
    runId: 'r1',
  });
  assert.equal(result.rollback, false);
  assert.equal(result.escalate, 'schema-drift');
});

test('computeFinalVerdict: media-unknown-code escalate → ok:false(잡 red)', () => {
  const decideResult = decideRollback({
    capture: validCapture(),
    migrationsChanged: false,
    axes: passingAxes({ media: unknownCodeMedia() }),
    runId: 'r1',
  });
  const v = computeFinalVerdict({ decideResult });
  assert.equal(v.ok, false);
});

test('empty-feed(media.ok=true) → 실패 취급하지 않음(기존 계약 유지)', () => {
  const result = decideRollback({
    capture: validCapture(),
    migrationsChanged: false,
    axes: passingAxes({ media: emptyFeedMedia() }),
    runId: 'r1',
  });
  assert.equal(result.rollback, false);
  assert.equal(result.anyAxisFailed, false);
});

test('⭐⭐ 우선 규칙: 마이그레이션 변경 있음 + api SHA 실패 → rollback=false + escalate="schema-drift"', () => {
  const result = decideRollback({
    capture: validCapture(),
    migrationsChanged: true,
    axes: passingAxes({ apiSha: failAxis('SHA 불일치') }),
    runId: 'r1',
  });
  assert.equal(result.rollback, false);
  assert.equal(result.escalate, 'schema-drift');
  assert.equal(result.plan, null);
});

test('⭐⭐ 우선 규칙: 마이그레이션 변경 있음 + 미디어 호스트 계열 실패(다른 축) → 여전히 escalate="schema-drift"', () => {
  const result = decideRollback({
    capture: validCapture(),
    migrationsChanged: true,
    axes: passingAxes({ media: hostFailureMedia(['loopback-host']) }),
    runId: 'r1',
  });
  assert.equal(result.rollback, false);
  assert.equal(result.escalate, 'schema-drift');
});

test('마이그레이션 변경 있음 + 6축 전부 통과 → escalate 없음(되돌릴 실패가 없다)', () => {
  const result = decideRollback({ capture: validCapture(), migrationsChanged: true, axes: passingAxes(), runId: 'r1' });
  assert.equal(result.rollback, false);
  assert.equal(result.escalate, '');
});

test('마이그레이션 변경 있음 + 도달 계열(경보만) 실패 → escalate 없음(롤백 자체가 필요 없었다)', () => {
  const result = decideRollback({
    capture: validCapture(),
    migrationsChanged: true,
    axes: passingAxes({ media: reachFailureMedia('timeout') }),
    runId: 'r1',
  });
  assert.equal(result.rollback, false);
  assert.equal(result.escalate, '');
  assert.equal(result.anyAxisFailed, true);
});

test('decideRollback: capture.ok!==true면 throw', () => {
  const badCapture = buildCapture('api|x|y|z');
  assert.throws(() => decideRollback({ capture: badCapture, migrationsChanged: false, axes: passingAxes(), runId: 'r1' }));
});

test('decideRollback: 알 수 없는 mode는 throw', () => {
  assert.throws(() =>
    decideRollback({ capture: validCapture(), migrationsChanged: false, axes: passingAxes(), runId: 'r1', mode: 'yolo' }),
  );
});

test('decideRollback: mode="enforce" + rollback true → enforce:true / mode(기본 report) → enforce:false', () => {
  const enforceResult = decideRollback({
    capture: validCapture(),
    migrationsChanged: false,
    axes: passingAxes({ apiSha: failAxis() }),
    runId: 'r1',
    mode: 'enforce',
  });
  assert.equal(enforceResult.enforce, true);

  const reportResult = decideRollback({
    capture: validCapture(),
    migrationsChanged: false,
    axes: passingAxes({ apiSha: failAxis() }),
    runId: 'r1',
  });
  assert.equal(reportResult.mode, DEFAULT_ROLLBACK_MODE);
  assert.equal(reportResult.enforce, false);
});

// ═══════════════════════════════════════════════════════════════════════════════════
// computeFinalVerdict — 롤백 성공을 초록으로 덮지 않는다
// ═══════════════════════════════════════════════════════════════════════════════════

test('computeFinalVerdict: 전 축 통과(rollback=false,escalate="",anyAxisFailed=false) → ok:true', () => {
  const decideResult = decideRollback({ capture: validCapture(), migrationsChanged: false, axes: passingAxes(), runId: 'r1' });
  const v = computeFinalVerdict({ decideResult });
  assert.equal(v.ok, true);
});

test('⭐⭐ computeFinalVerdict: 롤백 수행 시 ok:true가 아니다(재검증 통과해도 뒤집히지 않는다)', () => {
  const decideResult = decideRollback({
    capture: validCapture(),
    migrationsChanged: false,
    axes: passingAxes({ apiSha: failAxis() }),
    runId: 'r1',
  });
  const vNoReverify = computeFinalVerdict({ decideResult });
  assert.equal(vNoReverify.ok, false);

  const vReverifyOk = computeFinalVerdict({ decideResult, reverify: { ok: true, reason: '복구 확인' } });
  assert.equal(vReverifyOk.ok, false, '롤백 성공(재검증 통과)이 exit을 초록으로 덮으면 안 된다');
});

test('computeFinalVerdict: 롤백 후 재검증 실패 → ok:false + 사유에 재검증 실패 포함', () => {
  const decideResult = decideRollback({
    capture: validCapture(),
    migrationsChanged: false,
    axes: passingAxes({ apiSha: failAxis() }),
    runId: 'r1',
  });
  const v = computeFinalVerdict({ decideResult, reverify: { ok: false, reason: '롤백 이미지도 SHA 불일치' } });
  assert.equal(v.ok, false);
  assert.ok(v.reasons.some((r) => r.includes('재검증 실패')));
});

test('computeFinalVerdict: escalate만 있어도(rollback=false) ok:false', () => {
  const decideResult = decideRollback({
    capture: validCapture(),
    migrationsChanged: true,
    axes: passingAxes({ apiSha: failAxis() }),
    runId: 'r1',
  });
  assert.equal(decideResult.rollback, false);
  assert.equal(decideResult.escalate, 'schema-drift');
  const v = computeFinalVerdict({ decideResult });
  assert.equal(v.ok, false);
});

test('computeFinalVerdict: 도달 계열 경보만(rollback=false, anyAxisFailed=true) → ok:false(초록 아님)', () => {
  const decideResult = decideRollback({
    capture: validCapture(),
    migrationsChanged: false,
    axes: passingAxes({ media: reachFailureMedia('forbidden') }),
    runId: 'r1',
  });
  const v = computeFinalVerdict({ decideResult });
  assert.equal(v.ok, false);
});

// ═══════════════════════════════════════════════════════════════════════════════════
// formatRecoveryRunbook
// ═══════════════════════════════════════════════════════════════════════════════════

test('formatRecoveryRunbook: 3서비스 참조·GIT_SHA + IMAGE_TAG export 포함 완전한 명령을 담는다', () => {
  const runbook = formatRecoveryRunbook({ capture: validCapture(), runId: 'run99' });
  for (const svc of REQUIRED_SERVICES) {
    assert.ok(runbook.includes(svc), `${svc} 참조 누락`);
  }
  assert.match(runbook, /export IMAGE_TAG=rollback-run99/);
  assert.match(runbook, /GIT_SHA=`1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b`/);
});

// ═══════════════════════════════════════════════════════════════════════════════════
// CLI(fail-closed) 통합
// ═══════════════════════════════════════════════════════════════════════════════════

function runCli(args) {
  try {
    const stdout = execFileSync('node', [SCRIPT_PATH, ...args], { encoding: 'utf8' });
    return { code: 0, stdout, stderr: '' };
  } catch (err) {
    return { code: err.status ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

test('CLI: 알 수 없는 서브커맨드 → exit 1', () => {
  const { code, stderr } = runCli(['bogus']);
  assert.equal(code, 1);
  assert.match(stderr, /알 수 없는 서브커맨드/);
});

test('CLI capture: 정상 입력 → exit 0 + json-out 파일 기록', () => {
  const inputPath = writeTemp('drb-capture-', 'raw.txt', VALID_RAW_CAPTURE);
  const outPath = join(inputPath, '..', 'capture.json');
  const { code, stdout } = runCli(['capture', '--input', inputPath, '--run-id', 'run1', '--json-out', outPath]);
  assert.equal(code, 0, stdout);
  const json = JSON.parse(readFileSync(outPath, 'utf8'));
  assert.equal(json.ok, true);
  assert.equal(json.runId, 'run1');
});

test('⭐ CLI capture: 서비스 결손 입력 → exit 1(무인 배포 금지)', () => {
  const twoLines = VALID_RAW_CAPTURE.split('\n').slice(0, 2).join('\n');
  const inputPath = writeTemp('drb-capture-bad-', 'raw.txt', twoLines);
  const { code, stderr } = runCli(['capture', '--input', inputPath]);
  assert.equal(code, 1);
  assert.match(stderr, /서비스 결손/);
});

test('CLI plan: capture-file + run-id → remoteCommand에 IMAGE_TAG export 포함', () => {
  const capturePath = writeTemp('drb-plan-', 'capture.json', JSON.stringify(validCapture()));
  const { code, stdout } = runCli(['plan', '--capture-file', capturePath, '--run-id', 'runXYZ']);
  assert.equal(code, 0, stdout);
  assert.match(stdout, /export IMAGE_TAG=rollback-runXYZ/);
});

test('⭐ CLI decide: --migrations-file 누락 → exit 1(변경 없음도 명시적 빈 파일이어야 함)', () => {
  const capturePath = writeTemp('drb-decide-nomig-', 'capture.json', JSON.stringify(validCapture()));
  const { code, stderr } = runCli([
    'decide',
    '--capture-file',
    capturePath,
    '--run-id',
    'r1',
    '--api-sha-status',
    'ok',
    '--routes-status',
    'ok',
    '--media-worker-sha-status',
    'ok',
    '--ai-worker-sha-status',
    'ok',
  ]);
  assert.equal(code, 1);
  assert.match(stderr, /--migrations-file/);
});

test('CLI decide: capture 파일이 ok:false면 exit 1', () => {
  const badCapture = buildCapture('api|x|y|z');
  const dir = makeTmpDir('drb-decide-badcap-');
  const capturePath = join(dir, 'capture.json');
  writeFileSync(capturePath, JSON.stringify(badCapture));
  const migPath = join(dir, 'mig.txt');
  writeFileSync(migPath, '');
  const { code, stderr } = runCli([
    'decide',
    '--capture-file',
    capturePath,
    '--migrations-file',
    migPath,
    '--run-id',
    'r1',
    '--api-sha-status',
    'ok',
    '--routes-status',
    'ok',
    '--media-worker-sha-status',
    'ok',
    '--ai-worker-sha-status',
    'ok',
  ]);
  assert.equal(code, 1);
  assert.match(stderr, /유효하지 않은 복구 지점/);
});

test('CLI decide: 잘못된 --api-sha-status 값(ok|fail 아님) → exit 1', () => {
  const dir = makeTmpDir('drb-decide-badstatus-');
  const capturePath = join(dir, 'capture.json');
  writeFileSync(capturePath, JSON.stringify(validCapture()));
  const migPath = join(dir, 'mig.txt');
  writeFileSync(migPath, '');
  const { code, stderr } = runCli([
    'decide',
    '--capture-file',
    capturePath,
    '--migrations-file',
    migPath,
    '--run-id',
    'r1',
    '--api-sha-status',
    'maybe',
    '--routes-status',
    'ok',
    '--media-worker-sha-status',
    'ok',
    '--ai-worker-sha-status',
    'ok',
  ]);
  assert.equal(code, 1);
  assert.match(stderr, /ok\|fail/);
});

test('CLI decide → verdict 전체 체인: 라우트 실패 시 exit 1 + 런북 출력', () => {
  const dir = makeTmpDir('drb-chain-fail-');
  const capturePath = join(dir, 'capture.json');
  writeFileSync(capturePath, JSON.stringify(validCapture()));
  const migPath = join(dir, 'mig.txt');
  writeFileSync(migPath, '');
  const decidePath = join(dir, 'decide.json');

  const decideOut = runCli([
    'decide',
    '--capture-file',
    capturePath,
    '--migrations-file',
    migPath,
    '--run-id',
    'runChain',
    '--api-sha-status',
    'ok',
    '--routes-status',
    'fail',
    '--routes-reason',
    'HTTP 404',
    '--media-worker-sha-status',
    'ok',
    '--ai-worker-sha-status',
    'ok',
    '--json-out',
    decidePath,
  ]);
  assert.equal(decideOut.code, 0, decideOut.stdout); // decide 자체는 실행 성공 = exit 0
  const decideJson = JSON.parse(readFileSync(decidePath, 'utf8'));
  assert.equal(decideJson.rollback, true);

  const verdictOut = runCli(['verdict', '--decide-file', decidePath, '--capture-file', capturePath, '--run-id', 'runChain']);
  assert.equal(verdictOut.code, 1, verdictOut.stdout);
  assert.match(verdictOut.stdout, /export IMAGE_TAG=rollback-runChain/);
  assert.match(verdictOut.stdout, /판정: FAIL/);
});

test('CLI decide → verdict 전체 체인: 전 축 통과 시 exit 0', () => {
  const dir = makeTmpDir('drb-chain-pass-');
  const capturePath = join(dir, 'capture.json');
  writeFileSync(capturePath, JSON.stringify(validCapture()));
  const migPath = join(dir, 'mig.txt');
  writeFileSync(migPath, '');
  const decidePath = join(dir, 'decide.json');

  runCli([
    'decide',
    '--capture-file',
    capturePath,
    '--migrations-file',
    migPath,
    '--run-id',
    'runOk',
    '--api-sha-status',
    'ok',
    '--routes-status',
    'ok',
    '--media-worker-sha-status',
    'ok',
    '--ai-worker-sha-status',
    'ok',
    '--json-out',
    decidePath,
  ]);

  const verdictOut = runCli(['verdict', '--decide-file', decidePath, '--capture-file', capturePath, '--run-id', 'runOk']);
  assert.equal(verdictOut.code, 0, verdictOut.stdout);
  assert.match(verdictOut.stdout, /판정: PASS/);
});
