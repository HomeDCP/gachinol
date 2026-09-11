// infra/scripts/reporter-app-thinness-gate.test.mjs
// 동반 의무 D1(대장 #173+#188) 단위 테스트 — "apps/reporter/app/**가 기준선보다 커지면 잡는가"를
// fail-closed로 확인한다.
//
// ⭐ 핵심은 "#173이 다시 일어나면(app/**에 로직이 다시 유입되면) 이 검사가 잡는가"다 — 아래
// "#173 재현" 블록이 그 증거다: 얇은 상태(기준선)에서 로직이 인라인으로 다시 들어와 줄 수가
// 늘어난 픽스처를 구성하고 judgeFile/checkReporterApp이 그것을 위반으로 잡는지 확인한다.
//
// ⚠️ 루트 `package.json`의 `test:scripts`에 이 파일을 등재해야 한다 — 잊으면
// `daejang-recheck.test.mjs`의 self-check(test:scripts 등재 검사)가 레드로 잡는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  countLines,
  findGrowthEntry,
  judgeFile,
  findStaleGrowthEntries,
  findReporterAppFiles,
  checkReporterApp,
  APP_LINE_BASELINE,
  NEW_FILE_FREE_LINES,
} from './reporter-app-thinness-gate.mjs';

const SCRIPT_PATH = fileURLToPath(new URL('./reporter-app-thinness-gate.mjs', import.meta.url));
// 본 스크립트(reporter-app-thinness-gate.mjs)와 동일한 계산 방식 — trailing slash 관례 불일치로
// relFile 슬라이스가 어긋나는 것을 피한다.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** 본 스크립트의 relFile 계산과 동일(§ checkReporterApp) — 테스트에서도 같은 방식으로 재현 */
function relFileOf(abs) {
  return abs.slice(REPO_ROOT.length + 1).split(sep).join('/');
}

// ── countLines ───────────────────────────────────────────────────────────────

test('countLines: 트레일링 개행 1개는 줄로 세지 않는다', () => {
  assert.equal(countLines('a\nb\nc\n'), 3);
  assert.equal(countLines('a\nb\nc'), 3); // 개행 없이 끝나도 동일
});

test('countLines: 빈 파일은 0', () => {
  assert.equal(countLines(''), 0);
  assert.equal(countLines('\n'), 0);
});

test('countLines: 빈 줄도 센다', () => {
  assert.equal(countLines('a\n\nb\n'), 3);
});

// ── findGrowthEntry ──────────────────────────────────────────────────────────

test('findGrowthEntry: file 정확 일치만 찾는다', () => {
  const allowlist = [{ file: 'apps/reporter/app/x.tsx', upToLines: 100, reason: 'x' }];
  assert.equal(findGrowthEntry(allowlist, 'apps/reporter/app/x.tsx')?.upToLines, 100);
  assert.equal(findGrowthEntry(allowlist, 'apps/reporter/app/y.tsx'), undefined);
});

// ── judgeFile — 순수 판정 ───────────────────────────────────────────────────────

test('judgeFile: 기준선 이내면 통과', () => {
  const r = judgeFile(
    { relFile: 'apps/reporter/app/a.tsx', actualLines: 50 },
    { 'apps/reporter/app/a.tsx': 50 },
    [],
  );
  assert.equal(r.ok, true);
  assert.equal(r.effectiveCeiling, 50);
  assert.equal(r.viaAllowlist, false);
});

test('[#173 재현] judgeFile: 기준선을 넘으면(로직이 인라인으로 다시 들어와 줄 수가 늘면) 위반', () => {
  // 기준선 50줄이던 화면이 (가상의) 유령 미디어 방어 로직을 다시 인라인으로 흡수해 70줄이 됐다고
  // 가정 — 허용목록 등재 없이는 통과할 수 없어야 한다.
  const r = judgeFile(
    { relFile: 'apps/reporter/app/a.tsx', actualLines: 70 },
    { 'apps/reporter/app/a.tsx': 50 },
    [],
  );
  assert.equal(r.ok, false);
  assert.match(r.reason, /기준\(50줄\) 초과/);
});

test('judgeFile: 미등재(신규) 파일은 NEW_FILE_FREE_LINES가 기준', () => {
  const okSmall = judgeFile(
    { relFile: 'apps/reporter/app/new.tsx', actualLines: NEW_FILE_FREE_LINES },
    {},
    [],
  );
  assert.equal(okSmall.ok, true);
  assert.equal(okSmall.baseCeiling, NEW_FILE_FREE_LINES);

  const failBig = judgeFile(
    { relFile: 'apps/reporter/app/new.tsx', actualLines: NEW_FILE_FREE_LINES + 1 },
    {},
    [],
  );
  assert.equal(failBig.ok, false);
});

