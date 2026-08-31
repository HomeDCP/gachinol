// infra/scripts/verify-deployed-sha.test.mjs
// `node --test infra/scripts/` (Node 내장 테스트러너, 신규 의존 0). 루트 `pnpm test:scripts`와
// `.github/workflows/ci.yml`이 이 파일을 돈다 — infra/scripts/ 자체는 turbo 파이프라인 밖이라
// 이 축을 열지 않으면 이 스크립트가 "검사에 닿지 않는" 결함(대장 #186이 닫으려는 것과 동형)을
// 새로 만든다.
//
// ⚠️ 루트 `package.json`의 `test:scripts`는 `infra/scripts/*.test.mjs` glob이 아니라
// **이 파일을 명시적으로 나열**한다. 이유: zsh는 unmatched glob에서 즉시 에러(fail-closed)지만,
// GitHub Actions 러너 기본 셸인 bash는 매치 실패 시 glob 문자열을 리터럴 그대로 넘기고, 그걸
// Node 내장 테스트러너가 **자체 glob으로 재해석**해 `0 tests, 0 pass, exit 0`으로 통과시킨다
// (fail-open). 즉 이 파일이 리네임·삭제되면 CI가 "검사를 안 도는데 초록"이 되는, `DISCIPLINES.md`
// §21이 금지한 "초록·존재를 구동의 증거로 삼지 마라" 유형의 구멍이 조용히 열린다.
// ⚠️ **"명시 나열이면 파일이 없을 때 MODULE_NOT_FOUND로 즉시 죽어 fail-closed"는 거짓이었다**
// (2026-09-01 게이트② 검증에서 반증). `node --test <있는 파일> <없는 파일>`처럼 **한 `--test`
// 호출에 인자를 여러 개 나열**하면, 없는 파일은 경고 0건으로 조용히 무시되고 있는 파일의
// 테스트만 돌며 **exit 0**이 된다(3회 재현, 순서 무관). Node가 즉시 죽는 것은 인자가 **1개뿐일
// 때**뿐이다. → **지금 fail-closed의 실제 근거는 `test:scripts`가 이 파일과
// `daejang-recheck.test.mjs`를 `node --test <파일 1개>` 형태로 **개별 호출**해 `&&`로 연결하는
// 것**(인자 1개 보장)**이며, 새 테스트 파일 추가를 잊는 반대 방향은
// `daejang-recheck.test.mjs`의 "test:scripts 등재 self-check" 테스트가 잡는다.**
// → **테스트 파일을 추가/리네임할 때는 루트 `package.json`의 `test:scripts`도 함께 고쳐야 한다**
//   (잊어도 위 self-check가 레드로 잡는다).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractSha } from './verify-deployed-sha.mjs';

const SCRIPT_PATH = fileURLToPath(new URL('./verify-deployed-sha.mjs', import.meta.url));

// ── extractSha (순수 함수) ───────────────────────────────────────────────────

test('web: 정상 추출', () => {
  const html =
    '<!DOCTYPE html><html><head><title>t</title>' +
    '<meta name="build-sha" content="abc1234"></head><body></body></html>';
  assert.equal(extractSha('web', html), 'abc1234');
});

test('api: 정상 추출', () => {
  assert.equal(extractSha('api', JSON.stringify({ sha: 'def5678' })), 'def5678');
});

test('web: meta 부재', () => {
  const html = '<head><title>no build-sha meta</title></head>';
  assert.equal(extractSha('web', html), null);
});

test('api: sha 필드 부재', () => {
  assert.equal(extractSha('api', JSON.stringify({ status: 'ok' })), null);
});

test('api: JSON 파싱 실패', () => {
  assert.equal(extractSha('api', 'not-json-at-all'), null);
});

test('api: sha가 문자열이 아니면 부재로 취급', () => {
  assert.equal(extractSha('api', JSON.stringify({ sha: 123 })), null);
});

test('web: 속성 순서 변형(content가 name보다 먼저)', () => {
  const html = '<head><meta content="ghi9012" name="build-sha"></head>';
  assert.equal(extractSha('web', html), 'ghi9012');
});

test('web: 태그·속성 대소문자 변형', () => {
  const html = '<HEAD><META NAME="build-sha" CONTENT="jkl3456"></HEAD>';
  assert.equal(extractSha('web', html), 'jkl3456');
});

test('web: 작은따옴표 속성값도 인식', () => {
  const html = "<head><meta name='build-sha' content='mno7890'></head>";
  assert.equal(extractSha('web', html), 'mno7890');
});

test('web: name은 build-sha이나 content 속성 자체가 없으면 미검출', () => {
  const html = '<head><meta name="build-sha"></head>';
  assert.equal(extractSha('web', html), null);
});

test('web: 다른 이름의 meta는 무시하고 build-sha만 뽑는다', () => {
  const html =
    '<head><meta name="description" content="not-a-sha">' +
    '<meta name="build-sha" content="pqr1122"></head>';
  assert.equal(extractSha('web', html), 'pqr1122');
});

test('불일치 판정 — 호출자가 expect와 비교', () => {
  const actual = extractSha('api', JSON.stringify({ sha: 'aaa111' }));
  assert.notEqual(actual, 'bbb222');
});

test('알 수 없는 kind는 예외를 던진다', () => {
  assert.throws(() => extractSha('bogus', '{}'));
});

// ── CLI(fail-closed) 통합 — --body-file 경로만(네트워크 없이 재현 가능) ─────────

function withTempFile(content, run) {
  const dir = mkdtempSync(join(tmpdir(), 'verify-sha-'));
  const file = join(dir, 'body.txt');
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

test('CLI: web 일치 시 exit 0', () => {
  const html = '<head><meta name="build-sha" content="deadbeef"></head>';
  withTempFile(html, (file) => {
    const { code, stdout } = runCli(['--kind', 'web', '--expect', 'deadbeef', '--body-file', file]);
    assert.equal(code, 0);
    assert.match(stdout, /SHA 일치 확인/);
  });
});

test('CLI: api 불일치 시 exit 1', () => {
  withTempFile(JSON.stringify({ sha: 'aaa' }), (file) => {
    const { code, stderr } = runCli(['--kind', 'api', '--expect', 'bbb', '--body-file', file]);
    assert.equal(code, 1);
    assert.match(stderr, /SHA 불일치/);
  });
});

test('CLI: meta 부재 시 exit 1(fail-closed)', () => {
  withTempFile('<head><title>x</title></head>', (file) => {
    const { code, stderr } = runCli(['--kind', 'web', '--expect', 'deadbeef', '--body-file', file]);
    assert.equal(code, 1);
    assert.match(stderr, /SHA 미검출/);
  });
});

test('CLI: --url/--body-file 둘 다 없으면 exit 1', () => {
  const { code, stderr } = runCli(['--kind', 'web', '--expect', 'deadbeef']);
  assert.equal(code, 1);
  assert.match(stderr, /--url 또는 --body-file/);
});

test('CLI: 존재하지 않는 --body-file은 exit 1(요청 실패 취급)', () => {
  const { code, stderr } = runCli([
    '--kind',
    'api',
    '--expect',
    'deadbeef',
    '--body-file',
    '/no/such/file/on/purpose.json',
  ]);
  assert.equal(code, 1);
  assert.match(stderr, /본문 로드 실패/);
});
