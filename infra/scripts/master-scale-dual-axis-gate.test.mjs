// infra/scripts/master-scale-dual-axis-gate.test.mjs
// 동반 의무 D1-c(대장 #240·#241) 단위 테스트 — "마스터 스케일 식이 단일축 캡으로 퇴행하면
// 이 게이트가 잡는가"를 fail-closed로 확인한다.
//
// ⭐ 핵심은 "#240이 다시 일어나면(마스터 스케일 식이 다시 긴 변/짧은 변 중 한쪽만 캡하면) 이
// 검사가 잡는가"다 — 아래 "[양성]" 케이스가 그 증거다: 단일축 캡 픽스처를 구성하고 게이트가
// 그것을 위반으로 잡는지 확인한다. 실 리포를 스캔해 통과하는 것만 보는 테스트는 자기기만이라
// 그것만으로 끝내지 않는다(위임 지시 4-4·asset-selector-uniqueness.test.mjs와 동형 관례).
//
// ⚠️ 루트 `package.json`의 `test:scripts`에 이 파일을 등재해야 한다 — 잊으면
// `daejang-recheck.test.mjs`의 self-check(test:scripts 등재 검사)가 레드로 잡는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  findScaleDefinitions,
  checkMasterScaleDualAxis,
  SCALE_TARGET_FILE,
  ALLOWLISTED_SCALE_FUNCTIONS,
} from './master-scale-dual-axis-gate.mjs';

const SCRIPT_PATH = fileURLToPath(new URL('./master-scale-dual-axis-gate.mjs', import.meta.url));
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// ── 픽스처 리포 헬퍼 ─────────────────────────────────────────────────────────────