test('judgeFile: GROWTH_ALLOWLIST에 의미 있는 사유로 upToLines가 있으면 그 값이 기준을 대체한다', () => {
  const allowlist = [
    { file: 'apps/reporter/app/a.tsx', upToLines: 80, reason: '새 재시도 UI 상태 3종 추가 — 대장 #999 검토' },
  ];
  const r = judgeFile(
    { relFile: 'apps/reporter/app/a.tsx', actualLines: 70 },
    { 'apps/reporter/app/a.tsx': 50 },
    allowlist,
  );
  assert.equal(r.ok, true);
  assert.equal(r.effectiveCeiling, 80);
  assert.equal(r.viaAllowlist, true);
});

test('judgeFile: 허용목록에 있어도 사유가 무의미(규율 21)하면 위반으로 취급 — "있는 척" 방지', () => {
  const allowlist = [{ file: 'apps/reporter/app/a.tsx', upToLines: 80, reason: '-' }];
  const r = judgeFile(
    { relFile: 'apps/reporter/app/a.tsx', actualLines: 70 },
    { 'apps/reporter/app/a.tsx': 50 },
    allowlist,
  );
  assert.equal(r.ok, false);
  assert.match(r.reason, /사유가 무의미함/);
});

test('judgeFile: upToLines가 기준선보다 작거나 같으면 완화 효과가 없다(방어적)', () => {
  const allowlist = [
    { file: 'apps/reporter/app/a.tsx', upToLines: 50, reason: '의미 있어 보이는 문자열이지만 무의미한 완화' },
  ];
  const r = judgeFile(
    { relFile: 'apps/reporter/app/a.tsx', actualLines: 60 },
    { 'apps/reporter/app/a.tsx': 50 },
    allowlist,
  );
  assert.equal(r.ok, false);
  assert.equal(r.effectiveCeiling, 50); // upToLines(50)가 baseCeiling(50)을 못 넘어 무시된다
});

// ── findStaleGrowthEntries — 허용목록 부패 방지 ──────────────────────────────────

test('findStaleGrowthEntries: 실측이 기준선보다 여전히 크면(완화가 필요) 사용 중', () => {
  const allowlist = [{ file: 'apps/reporter/app/a.tsx', upToLines: 80, reason: 'x' }];
  const stale = findStaleGrowthEntries(allowlist, { 'apps/reporter/app/a.tsx': 70 }, { 'apps/reporter/app/a.tsx': 50 });
  assert.deepEqual(stale, []);
});

test('findStaleGrowthEntries: 실측이 원 기준선 이하로 돌아오면 죽은 엔트리', () => {
  const allowlist = [{ file: 'apps/reporter/app/a.tsx', upToLines: 80, reason: 'x' }];
  const stale = findStaleGrowthEntries(allowlist, { 'apps/reporter/app/a.tsx': 40 }, { 'apps/reporter/app/a.tsx': 50 });
  assert.equal(stale.length, 1);
  assert.equal(stale[0].file, 'apps/reporter/app/a.tsx');
});

test('findStaleGrowthEntries: 파일이 사라졌으면(실측 없음) 죽은 엔트리', () => {
  const allowlist = [{ file: 'apps/reporter/app/deleted.tsx', upToLines: 80, reason: 'x' }];
  const stale = findStaleGrowthEntries(allowlist, {}, {});
  assert.equal(stale.length, 1);
});

// ── 픽스처 리포 헬퍼 ─────────────────────────────────────────────────────────────

