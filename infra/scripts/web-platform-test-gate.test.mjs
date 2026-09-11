// infra/scripts/web-platform-test-gate.test.mjs
// 동반 의무 D1(QUEUE 2-2, 대장 #178) 단위 테스트 — "새 .web.* 파일이 웹 축 테스트 없이 조용히
// 추가되면 이 검사가 잡는가"를 fail-closed로 확인한다.
//
// ⭐ 핵심은 "#178이 다시 일어나면(웹 테스트 없는 .web.* 파일이 다시 유입되면) 이 검사가 잡는가"다
// — 아래 "[#178 재현]" 블록이 그 증거다.
//
// ⚠️ 루트 package.json의 test:scripts에 이 파일을 등재해야 한다 — 잊으면
// daejang-recheck.test.mjs의 self-check(test:scripts 등재 검사)가 레드로 잡는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  bareModuleName,
  appOf,
  dirOf,
  isUnderJestScannableRoot,
  JEST_WEB_TESTMATCH_ROOT_SEGMENT,
  extractImportSpecifiers,
  importsBareModule,
  findAllowlistEntry,
  judgeWebPlatformFile,
  findDeadAllowlistEntries,
  findWebPlatformFiles,
  isWebTestScriptWired,
  readSiblingWebTestContents,
  checkRepo,
} from './web-platform-test-gate.mjs';

const SCRIPT_PATH = fileURLToPath(new URL('./web-platform-test-gate.mjs', import.meta.url));
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// ── bareModuleName ───────────────────────────────────────────────────────────

test('bareModuleName: .web.ts/.web.tsx/.web.js/.web.jsx 접미사를 뗀다', () => {
  assert.equal(bareModuleName('register-service-worker.web.ts'), 'register-service-worker');
  assert.equal(bareModuleName('hls-video.web.tsx'), 'hls-video');
  assert.equal(bareModuleName('foo.web.js'), 'foo');
  assert.equal(bareModuleName('foo.web.jsx'), 'foo');
});

// ── appOf ────────────────────────────────────────────────────────────────────

test('appOf: apps/<app>/... 형태에서 app 이름을 뽑는다', () => {
  assert.equal(appOf('apps/reporter/src/upload/http-upload-service.web.ts'), 'reporter');
  assert.equal(appOf('apps/subscriber/src/live/hls-video.web.tsx'), 'subscriber');
});

test('appOf: apps/ 바깥 경로는 null', () => {
  assert.equal(appOf('packages/ui/src/foo.web.ts'), null);
  assert.equal(appOf('apps'), null);
});

// ── dirOf ────────────────────────────────────────────────────────────────────

test('dirOf: 마지막 세그먼트를 제외한 부모 디렉터리', () => {
  assert.equal(dirOf('apps/reporter/src/upload/http-upload-service.web.ts'), 'apps/reporter/src/upload');
  assert.equal(dirOf('foo.web.ts'), '');
});

// ── isUnderJestScannableRoot (2026-09-12 게이트② 우회 보강) ─────────────────────

test('isUnderJestScannableRoot: apps/<app>/src/ 아래면 true', () => {
  assert.equal(
    isUnderJestScannableRoot(`apps/reporter/${JEST_WEB_TESTMATCH_ROOT_SEGMENT}/upload/foo.web.ts`),
    true,
  );
});

test('[게이트② 우회 재현] isUnderJestScannableRoot: apps/<app>/app/ 아래면 false(jest testMatch가 절대 스캔하지 않는 위치)', () => {
  assert.equal(isUnderJestScannableRoot('apps/reporter/app/foo/bar.web.ts'), false);
});

test('isUnderJestScannableRoot: apps/ 바깥이면 false', () => {
  assert.equal(isUnderJestScannableRoot('packages/ui/src/foo.web.ts'), false);
});

test('isUnderJestScannableRoot: app 세그먼트만 있고 그 아래가 없으면(apps/reporter) false', () => {
  assert.equal(isUnderJestScannableRoot('apps/reporter'), false);
});

// ── extractImportSpecifiers ──────────────────────────────────────────────────

test('extractImportSpecifiers: import from과 require() 양쪽을 잡는다', () => {
  const content = `
    import { createResidentUploader } from '../uploader';
    import type { ApiClient } from '../../api/client';
    const x = require('../foo');
  `;
  assert.deepEqual(extractImportSpecifiers(content), ['../uploader', '../../api/client', '../foo']);
});

