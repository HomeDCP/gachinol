// infra/scripts/dockerfile-workspace-deps.test.mjs
// 규율 2 기계화(대장 #161) 단위 테스트 — "package.json이 선언한 워크스페이스 의존이 Dockerfile의
// COPY에 전부 포함되는가"를 fail-closed로 잡는지 확인한다.
//
// ⭐ 핵심은 "#161이 다시 일어나면 이 검사가 잡는가"다 — 아래 "#161 사례 재현" 블록이 그 증거다:
// `@gachinol/config@workspace:*`를 api devDependencies에 추가했는데 Dockerfile COPY 목록을
// 갱신하지 않은 실제 상태를 픽스처로 재구성하고, `checkAllServices`가 그것을 누락으로 잡아내는지
// 확인한다.
//
// ⚠️ 루트 `package.json`의 `test:scripts`에 이 파일을 등재해야 한다 — 잊으면
// `daejang-recheck.test.mjs`의 self-check(test:scripts 등재 검사)가 레드로 잡는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parsePnpmWorkspaceGlobs,
  discoverWorkspacePackages,
  extractWorkspaceDeps,
  parseDockerfileCopySources,
  findMissingCopies,
  checkService,
  checkAllServices,
} from './dockerfile-workspace-deps.mjs';

const SCRIPT_PATH = fileURLToPath(new URL('./dockerfile-workspace-deps.mjs', import.meta.url));

// ── parsePnpmWorkspaceGlobs ──────────────────────────────────────────────────

test('parsePnpmWorkspaceGlobs: "<dir>/*" 항목 3개를 정상 파싱한다(이 리포의 실제 형태)', () => {
  const yaml = 'packages:\n  - "apps/*"\n  - "services/*"\n  - "packages/*"\n';
  assert.deepEqual(parsePnpmWorkspaceGlobs(yaml), ['apps', 'services', 'packages']);
});

test('parsePnpmWorkspaceGlobs: 작은따옴표·따옴표 없는 항목도 인식한다', () => {
  const yaml = "packages:\n  - 'apps/*'\n  - services/*\n";
  assert.deepEqual(parsePnpmWorkspaceGlobs(yaml), ['apps', 'services']);
});

test('parsePnpmWorkspaceGlobs: 인라인 주석은 무시한다', () => {
  const yaml = 'packages:\n  - "apps/*" # 앱\n  - "services/*"\n';
  assert.deepEqual(parsePnpmWorkspaceGlobs(yaml), ['apps', 'services']);
});

test('parsePnpmWorkspaceGlobs: 지원하지 않는 glob 패턴은 예외를 던진다(추측 파싱 금지)', () => {
  const yaml = 'packages:\n  - "apps/*"\n  - "!apps/legacy"\n';
  assert.throws(() => parsePnpmWorkspaceGlobs(yaml), /지원하지 않는 glob 패턴/);
});

test('parsePnpmWorkspaceGlobs: packages: 목록 자체가 없으면 예외를 던진다', () => {
  assert.throws(() => parsePnpmWorkspaceGlobs('name: x\nversion: 1\n'), /파싱 실패/);
});

// ── extractWorkspaceDeps ─────────────────────────────────────────────────────

test('extractWorkspaceDeps: dependencies + devDependencies 중 workspace:* 만 뽑는다', () => {
  const pkg = {
    dependencies: { '@gachinol/shared': 'workspace:*', express: '^4' },
    devDependencies: { '@gachinol/config': 'workspace:*', jest: '^29' },
  };
  const deps = extractWorkspaceDeps(pkg);
  assert.deepEqual(
    deps.map((d) => d.name),
    ['@gachinol/config', '@gachinol/shared'],
  );
  assert.equal(deps.find((d) => d.name === '@gachinol/config').field, 'devDependencies');
});

test('extractWorkspaceDeps: workspace:* 의존이 0건이면 빈 배열', () => {
  assert.deepEqual(extractWorkspaceDeps({ dependencies: { express: '^4' } }), []);
});

test('extractWorkspaceDeps: dependencies/devDependencies 필드 자체가 없어도 안전하다', () => {
  assert.deepEqual(extractWorkspaceDeps({}), []);
});

// ── parseDockerfileCopySources ───────────────────────────────────────────────

test('parseDockerfileCopySources: 매니페스트 COPY와 디렉터리 전체 COPY를 둘 다 수집한다', () => {
  const dockerfile = [
    'FROM node:24-bookworm-slim AS base',
    'COPY packages/shared/package.json packages/shared/',
    'COPY packages/config/package.json packages/config/',
    'RUN pnpm install',
    'COPY packages/shared/ packages/shared/',
  ].join('\n');
  const sources = parseDockerfileCopySources(dockerfile);
  assert.ok(sources.includes('packages/shared/package.json'));
  assert.ok(sources.includes('packages/config/package.json'));
  assert.ok(sources.includes('packages/shared/'));
});