function withFixtureRepo(build, run) {
  const dir = mkdtempSync(join(tmpdir(), 'reporter-app-thinness-gate-'));
  try {
    build(dir);
    return run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function writeAppFile(repoRoot, relDir, fileName, lineCount) {
  const fullDir = join(repoRoot, 'apps', 'reporter', 'app', relDir);
  mkdirSync(fullDir, { recursive: true });
  const content = Array.from({ length: lineCount }, (_, i) => `// line ${i}`).join('\n') + '\n';
  writeFileSync(join(fullDir, fileName), content, 'utf8');
}

// ── findReporterAppFiles ─────────────────────────────────────────────────────

test('findReporterAppFiles: apps/reporter/app 아래 *.ts(x)만 재귀 수집', () => {
  withFixtureRepo(
    (root) => {
      writeAppFile(root, '.', 'index.tsx', 10);
      writeAppFile(root, 'contents/new', 'index.tsx', 10);
      writeAppFile(root, '.', 'README.md', 5); // .md는 대상 아님(확장자 필터)
    },
    (root) => {
      const files = findReporterAppFiles(root);
      assert.equal(files.length, 2);
      assert.ok(files.every((f) => f.endsWith('.tsx')));
    },
  );
});

test('findReporterAppFiles: apps/reporter/app이 없으면 빈 배열', () => {
  withFixtureRepo(
    (root) => mkdirSync(root, { recursive: true }),
    (root) => assert.deepEqual(findReporterAppFiles(root), []),
  );
});

// ── checkReporterApp ─────────────────────────────────────────────────────────

test('checkReporterApp: apps/reporter/app이 없으면 fail-closed(빈 배열이 아니라 명시적 실패)', () => {
  withFixtureRepo(
    (root) => mkdirSync(root, { recursive: true }),
    (root) => {
      const outcome = checkReporterApp(root, {}, []);
      assert.equal(outcome.ok, false);
      assert.match(outcome.reason, /하나도 찾지 못했다/);
    },
  );
});

test('checkReporterApp: 기준선과 실측이 일치하면 통과', () => {
  withFixtureRepo(
    (root) => writeAppFile(root, '.', 'index.tsx', 10),
    (root) => {
      const outcome = checkReporterApp(root, { 'apps/reporter/app/index.tsx': 10 }, []);
      assert.equal(outcome.ok, true);
      assert.equal(outcome.results.length, 1);
    },
  );
});

test('[#173 재현] checkReporterApp: 얇던 화면이 로직 유입으로 커지면 잡는다(허용목록 없이는 통과 불가)', () => {
  withFixtureRepo(
    (root) => writeAppFile(root, 'contents/new', 'index.tsx', 40), // 기준선(20)보다 20줄 더 큼
    (root) => {
      const outcome = checkReporterApp(root, { 'apps/reporter/app/contents/new/index.tsx': 20 }, []);
      assert.equal(outcome.ok, false);
      assert.equal(outcome.results[0].ok, false);
      assert.match(outcome.results[0].reason, /src\/로 로직을 빼거나/);
    },
  );
});

test('checkReporterApp: 죽은 GROWTH_ALLOWLIST 엔트리가 있으면 나머지가 전부 통과해도 fail', () => {
  withFixtureRepo(
    (root) => writeAppFile(root, '.', 'index.tsx', 10),
    (root) => {
      const allowlist = [{ file: 'apps/reporter/app/index.tsx', upToLines: 50, reason: '더 이상 필요 없음' }];
      const outcome = checkReporterApp(root, { 'apps/reporter/app/index.tsx': 10 }, allowlist);
      assert.equal(outcome.ok, false); // 실측(10)이 기준선(10) 이하라 완화가 불필요 — 죽은 엔트리
      assert.equal(outcome.staleGrowthEntries.length, 1);
    },
  );
});

// ── 실제 리포 — 기준선 자기검증(baseline drift 방지) ─────────────────────────────

test('APP_LINE_BASELINE: 실 리포의 apps/reporter/app 파일 집합과 정확히 일치한다(드리프트 방지)', () => {
  const actualFiles = findReporterAppFiles(REPO_ROOT).map(relFileOf);
  const baselineFiles = Object.keys(APP_LINE_BASELINE).sort();
  assert.deepEqual(
    actualFiles.sort(),
    baselineFiles,
    '파일이 추가/삭제됐는데 APP_LINE_BASELINE이 갱신되지 않았다(--print-baseline으로 재대조)',
  );
});

test('APP_LINE_BASELINE: 등재값이 실측 줄 수와 정확히 일치한다(스냅샷이므로 과대·과소 모두 드리프트)', () => {
  for (const abs of findReporterAppFiles(REPO_ROOT)) {
    const relFile = relFileOf(abs);
    const actual = countLines(readFileSync(abs, 'utf8'));
    assert.equal(
      APP_LINE_BASELINE[relFile],
      actual,
      `${relFile}: 기준선(${APP_LINE_BASELINE[relFile]}) != 실측(${actual})`,
    );
  }
});

// ── CLI(fail-closed) 통합 — 실제 리포 대상 ───────────────────────────────────────

function runCli(extraArgs = []) {
  try {
    const stdout = execFileSync('node', [SCRIPT_PATH, ...extraArgs], { encoding: 'utf8' });
    return { code: 0, stdout };
  } catch (err) {
    return { code: err.status ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

test('CLI: 현재 리포 상태는 exit 0(apps/reporter/app 18개 파일 전부 기준선 이내)', () => {
  const { code, stdout } = runCli();
  assert.equal(code, 0);
  assert.match(stdout, /판정: PASS/);
  assert.match(stdout, /18개 파일 전부 기준선 이내/);
});

test('[#173 재현] CLI: --repo-root로 로직-유입 픽스처를 가리키면 exit 1 + 위반 메시지', () => {
  withFixtureRepo(
    (root) => writeAppFile(root, 'contents/new', 'index.tsx', 999),
    (root) => {
      const { code, stderr } = runCli(['--repo-root', root]);
      assert.equal(code, 1);
      assert.match(stderr, /contents\/new\/index\.tsx: 999줄/);
    },
  );
});

test('CLI: --print-baseline은 실측치만 출력하고 exit 0(정본 대조용, 게이트 판정과 무관)', () => {
  const { code, stdout } = runCli(['--print-baseline']);
  assert.equal(code, 0);
  assert.match(stdout, /apps\/reporter\/app\/_layout\.tsx/);
});