test('extractImportSpecifiers: import/require가 없으면 빈 배열', () => {
  assert.deepEqual(extractImportSpecifiers('const x = 1;'), []);
});

// ── importsBareModule ────────────────────────────────────────────────────────

test('importsBareModule: 접미사 없는 상대경로 import가 있으면 true', () => {
  const content = `import { createHttpUploadService } from '../http-upload-service';`;
  assert.equal(importsBareModule(content, 'http-upload-service'), true);
});

test('[해소 판정 A 대응] importsBareModule: 명시 .web 접미사 import는 매칭하지 않는다', () => {
  const content = `import { createHttpUploadService } from '../http-upload-service.web';`;
  assert.equal(importsBareModule(content, 'http-upload-service'), false);
});

test('importsBareModule: 패키지 import(상대경로 아님)는 매칭하지 않는다', () => {
  const content = `import { http-upload-service } from 'http-upload-service';`;
  assert.equal(importsBareModule(content, 'http-upload-service'), false);
});

test('importsBareModule: require()도 매칭한다', () => {
  const content = `const svc = require('../uploader');`;
  assert.equal(importsBareModule(content, 'uploader'), true);
});

test('importsBareModule: 다른 이름의 import만 있으면 false', () => {
  const content = `import { foo } from '../bar';`;
  assert.equal(importsBareModule(content, 'uploader'), false);
});

// ── findAllowlistEntry ───────────────────────────────────────────────────────

test('findAllowlistEntry: file 정확 일치만 찾는다', () => {
  const allowlist = [{ file: 'apps/x/src/y.web.ts', reason: 'x' }];
  assert.equal(findAllowlistEntry(allowlist, 'apps/x/src/y.web.ts')?.reason, 'x');
  assert.equal(findAllowlistEntry(allowlist, 'apps/x/src/z.web.ts'), undefined);
});

// ── judgeWebPlatformFile — 순수 판정 ─────────────────────────────────────────

test('judgeWebPlatformFile: apps/ 바깥 파일은 허용목록 없이 위반', () => {
  const r = judgeWebPlatformFile(
    { relFile: 'packages/ui/src/foo.web.ts', wired: false, testFileContents: [] },
    [],
  );
  assert.equal(r.ok, false);
  assert.match(r.reason, /apps\/<app>\/ 바깥/);
});

test('judgeWebPlatformFile: wired=false면 위반', () => {
  const r = judgeWebPlatformFile(
    { relFile: 'apps/reporter/src/upload/foo.web.ts', wired: false, testFileContents: [] },
    [],
  );
  assert.equal(r.ok, false);
  assert.match(r.reason, /jest\.web\.config\.js/);
});