test('parseDockerfileCopySources: --from=/--chown= 같은 플래그는 소스로 취급하지 않는다', () => {
  const dockerfile = 'COPY --from=build --chown=appuser:appuser /app/out ./\n';
  const sources = parseDockerfileCopySources(dockerfile);
  assert.deepEqual(sources, ['/app/out']);
});

test('parseDockerfileCopySources: 다중 소스 COPY(마지막 토큰만 목적지)를 지원한다', () => {
  const dockerfile = 'COPY a.json b.json c.json dest/\n';
  const sources = parseDockerfileCopySources(dockerfile);
  assert.deepEqual(sources, ['a.json', 'b.json', 'c.json']);
});

test('parseDockerfileCopySources: 주석·빈 줄은 무시한다', () => {
  const dockerfile = '# comment\n\nCOPY a.json a.json\n# COPY fake.json fake.json\n';
  const sources = parseDockerfileCopySources(dockerfile);
  assert.deepEqual(sources, ['a.json']);
});

test('parseDockerfileCopySources: 트레일링 백슬래시 줄이음을 병합한다', () => {
  const dockerfile = 'COPY a.json \\\n  b.json \\\n  dest/\n';
  const sources = parseDockerfileCopySources(dockerfile);
  assert.deepEqual(sources, ['a.json', 'b.json']);
});

test('parseDockerfileCopySources: COPY가 하나도 없으면 빈 배열', () => {
  assert.deepEqual(parseDockerfileCopySources('FROM node:24\nRUN echo hi\n'), []);
});

// ── findMissingCopies ────────────────────────────────────────────────────────

test('findMissingCopies: 매니페스트가 정확히 COPY되면 통과(누락 없음)', () => {
  const workspaceMap = { '@gachinol/config': 'packages/config' };
  const copySources = ['packages/config/package.json', 'packages/config/'];
  assert.deepEqual(findMissingCopies(['@gachinol/config'], workspaceMap, copySources), []);
});

test('findMissingCopies: 디렉터리 전체 COPY(트레일링 슬래시 없이)도 매니페스트를 커버한다', () => {
  const workspaceMap = { '@gachinol/shared': 'packages/shared' };
  const copySources = ['packages/shared']; // 트레일링 슬래시 없음
  assert.deepEqual(findMissingCopies(['@gachinol/shared'], workspaceMap, copySources), []);
});

test('findMissingCopies: COPY에 전혀 없으면 누락으로 잡는다', () => {
  const workspaceMap = { '@gachinol/config': 'packages/config' };
  const missing = findMissingCopies(['@gachinol/config'], workspaceMap, []);
  assert.equal(missing.length, 1);
  assert.equal(missing[0].dep, '@gachinol/config');
  assert.equal(missing[0].manifestPath, 'packages/config/package.json');
});

test('findMissingCopies: 워크스페이스에서 이름 자체를 못 찾으면 그것도 누락(원인 명시)', () => {
  const missing = findMissingCopies(['@gachinol/does-not-exist'], {}, ['packages/config/package.json']);
  assert.equal(missing.length, 1);
  assert.equal(missing[0].manifestPath, null);
  assert.match(missing[0].reason, /찾지 못함/);
});

// ── checkService(순수 함수 조합) ──────────────────────────────────────────────