function withFixtureRepo(build, run) {
  const dir = mkdtempSync(join(tmpdir(), 'master-scale-gate-'));
  try {
    build(dir);
    return run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function writeTargetFile(repoRoot, content) {
  const fullPath = join(repoRoot, ...SCALE_TARGET_FILE.split('/'));
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content, 'utf8');
}

// ── findScaleDefinitions — 순수 판정 ────────────────────────────────────────────

test('findScaleDefinitions: 단일축(min(ih만)) 정의를 dualAxis=false로 잡는다', () => {
  const defs = findScaleDefinitions(
    "export function transcode(input, output, opts) {\n" +
      "  const x = `-vf scale=-2:'min(ih,${opts.height})'`;\n" +
      '}\n',
  );
  assert.equal(defs.length, 1);
  assert.equal(defs[0].functionName, 'transcode');
  assert.equal(defs[0].dualAxis, false);
});

test('findScaleDefinitions: 같은 줄에 min(iw...와 min(ih...가 함께 있으면 dualAxis=true', () => {
  const defs = findScaleDefinitions(
    'export function autoEdit(input, output, opts) {\n' +
      "  const scale = `scale=w='min(iw,X)':h='min(ih,Y)'`;\n" +
      '}\n',
  );
  assert.equal(defs.length, 1);
  assert.equal(defs[0].functionName, 'autoEdit');
  assert.equal(defs[0].dualAxis, true);
});

test('findScaleDefinitions: 주석 줄(// 또는 * 시작)의 scale= 언급은 정의로 잡지 않는다(오탐 방지)', () => {
  const defs = findScaleDefinitions(
    '/**\n' +
      ' * H.264/AAC 트랜스코딩 — scale=-2:min(ih,H)(짝수 보정)\n' +
      ' */\n' +
      '// scale=1920:1080 같은 하드코딩은 금지\n' +
      'export function noop() {}\n',
  );
  assert.deepEqual(defs, []);
});

test('findScaleDefinitions: 함수 경계를 정확히 추적한다(여러 함수, 순서 무관 재확인)', () => {
  const defs = findScaleDefinitions(
    'function armWatchdog() {}\n' +
      'export function transcode(opts) {\n' +
      "  const a = `-vf scale=-2:'min(ih,${opts.height})'`;\n" +
      '}\n' +
      'export function preview(opts) {\n' +
      "  const b = `-vf scale=-2:'min(ih,${opts.maxHeight})'`;\n" +
      '}\n',
  );
  assert.equal(defs.length, 2);
  assert.equal(defs[0].functionName, 'transcode');
  assert.equal(defs[1].functionName, 'preview');
});

test('findScaleDefinitions: 함수 선언 이전(module-level)의 정의는 (module-level)로 표기한다', () => {
  const defs = findScaleDefinitions("const x = `scale=-2:'min(ih,720)'`;\n");
  assert.equal(defs.length, 1);
  assert.equal(defs[0].functionName, '(module-level)');
});

// ── checkMasterScaleDualAxis — 통합 판정 ─────────────────────────────────────────

test('checkMasterScaleDualAxis: 대상 파일이 없으면 fail-closed(명시적 실패, 빈 배열 아님)', () => {
  withFixtureRepo(
    (root) => mkdirSync(root, { recursive: true }),
    (root) => {
      const outcome = checkMasterScaleDualAxis(root);
      assert.equal(outcome.ok, false);
      assert.equal(outcome.definitionsScanned, 0);
      assert.match(outcome.reason, /찾지 못했다/);
    },
  );
});

test('checkMasterScaleDualAxis: 대상 파일에 scale= 정의가 0건이면 fail-closed', () => {
  withFixtureRepo(
    (root) => writeTargetFile(root, 'export function noop() {}\n'),
    (root) => {
      const outcome = checkMasterScaleDualAxis(root);
      assert.equal(outcome.ok, false);
      assert.equal(outcome.definitionsScanned, 0);
      assert.match(outcome.reason, /정의를 하나도 찾지 못했다/);
    },
  );
});

// ★ 양성 케이스 — allowlist 밖 함수(autoEdit)가 단일축으로 퇴행하면 게이트가 실제로 실패한다
// (대장 #240 재발 방지의 핵심 증거). ⚠️ 위반 **1건뿐**이어도 red여야 한다.
test('[양성] checkMasterScaleDualAxis: 마스터(autoEdit)가 단일축 캡으로 퇴행하면 위반 1건으로 잡는다', () => {
  withFixtureRepo(
    (root) =>
      writeTargetFile(
        root,
        'export function transcode(opts) {\n' +
          "  const a = `-vf scale=-2:'min(ih,${opts.height})'`;\n" +
          '}\n' +
          'export function autoEdit(opts) {\n' +
          // ⚠️ 이게 #240 버그 그 자체(舊 단일 height 캡)다 — 퇴행 시나리오
          "  const scale = `scale=-2:'min(ih,${opts.height})'`;\n" +
          '}\n' +
          'export function preview(opts) {\n' +
          "  const b = `-vf scale=-2:'min(ih,${opts.maxHeight})'`;\n" +
          '}\n' +
          'export function thumbnail(opts) {\n' +
          "  const c = `-vf scale=${opts.width}:-2`;\n" +
          '}\n',
      ),
    (root) => {
      const outcome = checkMasterScaleDualAxis(root);
      assert.equal(outcome.ok, false);
      assert.equal(outcome.definitionsScanned, 4);
      // transcode·preview·thumbnail은 allowlist라 위반에서 빠지고, autoEdit 1건만 남는다.
      assert.equal(outcome.violations.length, 1);
      assert.equal(outcome.violations[0].functionName, 'autoEdit');
    },
  );
});

// ★ 음성 케이스 — 마스터가 dualAxis면(allowlist 3건 + 마스터 정상) 전부 통과한다
test('[음성] checkMasterScaleDualAxis: 마스터가 회전 대칭(dualAxis)이면 allowlist 3건과 함께 통과한다', () => {
  withFixtureRepo(
    (root) =>
      writeTargetFile(
        root,
        'export function transcode(opts) {\n' +
          "  const a = `-vf scale=-2:'min(ih,${opts.height})'`;\n" +
          '}\n' +
          'export function autoEdit(opts) {\n' +
          "  const scale = `scale=w='min(iw,X)':h='min(ih,Y)'`;\n" +
          '}\n' +
          'export function preview(opts) {\n' +
          "  const b = `-vf scale=-2:'min(ih,${opts.maxHeight})'`;\n" +
          '}\n' +
          'export function thumbnail(opts) {\n' +
          "  const c = `-vf scale=${opts.width}:-2`;\n" +
          '}\n',
      ),
    (root) => {
      const outcome = checkMasterScaleDualAxis(root);
      assert.equal(outcome.ok, true);
      assert.equal(outcome.violations.length, 0);
      assert.equal(outcome.definitionsScanned, 4);
    },
  );
});

test('checkMasterScaleDualAxis: SCALE_TARGET_FILE 상수가 실제 리포 파일 경로와 일치한다(드리프트 방지)', () => {
  assert.equal(SCALE_TARGET_FILE, 'services/media-worker/src/ffmpeg.ts');
});

test('ALLOWLISTED_SCALE_FUNCTIONS: 정확히 transcode·preview·thumbnail 3건, 각각 사유 문자열이 비어있지 않다', () => {
  const keys = Object.keys(ALLOWLISTED_SCALE_FUNCTIONS).sort();
  assert.deepEqual(keys, ['preview', 'thumbnail', 'transcode']);
  for (const k of keys) {
    assert.ok(ALLOWLISTED_SCALE_FUNCTIONS[k].length > 0, `${k} 사유가 비어있다`);
  }
  // 마스터(autoEdit)는 allowlist에 없어야 한다 — 있으면 퇴행을 조용히 허용하게 된다.
  assert.ok(!('autoEdit' in ALLOWLISTED_SCALE_FUNCTIONS));
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

test('CLI: 현재 리포 상태는 exit 0(마스터가 회전 대칭 캡, 나머지 3건은 사유 명시 allowlist)', () => {
  const { code, stdout } = runCli();
  assert.equal(code, 0);
  assert.match(stdout, /판정: PASS/);
  assert.match(stdout, /위반 0건/);
});

// ★ 양성 케이스(CLI 경로) — --repo-root로 퇴행 픽스처를 가리키면 exit 1 + 위반 메시지
test('[양성] CLI: --repo-root로 단일축 퇴행 픽스처를 가리키면 exit 1 + 위반 메시지', () => {
  withFixtureRepo(
    (root) =>
      writeTargetFile(
        root,
        'export function autoEdit(opts) {\n' +
          "  const scale = `scale=-2:'min(ih,${opts.height})'`;\n" +
          '}\n',
      ),
    (root) => {
      const { code, stderr } = runCli(['--repo-root', root]);
      assert.equal(code, 1);
      assert.match(stderr, /ffmpeg\.ts:2/);
      assert.match(stderr, /autoEdit/);
    },
  );
});

test('CLI: 대상 파일 없음(services/media-worker/src/ffmpeg.ts 부재)이면 exit 1', () => {
  withFixtureRepo(
    (root) => mkdirSync(root, { recursive: true }),
    (root) => {
      const { code, stderr } = runCli(['--repo-root', root]);
      assert.equal(code, 1);
      assert.match(stderr, /찾지 못했다/);
    },
  );
});

// ── 실 리포 자기검증 ────────────────────────────────────────────────────────────

test('실 리포: ffmpeg.ts에서 스케일 정의 4건(transcode·autoEdit·preview·thumbnail)을 찾는다', () => {
  const content = execFileSync('cat', [join(REPO_ROOT, ...SCALE_TARGET_FILE.split('/'))], {
    encoding: 'utf8',
  });
  const defs = findScaleDefinitions(content);
  assert.equal(defs.length, 4);
  assert.deepEqual(
    defs.map((d) => d.functionName),
    ['transcode', 'autoEdit', 'preview', 'thumbnail'],
  );
  const master = defs.find((d) => d.functionName === 'autoEdit');
  assert.equal(master.dualAxis, true, '마스터(autoEdit)는 반드시 dualAxis여야 한다(대장 #240)');
});
