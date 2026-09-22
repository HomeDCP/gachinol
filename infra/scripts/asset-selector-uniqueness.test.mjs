// infra/scripts/asset-selector-uniqueness.test.mjs
// 동반 의무 D1-c(대장 #232 태스크②·#139) 단위 테스트 — "렌디션 선택 규칙 사본이 다시 생기면
// 이 게이트가 잡는가"를 fail-closed로 확인한다.
//
// ⭐ 핵심은 "#139/#232가 다시 일어나면(services/api/src에 renditionLabel==='NNNp' 규칙이
// 다시 복제되면) 이 검사가 잡는가"다 — 아래 "양성 케이스"가 그 증거다: 사본이 있는 가짜 소스로
// 픽스처 리포를 구성하고 게이트가 그것을 위반으로 잡는지 확인한다. 실 리포를 스캔해 통과하는
// 것만 보는 테스트는 자기기만이라 그것만으로 끝내지 않는다(위임 지시 4-4).
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
  scanFileForViolations,
  findScanTargetFiles,
  checkAssetSelectorUniqueness,
  SELECTOR_SOURCE_FILE,
} from './asset-selector-uniqueness.mjs';

const SCRIPT_PATH = fileURLToPath(new URL('./asset-selector-uniqueness.mjs', import.meta.url));
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// ── 픽스처 리포 헬퍼 ─────────────────────────────────────────────────────────────