test('checkService: 정상 케이스(현 리포 api 형태 축소판)는 ok=true', () => {
  const pkg = {
    dependencies: { '@gachinol/shared': 'workspace:*' },
    devDependencies: { '@gachinol/config': 'workspace:*' },
  };
  const dockerfile = [
    'COPY packages/shared/package.json packages/shared/',
    'COPY packages/config/package.json packages/config/',
  ].join('\n');
  const result = checkService({
    service: 'api',
    packageJsonContent: JSON.stringify(pkg),
    dockerfileContent: dockerfile,
    workspaceMap: { '@gachinol/shared': 'packages/shared', '@gachinol/config': 'packages/config' },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.missing, []);
});

// ── ⭐ #161 사례 재현 — 이 도구의 존재 이유 ─────────────────────────────────────
// 실제로 있었던 일: #122 해소가 `@gachinol/config@workspace:*`를 api의 devDependencies에
// 추가했는데 Dockerfile COPY 목록은 갱신되지 않았다(=config 매니페스트 COPY 줄이 없는 상태).
// 로컬에서 `pnpm install --frozen-lockfile --filter @gachinol/api...`을 실행하면
// `ERR_PNPM_WORKSPACE_PKG_NOT_FOUND`로 죽는 그 상태를 그대로 픽스처로 재구성한다.

test('#161 재현: config가 devDependencies에 있는데 Dockerfile COPY에 없으면 checkService가 잡는다', () => {
  const pkg = {
    name: '@gachinol/api',
    dependencies: { '@gachinol/shared': 'workspace:*' },
    devDependencies: {
      '@gachinol/config': 'workspace:*', // #122가 추가한 줄
      '@nestjs/cli': '^11',
    },
  };
  // #161 당시 Dockerfile — packages/config COPY가 통째로 빠진 상태(shared만 있음)
  const brokenDockerfile = [
    'FROM node:24-bookworm-slim AS base',
    'COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./',
    'COPY packages/shared/package.json packages/shared/',
    'COPY services/api/package.json services/api/',
    'RUN pnpm install --frozen-lockfile --filter @gachinol/api... --ignore-scripts',
  ].join('\n');

  const result = checkService({
    service: 'api',
    packageJsonContent: JSON.stringify(pkg),
    dockerfileContent: brokenDockerfile,
    workspaceMap: { '@gachinol/shared': 'packages/shared', '@gachinol/config': 'packages/config' },
  });

  assert.equal(result.ok, false, '#161과 동형인 누락 상태인데 ok=true로 판정하면 이 도구는 무의미하다');
  assert.equal(result.missing.length, 1);
  assert.equal(result.missing[0].dep, '@gachinol/config');
  assert.equal(result.missing[0].manifestPath, 'packages/config/package.json');
});

test('#161 재현 — 수리 후(실제 해소 커밋 형태): config COPY 1줄이 추가되면 통과한다', () => {
  const pkg = {
    name: '@gachinol/api',
    dependencies: { '@gachinol/shared': 'workspace:*' },
    devDependencies: { '@gachinol/config': 'workspace:*' },
  };
  const fixedDockerfile = [
    'COPY packages/shared/package.json packages/shared/',
    'COPY packages/config/package.json packages/config/', // 해소 커밋이 추가한 1줄
    'COPY services/api/package.json services/api/',
  ].join('\n');

  const result = checkService({
    service: 'api',
    packageJsonContent: JSON.stringify(pkg),
    dockerfileContent: fixedDockerfile,
    workspaceMap: { '@gachinol/shared': 'packages/shared', '@gachinol/config': 'packages/config' },
  });
  assert.equal(result.ok, true);
});

// ── discoverWorkspacePackages + checkAllServices — fs 픽스처 통합 ────────────────

function withFixtureRepo(build, run) {
  const dir = mkdtempSync(join(tmpdir(), 'dockerfile-ws-deps-'));
  try {
    build(dir);
    return run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function writePkg(repoRoot, relDir, pkgObj) {
  const fullDir = join(repoRoot, relDir);
  mkdirSync(fullDir, { recursive: true });
  writeFileSync(join(fullDir, 'package.json'), JSON.stringify(pkgObj), 'utf8');
}

function writeDockerfile(repoRoot, relDir, content) {
  const fullDir = join(repoRoot, relDir);
  mkdirSync(fullDir, { recursive: true });
  writeFileSync(join(fullDir, 'Dockerfile'), content, 'utf8');
}

test('discoverWorkspacePackages: apps/services/packages 전 구간에서 이름→디렉터리를 역해석한다', () => {
  withFixtureRepo(
    (root) => {
      writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - "apps/*"\n  - "services/*"\n  - "packages/*"\n', 'utf8');
      writePkg(root, 'packages/shared', { name: '@gachinol/shared' });
      writePkg(root, 'packages/config', { name: '@gachinol/config' });
      writePkg(root, 'services/api', { name: '@gachinol/api' });
      writePkg(root, 'apps/reporter', { name: '@gachinol/reporter' });
    },
    (root) => {
      const map = discoverWorkspacePackages(root, ['apps', 'services', 'packages']);
      assert.deepEqual(map, {
        '@gachinol/shared': 'packages/shared',
        '@gachinol/config': 'packages/config',
        '@gachinol/api': 'services/api',
        '@gachinol/reporter': 'apps/reporter',
      });
    },
  );
});

test('checkAllServices: ai-worker처럼 package.json이 없는 서비스는 건너뛴다(실패 아님)', () => {
  withFixtureRepo(
    (root) => {
      writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - "services/*"\n  - "packages/*"\n', 'utf8');
      writePkg(root, 'packages/shared', { name: '@gachinol/shared' });
      writePkg(root, 'services/api', {
        name: '@gachinol/api',
        dependencies: { '@gachinol/shared': 'workspace:*' },
      });
      writeDockerfile(root, 'services/api', 'COPY packages/shared/package.json packages/shared/\n');
      // ai-worker: package.json 없음, Dockerfile만 존재(Python)
      mkdirSync(join(root, 'services/ai-worker'), { recursive: true });
      writeFileSync(join(root, 'services/ai-worker', 'Dockerfile'), 'FROM python:3.12-slim\n', 'utf8');
    },
    (root) => {
      const outcome = checkAllServices(root);
      assert.equal(outcome.ok, true);
      assert.equal(outcome.results.length, 1);
      assert.equal(outcome.results[0].service, 'api');
      const skippedNames = outcome.skipped.map((s) => s.service);
      assert.ok(skippedNames.includes('ai-worker'));
      assert.match(outcome.skipped.find((s) => s.service === 'ai-worker').reason, /Python/);
    },
  );
});

test('checkAllServices: services/ 안에 (package.json+Dockerfile) 대상이 0건이면 fail-closed(ok=false)', () => {
  withFixtureRepo(
    (root) => {
      writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - "services/*"\n', 'utf8');
      // package.json만 있고 Dockerfile 없는 서비스 하나뿐 — 검사 대상 0건
      writePkg(root, 'services/lonely', { name: '@gachinol/lonely' });
    },
    (root) => {
      const outcome = checkAllServices(root);
      assert.equal(outcome.ok, false);
      assert.equal(outcome.results.length, 0);
      assert.match(outcome.reason, /검사 대상을 하나도 찾지 못했다/);
    },
  );
});

test('checkAllServices: services/ 디렉터리 자체가 없으면 fail-closed(ok=false)', () => {
  withFixtureRepo(
    (root) => {
      writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - "services/*"\n', 'utf8');
    },
    (root) => {
      const outcome = checkAllServices(root);
      assert.equal(outcome.ok, false);
      assert.match(outcome.reason, /services\/ 디렉터리가 없다/);
    },
  );
});

test('checkAllServices: #161 재현 — 워크스페이스 전체를 fs로 읽어도 누락을 잡는다', () => {
  withFixtureRepo(
    (root) => {
      writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - "services/*"\n  - "packages/*"\n', 'utf8');
      writePkg(root, 'packages/shared', { name: '@gachinol/shared' });
      writePkg(root, 'packages/config', { name: '@gachinol/config' });
      writePkg(root, 'services/api', {
        name: '@gachinol/api',
        dependencies: { '@gachinol/shared': 'workspace:*' },
        devDependencies: { '@gachinol/config': 'workspace:*' },
      });
      // config COPY 누락 — #161 당시 상태
      writeDockerfile(root, 'services/api', 'COPY packages/shared/package.json packages/shared/\n');
    },
    (root) => {
      const outcome = checkAllServices(root);
      assert.equal(outcome.ok, false);
      const apiResult = outcome.results.find((r) => r.service === 'api');
      assert.equal(apiResult.ok, false);
      assert.equal(apiResult.missing[0].dep, '@gachinol/config');
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

test('CLI: 현재 리포 상태는 exit 0(false positive 없음)', () => {
  const { code, stdout } = runCli();
  assert.equal(code, 0);
  assert.match(stdout, /판정: PASS/);
  assert.match(stdout, /api: 워크스페이스 의존/);
  assert.match(stdout, /media-worker: 워크스페이스 의존/);
  assert.match(stdout, /건너뜀: ai-worker/);
});

test('CLI: --repo-root로 #161 픽스처를 가리키면 exit 1이고 어느 의존이 빠졌는지 출력한다', () => {
  withFixtureRepo(
    (root) => {
      writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - "services/*"\n  - "packages/*"\n', 'utf8');
      writePkg(root, 'packages/shared', { name: '@gachinol/shared' });
      writePkg(root, 'packages/config', { name: '@gachinol/config' });
      writePkg(root, 'services/api', {
        name: '@gachinol/api',
        dependencies: { '@gachinol/shared': 'workspace:*' },
        devDependencies: { '@gachinol/config': 'workspace:*' },
      });
      writeDockerfile(root, 'services/api', 'COPY packages/shared/package.json packages/shared/\n');
    },
    (root) => {
      const { code, stderr } = runCli(['--repo-root', root]);
      assert.equal(code, 1);
      assert.match(stderr, /api: 누락/);
      assert.match(stderr, /@gachinol\/config/);
      assert.match(stderr, /packages\/config\/package\.json/);
    },
  );
});

test('CLI: --repo-root가 잘못된 pnpm-workspace.yaml을 가리키면 exit 1(파싱 실패)', () => {
  withFixtureRepo(
    (root) => {
      writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - "!weird"\n', 'utf8');
    },
    (root) => {
      const { code, stderr } = runCli(['--repo-root', root]);
      assert.equal(code, 1);
      assert.match(stderr, /검사 실행 실패/);
    },
  );
});

// 참고: 실제 Dockerfile을 일부러 망가뜨려(뮤테이션) exit 1을 확인하는 절차는 이 테스트 파일이
// 아니라 게이트①(완료 보고)에서 수동으로 실행하고 원상복구한다 — 이 파일은 fs를 건드리지 않는
// 임시 픽스처(mkdtemp)만 사용해 실제 리포에는 부수효과를 남기지 않는다.