test('[게이트② 우회 재현, 2026-09-12] judgeWebPlatformFile: wired=true + 접미사 없는 진짜 import가 있어도 app/ 아래면 위반', () => {
  // 최초 버전이 놓친 우회 경로 그대로 — .web.* 파일이 apps/<app>/app/ 아래(jest testMatch가
  // 스캔하지 않는 위치)에 있고, 그 옆 __web_tests__에 완벽한 접미사 없는 import(④를 만족)가
  // 있어도 위치(③)에서 먼저 걸려야 한다. 이 테스트가 red가 되면(=ok:true가 나오면) 우회가
  // 다시 열린 것이다.
  const r = judgeWebPlatformFile(
    {
      relFile: 'apps/reporter/app/foo/bar.web.ts',
      wired: true,
      testFileContents: [`import { bar } from '../bar';`], // 접미사 없음 — ④는 만족
    },
    [],
  );
  assert.equal(r.ok, false);
  assert.match(r.reason, /apps\/reporter\/src\//);
  assert.match(r.reason, /testMatch/);
  // 위반 메시지가 "무엇을 어떻게"를 말하는가 — src/로 옮기거나 testMatch를 넓히라는 두 remediation
  assert.match(r.reason, /옮기거나/);
  assert.match(r.reason, /넓혀야 한다/);
});

test('judgeWebPlatformFile: wired=true인데 접미사 없는 import를 아무 테스트도 안 하면 위반', () => {
  const r = judgeWebPlatformFile(
    {
      relFile: 'apps/reporter/src/upload/foo.web.ts',
      wired: true,
      testFileContents: [`import { bar } from '../bar';`],
    },
    [],
  );
  assert.equal(r.ok, false);
  assert.match(r.reason, /__web_tests__/);
});

test('[#178 재현] judgeWebPlatformFile: wired=true + 접미사 있는 import만 있으면(명시 .web) 여전히 위반', () => {
  const r = judgeWebPlatformFile(
    {
      relFile: 'apps/reporter/src/upload/foo.web.ts',
      wired: true,
      testFileContents: [`import { createFoo } from '../foo.web';`], // 명시 접미사 — 판정 불충족
    },
    [],
  );
  assert.equal(r.ok, false);
});

test('judgeWebPlatformFile: wired=true + 접미사 없는 import가 있으면 통과', () => {
  const r = judgeWebPlatformFile(
    {
      relFile: 'apps/reporter/src/upload/foo.web.ts',
      wired: true,
      testFileContents: [`import { createFoo } from '../foo';`],
    },
    [],
  );
  assert.equal(r.ok, true);
  assert.equal(r.viaAllowlist, false);
});

test('judgeWebPlatformFile: 허용목록에 의미 있는 사유로 등재돼 있으면 통과', () => {
  const allowlist = [
    {
      file: 'apps/reporter/src/upload/foo.web.ts',
      reason: '웹 테스트 인프라 구축 전 임시 예외 — 대장 #999에서 후속 처리 예정(사유는 이 정도 길이)',
    },
  ];
  const r = judgeWebPlatformFile(
    { relFile: 'apps/reporter/src/upload/foo.web.ts', wired: false, testFileContents: [] },
    allowlist,
  );
  assert.equal(r.ok, true);
  assert.equal(r.viaAllowlist, true);
});

test('judgeWebPlatformFile: 허용목록에 있어도 사유가 무의미(규율 21)하면 위반 — "있는 척" 방지', () => {
  const allowlist = [{ file: 'apps/reporter/src/upload/foo.web.ts', reason: '-' }];
  const r = judgeWebPlatformFile(
    { relFile: 'apps/reporter/src/upload/foo.web.ts', wired: false, testFileContents: [] },
    allowlist,
  );
  assert.equal(r.ok, false);
  assert.match(r.reason, /사유가 무의미함/);
});

// ── findDeadAllowlistEntries — 허용목록 부패 방지 ────────────────────────────────

test('findDeadAllowlistEntries: 파일이 사라졌으면 죽은 엔트리', () => {
  const allowlist = [{ file: 'apps/reporter/src/upload/gone.web.ts', reason: '한때 필요했던 사유(충분히 긺)' }];
  const dead = findDeadAllowlistEntries(allowlist, []);
  assert.equal(dead.length, 1);
});

test('findDeadAllowlistEntries: 파일이 허용목록 없이도 이미 통과하면 죽은 엔트리', () => {
  const allowlist = [{ file: 'apps/reporter/src/upload/foo.web.ts', reason: '한때 필요했던 사유(충분히 긺)' }];
  const fileInputs = [
    {
      relFile: 'apps/reporter/src/upload/foo.web.ts',
      wired: true,
      testFileContents: [`import { createFoo } from '../foo';`],
    },
  ];
  const dead = findDeadAllowlistEntries(allowlist, fileInputs);
  assert.equal(dead.length, 1);
});

test('findDeadAllowlistEntries: 파일이 여전히 허용목록 없이는 위반이면 살아있는 엔트리', () => {
  const allowlist = [{ file: 'apps/reporter/src/upload/foo.web.ts', reason: '여전히 필요한 사유(충분히 긺)' }];
  const fileInputs = [
    { relFile: 'apps/reporter/src/upload/foo.web.ts', wired: false, testFileContents: [] },
  ];
  const dead = findDeadAllowlistEntries(allowlist, fileInputs);
  assert.deepEqual(dead, []);
});

// ── 픽스처 리포 헬퍼 ─────────────────────────────────────────────────────────────

function withFixtureRepo(build, run) {
  const dir = mkdtempSync(join(tmpdir(), 'web-platform-test-gate-'));
  try {
    build(dir);
    return run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function writeFile(repoRoot, relPath, content) {
  const full = join(repoRoot, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content, 'utf8');
}

function scaffoldWiredApp(repoRoot, app) {
  writeFile(repoRoot, `apps/${app}/jest.web.config.js`, `module.exports = {};\n`);
  writeFile(
    repoRoot,
    `apps/${app}/package.json`,
    JSON.stringify({ name: `@gachinol/${app}`, scripts: { test: 'jest', 'test:web': 'jest --config jest.web.config.js' } }),
  );
}

// ── findWebPlatformFiles ─────────────────────────────────────────────────────

test('findWebPlatformFiles: .web.ts(x)/.web.js(x)만 재귀 수집하고 node_modules는 건너뛴다', () => {
  withFixtureRepo(
    (root) => {
      writeFile(root, 'apps/reporter/src/upload/foo.web.ts', '');
      writeFile(root, 'apps/subscriber/src/live/bar.web.tsx', '');
      writeFile(root, 'apps/reporter/src/upload/foo.ts', ''); // .web 아님 — 대상 아님
      writeFile(root, 'node_modules/some-pkg/dist/baz.web.js', ''); // node_modules — 제외
    },
    (root) => {
      const files = findWebPlatformFiles(root);
      assert.equal(files.length, 2);
      assert.ok(files.every((f) => !f.includes('node_modules')));
    },
  );
});

test('findWebPlatformFiles: 대상이 없으면 빈 배열', () => {
  withFixtureRepo(
    (root) => mkdirSync(root, { recursive: true }),
    (root) => assert.deepEqual(findWebPlatformFiles(root), []),
  );
});

// ── isWebTestScriptWired ─────────────────────────────────────────────────────

test('isWebTestScriptWired: jest.web.config.js + package.json test:web 스크립트 둘 다 있으면 true', () => {
  withFixtureRepo(
    (root) => scaffoldWiredApp(root, 'reporter'),
    (root) => assert.equal(isWebTestScriptWired(root, 'reporter'), true),
  );
});

test('isWebTestScriptWired: jest.web.config.js가 없으면 false', () => {
  withFixtureRepo(
    (root) =>
      writeFile(root, 'apps/reporter/package.json', JSON.stringify({ scripts: { 'test:web': 'jest' } })),
    (root) => assert.equal(isWebTestScriptWired(root, 'reporter'), false),
  );
});

test('isWebTestScriptWired: test:web 스크립트가 없으면 false', () => {
  withFixtureRepo(
    (root) => {
      writeFile(root, 'apps/reporter/jest.web.config.js', 'module.exports = {};\n');
      writeFile(root, 'apps/reporter/package.json', JSON.stringify({ scripts: { test: 'jest' } }));
    },
    (root) => assert.equal(isWebTestScriptWired(root, 'reporter'), false),
  );
});

test('isWebTestScriptWired: package.json이 깨진 JSON이면 false(예외로 죽지 않는다)', () => {
  withFixtureRepo(
    (root) => {
      writeFile(root, 'apps/reporter/jest.web.config.js', 'module.exports = {};\n');
      writeFile(root, 'apps/reporter/package.json', '{ not valid json');
    },
    (root) => assert.equal(isWebTestScriptWired(root, 'reporter'), false),
  );
});

// ── readSiblingWebTestContents ───────────────────────────────────────────────

test('readSiblingWebTestContents: 같은 디렉터리 __web_tests__ 하위 *.test.ts(x) 원문을 읽는다', () => {
  withFixtureRepo(
    (root) => {
      writeFile(root, 'apps/reporter/src/upload/foo.web.ts', 'export {};\n');
      writeFile(
        root,
        'apps/reporter/src/upload/__web_tests__/foo.test.ts',
        `import { x } from '../foo';\n`,
      );
    },
    (root) => {
      const contents = readSiblingWebTestContents(join(root, 'apps/reporter/src/upload/foo.web.ts'));
      assert.equal(contents.length, 1);
      assert.match(contents[0], /from '\.\.\/foo'/);
    },
  );
});

test('readSiblingWebTestContents: __web_tests__ 디렉터리가 없으면 빈 배열', () => {
  withFixtureRepo(
    (root) => writeFile(root, 'apps/reporter/src/upload/foo.web.ts', ''),
    (root) => {
      const contents = readSiblingWebTestContents(join(root, 'apps/reporter/src/upload/foo.web.ts'));
      assert.deepEqual(contents, []);
    },
  );
});

// ── checkRepo ─────────────────────────────────────────────────────────────────

test('checkRepo: .web.* 파일이 없으면 fail-closed(빈 배열이 아니라 명시적 실패)', () => {
  withFixtureRepo(
    (root) => mkdirSync(root, { recursive: true }),
    (root) => {
      const outcome = checkRepo(root, []);
      assert.equal(outcome.ok, false);
      assert.match(outcome.reason, /하나도 찾지 못했다/);
    },
  );
});

test('checkRepo: 배선된 .web.* 파일은 통과', () => {
  withFixtureRepo(
    (root) => {
      scaffoldWiredApp(root, 'reporter');
      writeFile(root, 'apps/reporter/src/upload/foo.web.ts', 'export {};\n');
      writeFile(
        root,
        'apps/reporter/src/upload/__web_tests__/foo.test.ts',
        `import { createFoo } from '../foo';\n`,
      );
    },
    (root) => {
      const outcome = checkRepo(root, []);
      assert.equal(outcome.ok, true);
      assert.equal(outcome.results.length, 1);
      assert.equal(outcome.results[0].ok, true);
    },
  );
});

test('[게이트② 우회 재현, 2026-09-12] checkRepo: app/ 아래 .web.* + 완벽한 sibling __web_tests__는 여전히 위반이다', () => {
  // 검증자가 픽스처로 실증한 정확한 시나리오: .web.* 파일과 접미사 없는 진짜 import를 가진
  // __web_tests__를 apps/reporter/app/ 아래(jest testMatch가 스캔하지 않는 위치)에 둔다. 최초
  // 버전은 이걸 PASS로 오판했다(같은 디렉터리에 __web_tests__가 있고 import가 맞으면 무조건
  // 통과였기 때문) — 이 테스트가 그 회귀를 막는다.
  withFixtureRepo(
    (root) => {
      scaffoldWiredApp(root, 'reporter');
      writeFile(root, 'apps/reporter/app/foo/bar.web.ts', 'export function bar() { return 1; }\n');
      writeFile(
        root,
        'apps/reporter/app/foo/__web_tests__/bar.test.ts',
        `import { bar } from '../bar';\ntest('x', () => { bar(); });\n`,
      );
    },
    (root) => {
      const outcome = checkRepo(root, []);
      assert.equal(outcome.ok, false);
      assert.equal(outcome.results.length, 1);
      assert.equal(outcome.results[0].ok, false);
      assert.match(outcome.results[0].reason, /apps\/reporter\/src\//);
    },
  );
});

test('[#178 재현] checkRepo: 웹 테스트 배선 없는 새 .web.* 파일은 허용목록 없이 통과할 수 없다', () => {
  withFixtureRepo(
    (root) => {
      scaffoldWiredApp(root, 'reporter');
      // 웹 테스트 없이 .web.ts만 슬쩍 추가된 상황(#178이 다시 일어나는 경우)
      writeFile(root, 'apps/reporter/src/upload/sneaky.web.ts', 'export {};\n');
    },
    (root) => {
      const outcome = checkRepo(root, []);
      assert.equal(outcome.ok, false);
      assert.equal(outcome.results[0].ok, false);
    },
  );
});

test('checkRepo: 죽은 허용목록 엔트리가 있으면 나머지가 전부 통과해도 fail', () => {
  withFixtureRepo(
    (root) => {
      scaffoldWiredApp(root, 'reporter');
      writeFile(root, 'apps/reporter/src/upload/foo.web.ts', 'export {};\n');
      writeFile(
        root,
        'apps/reporter/src/upload/__web_tests__/foo.test.ts',
        `import { createFoo } from '../foo';\n`,
      );
    },
    (root) => {
      const allowlist = [
        { file: 'apps/reporter/src/upload/foo.web.ts', reason: '더 이상 필요 없는 옛 사유(충분히 긺)' },
      ];
      const outcome = checkRepo(root, allowlist);
      assert.equal(outcome.ok, false); // foo.web.ts는 허용목록 없이도 통과 — 죽은 엔트리
      assert.equal(outcome.deadAllowlistEntries.length, 1);
    },
  );
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

test('CLI: 현재 리포 상태는 exit 0(.web.* 4개 파일 전부 웹 축 테스트 배선 확인)', () => {
  const { code, stdout } = runCli();
  assert.equal(code, 0);
  assert.match(stdout, /판정: PASS/);
  assert.match(stdout, /\.web\.\* 파일 4개 전부/);
});

test('[#178 재현] CLI: --repo-root로 웹 테스트 없는 .web.* 픽스처를 가리키면 exit 1 + 위반 메시지', () => {
  withFixtureRepo(
    (root) => {
      scaffoldWiredApp(root, 'reporter');
      writeFile(root, 'apps/reporter/src/upload/sneaky.web.ts', 'export {};\n');
    },
    (root) => {
      const { code, stderr } = runCli(['--repo-root', root]);
      assert.equal(code, 1);
      assert.match(stderr, /sneaky\.web\.ts/);
    },
  );
});

test('CLI: apps/reporter·apps/subscriber 모두 jest.web.config.js 파일명이 .web.js로 끝나지 않아 자기 자신을 오탐하지 않는다', () => {
  // 실측: 최초 jest.config.web.js로 만들었을 때 이 CLI가 그 설정 파일 자신을 위반으로 잡았다
  // (파일명이 리터럴 '.web.js'로 끝났기 때문). jest.web.config.js로 리네임해 근본 해소했다 —
  // 이 테스트는 그 회귀를 막는다.
  const { stdout } = runCli();
  assert.doesNotMatch(stdout, /jest\.web\.config\.js: /);
});

test('[게이트② 우회 재현, 2026-09-12] CLI: app/ 아래 .web.* + 완벽한 sibling __web_tests__를 --repo-root로 가리키면 exit 1 + 이동 지시 메시지', () => {
  withFixtureRepo(
    (root) => {
      scaffoldWiredApp(root, 'reporter');
      writeFile(root, 'apps/reporter/app/foo/bar.web.ts', 'export function bar() { return 1; }\n');
      writeFile(
        root,
        'apps/reporter/app/foo/__web_tests__/bar.test.ts',
        `import { bar } from '../bar';\ntest('x', () => { bar(); });\n`,
      );
    },
    (root) => {
      const { code, stderr } = runCli(['--repo-root', root]);
      assert.equal(code, 1);
      assert.match(stderr, /bar\.web\.ts/);
      // 위반 메시지가 "무엇을 어떻게"까지 말해야 한다 — src/로 옮기라는 지시와 testMatch를
      // 넓히라는 대안 둘 다 CLI 출력에 그대로 노출돼야 한다(위임문 요구사항 ②).
      assert.match(stderr, /apps\/reporter\/src\//);
      assert.match(stderr, /옮기거나/);
      assert.match(stderr, /testMatch/);
    },
  );
});

// ── JEST_WEB_TESTMATCH_ROOT_SEGMENT 자기검증 — 실제 jest.web.config.js와의 드리프트 방지 ──
// reporter-app-thinness-gate.test.mjs의 APP_LINE_BASELINE 자기검증과 동형 사상: 이 상수는
// testMatch 문자열을 파싱해서 끌어온 게 아니라 하드코딩된 미러이므로(스크립트 헤더 "판정식의
// 한계" 참조), 실제 jest.web.config.js가 그 값과 어긋나면 이 자기검증이 잡아야 한다.

test('JEST_WEB_TESTMATCH_ROOT_SEGMENT: apps/reporter·apps/subscriber의 실제 jest.web.config.js testMatch와 일치한다(드리프트 방지)', () => {
  for (const app of ['reporter', 'subscriber']) {
    const configPath = join(REPO_ROOT, 'apps', app, 'jest.web.config.js');
    const content = readFileSync(configPath, 'utf8');
    const testMatchMatch = content.match(/testMatch:\s*\[([^\]]*)\]/);
    assert.ok(testMatchMatch, `apps/${app}/jest.web.config.js에서 testMatch 배열을 찾지 못했다`);
    assert.match(
      testMatchMatch[1],
      new RegExp(`<rootDir>/${JEST_WEB_TESTMATCH_ROOT_SEGMENT}/`),
      `apps/${app}/jest.web.config.js의 testMatch가 <rootDir>/${JEST_WEB_TESTMATCH_ROOT_SEGMENT}/를 ` +
        `포함하지 않는다 — JEST_WEB_TESTMATCH_ROOT_SEGMENT 상수(web-platform-test-gate.mjs)와 실제 ` +
        `설정이 어긋났다. 둘을 같은 값으로 맞춰야 한다.`,
    );
  }
});