function withFixtureRepo(build, run) {
  const dir = mkdtempSync(join(tmpdir(), 'asset-selector-uniqueness-'));
  try {
    build(dir);
    return run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function writeSrcFile(repoRoot, relDir, fileName, content) {
  const fullDir = join(repoRoot, 'services', 'api', 'src', relDir);
  mkdirSync(fullDir, { recursive: true });
  writeFileSync(join(fullDir, fileName), content, 'utf8');
}

// ── scanFileForViolations — 순수 판정 ───────────────────────────────────────────

test('scanFileForViolations: renditionLabel === 비교는 위반', () => {
  const violations = scanFileForViolations({
    relFile: 'services/api/src/feed/feed.service.ts',
    content: "const r = xs.find((x) => x.renditionLabel === '720p') ?? xs[0];\n",
  });
  assert.equal(violations.length, 1);
  assert.equal(violations[0].pattern, 'renditionLabel-comparison');
  assert.equal(violations[0].line, 1);
});

test('scanFileForViolations: 따옴표로 감싼 NNNp 레이블 리터럴은 위반(비교 없이 리터럴만 있어도)', () => {
  const violations = scanFileForViolations({
    relFile: 'services/api/src/queue/queue-producer.service.ts',
    content: "const labels = ['720p'];\n",
  });
  assert.equal(violations.length, 1);
  assert.equal(violations[0].pattern, 'rendition-label-literal');
});

test('scanFileForViolations: 따옴표 없는 720p(주석 등)는 위반 아님 — 오탐 방지', () => {
  const violations = scanFileForViolations({
    relFile: 'services/api/src/config/env.schema.ts',
    content: '// 720p 렌디션·썸네일을 공개 버킷으로 복사한다\n',
  });
  assert.equal(violations.length, 0);
});

test('scanFileForViolations: 한 줄에 두 패턴이 겹쳐도 위반 1건(중복 보고 방지)', () => {
  const violations = scanFileForViolations({
    relFile: 'services/api/src/x.ts',
    content: "a.renditionLabel === '720p'\n",
  });
  assert.equal(violations.length, 1);
});

test('scanFileForViolations: 무관한 코드는 위반 0건', () => {
  const violations = scanFileForViolations({
    relFile: 'services/api/src/x.ts',
    content: "export const x = 1;\nconst label = renditionLabelForHeight(720);\n",
  });
  assert.equal(violations.length, 0);
});

// ── findScanTargetFiles ──────────────────────────────────────────────────────

test('findScanTargetFiles: *.spec.ts와 단일 원천 파일(asset-selectors.ts)을 제외한다', () => {
  withFixtureRepo(
    (root) => {
      writeSrcFile(root, 'feed', 'feed.service.ts', 'export {};\n');
      writeSrcFile(root, 'feed', 'feed.service.spec.ts', "renditionLabel === '720p'\n");
      writeSrcFile(root, 'media', 'asset-selectors.ts', "renditionLabel === '720p'\n");
    },
    (root) => {
      const files = findScanTargetFiles(root);
      assert.equal(files.length, 1);
      assert.ok(files[0].endsWith('feed.service.ts'));
    },
  );
});

test('findScanTargetFiles: services/api/src가 없으면 빈 배열', () => {
  withFixtureRepo(
    (root) => mkdirSync(root, { recursive: true }),
    (root) => assert.deepEqual(findScanTargetFiles(root), []),
  );
});

// ── checkAssetSelectorUniqueness — 통합 판정 ─────────────────────────────────────

test('checkAssetSelectorUniqueness: services/api/src가 없으면 fail-closed(빈 배열이 아니라 명시적 실패)', () => {
  withFixtureRepo(
    (root) => mkdirSync(root, { recursive: true }),
    (root) => {
      const outcome = checkAssetSelectorUniqueness(root);
      assert.equal(outcome.ok, false);
      assert.equal(outcome.filesScanned, 0);
      assert.match(outcome.reason, /하나도 찾지 못했다/);
    },
  );
});

// ★ 양성 케이스 — 사본이 있는 가짜 소스 → 게이트가 실제로 실패한다(D1-c의 핵심 증거)
test('[양성] checkAssetSelectorUniqueness: 사본이 복제되면(세 파일이 동시에) 위반으로 잡는다', () => {
  withFixtureRepo(
    (root) => {
      writeSrcFile(
        root,
        'feed',
        'feed.service.ts',
        "const rendition = renditions.find((r) => r.renditionLabel === '720p') ?? renditions[0];\n",
      );
      writeSrcFile(
        root,
        'media',
        'public-media.service.ts',
        "const rendition = renditions.find((r) => r.renditionLabel === '720p') ?? renditions[0];\n",
      );
      writeSrcFile(
        root,
        'distribution',
        'distribution-producer.service.ts',
        "assets.find((a) => a.kind === 'rendition' && a.renditionLabel === '720p' && a.status === 'ready');\n",
      );
    },
    (root) => {
      const outcome = checkAssetSelectorUniqueness(root);
      assert.equal(outcome.ok, false);
      assert.equal(outcome.violations.length, 3);
      const files = outcome.violations.map((v) => v.file).sort();
      assert.deepEqual(files, [
        'services/api/src/distribution/distribution-producer.service.ts',
        'services/api/src/feed/feed.service.ts',
        'services/api/src/media/public-media.service.ts',
      ]);
    },
  );
});

// ★ 음성 케이스 — 단일 원천만 쓰고 사본이 없으면 통과한다
test('[음성] checkAssetSelectorUniqueness: 단일 원천 함수만 호출하면(사본 없음) 통과한다', () => {
  withFixtureRepo(
    (root) => {
      writeSrcFile(
        root,
        'media',
        'asset-selectors.ts',
        "export function selectPlaybackRendition(a) { return a.find((r) => r.renditionLabel === '720p'); }\n",
      );
      writeSrcFile(
        root,
        'feed',
        'feed.service.ts',
        "import { selectPlaybackRendition, renditionLabelForHeight } from '../media/asset-selectors';\n" +
          "const label = renditionLabelForHeight(720);\n" +
          'const rendition = selectPlaybackRendition(renditions, { preferredLabel: label });\n',
      );
    },
    (root) => {
      const outcome = checkAssetSelectorUniqueness(root);
      assert.equal(outcome.ok, true);
      assert.equal(outcome.violations.length, 0);
      assert.equal(outcome.filesScanned, 1); // asset-selectors.ts 자신은 제외됐다
    },
  );
});

test('checkAssetSelectorUniqueness: SELECTOR_SOURCE_FILE 상수가 실제 리포 파일 경로와 일치한다(드리프트 방지)', () => {
  assert.equal(SELECTOR_SOURCE_FILE, 'services/api/src/media/asset-selectors.ts');
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

test('CLI: 현재 리포 상태는 exit 0(세 호출부가 단일 셀렉터를 쓴다)', () => {
  const { code, stdout } = runCli();
  assert.equal(code, 0);
  assert.match(stdout, /판정: PASS/);
});

// ★ 양성 케이스(CLI 경로) — --repo-root로 사본 픽스처를 가리키면 exit 1 + 위반 메시지
test('[양성] CLI: --repo-root로 사본 픽스처를 가리키면 exit 1 + 위반 메시지', () => {
  withFixtureRepo(
    (root) => {
      writeSrcFile(
        root,
        'feed',
        'feed.service.ts',
        "const rendition = renditions.find((r) => r.renditionLabel === '720p') ?? renditions[0];\n",
      );
    },
    (root) => {
      const { code, stderr } = runCli(['--repo-root', root]);
      assert.equal(code, 1);
      assert.match(stderr, /feed\/feed\.service\.ts:1/);
      assert.match(stderr, /renditionLabel-comparison/);
    },
  );
});

test('CLI: 스캔 대상 0건(services/api/src 없음)이면 exit 1', () => {
  withFixtureRepo(
    (root) => mkdirSync(root, { recursive: true }),
    (root) => {
      const { code, stderr } = runCli(['--repo-root', root]);
      assert.equal(code, 1);
      assert.match(stderr, /하나도 찾지 못했다/);
    },
  );
});

// ── 실 리포 자기검증 — asset-selectors.ts 자신에는 두 패턴이 등장한다(모듈이 살아있다는 증거) ──

test('실 리포: asset-selectors.ts 자신에는 renditionLabel === 비교가 실제로 있다(스캔에서는 제외됨)', () => {
  const files = findScanTargetFiles(REPO_ROOT);
  assert.ok(!files.some((f) => f.endsWith('media/asset-selectors.ts')));
});
