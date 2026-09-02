#!/usr/bin/env node
/**
 * infra/scripts/dockerfile-workspace-deps.mjs
 *
 * 규율 2 기계화(docs/plan/exec/DISCIPLINES.md #2) — "공용 패키지 신설·변경 시 그 패키지를 소비하는
 * 컨테이너 빌드 경로도 함께 갱신" 을 CI에서 fail-closed로 확인한다.
 *
 * ── 왜 있는가 (대장 #161) ────────────────────────────────────────────────────────
 * #122 해소가 `@gachinol/config@workspace:*`를 api·media-worker의 devDependencies에 추가했는데
 * 두 Dockerfile의 COPY 목록을 갱신하지 않았다. `pnpm install`(--prod 아님, --filter라도)이
 * `workspace:*` 링크를 해석하려면 그 패키지가 워크스페이스 안에 **실재**해야 하는데(package.json
 * 매니페스트가 빌드 컨텍스트 안에 없으면) `ERR_PNPM_WORKSPACE_PKG_NOT_FOUND`로 install이 죽는다.
 * 로컬 3게이트(lint/typecheck/test)는 컨테이너를 안 만드므로 **원리적으로 이 결함을 못 잡고**,
 * 프로덕션 이미지 빌드(`build-images` 워크플로)만 죽어 **3일간 배포가 막혔다**(2026-08-21~23).
 *
 * ── 검사 정의 ────────────────────────────────────────────────────────────────────
 * 각 Node 서비스(`services/*`에서 package.json이 있는 디렉터리)에 대해:
 *   1) package.json의 dependencies + devDependencies 중 `workspace:*` 스펙인 것만 추출한다.
 *   2) 각 의존 패키지명을 워크스페이스 전체(apps/*·services/*·packages/*, pnpm-workspace.yaml
 *      원천)에서 이름→디렉터리로 역해석한다.
 *   3) 그 디렉터리의 `package.json`이 서비스 Dockerfile의 COPY 소스 목록에 있는지 확인한다
 *      (정확히 `<dir>/package.json`을 복사하거나, `<dir>/`(또는 `<dir>`) 전체를 복사하면 매니페스트도
 *      함께 딸려오므로 통과로 본다 — `packages/shared`가 그 형태다: 매니페스트 COPY 1줄 + 소스
 *      전체 COPY 1줄, 둘 중 하나만 있어도 매니페스트는 커버된다).
 * 누락이 있으면 **정확히 어느 서비스의 어느 의존이 어느 Dockerfile에서 빠졌는지**를 출력하고
 * exit 1. 검사 대상(Node 서비스+Dockerfile 쌍)을 하나도 못 찾아도 exit 1(조용한 통과 금지).
 *
 * ── ai-worker(Python) 처리 ────────────────────────────────────────────────────────
 * ai-worker는 `services/ai-worker/package.json`이 없다(pnpm 워크스페이스 멤버가 아니라 Python/
 * FastAPI, 빌드 컨텍스트도 리포 루트가 아니라 `services/ai-worker` 자신 — Dockerfile 헤더 주석
 * 참조). "package.json 부재"를 곧 "Node 워크스페이스 패키지가 아님"으로 판단해 검사 대상에서
 * **명시적으로 건너뛴다**(무시가 아니라 로그에 사유를 남긴다). package.json이 없는데 workspace:*
 * 의존이 있을 수는 없으므로(둘은 같은 파일) 이 판단은 항상 안전하다.
 *
 * ── pnpm deploy 방식과의 관계 ───────────────────────────────────────────────────
 * api·media-worker 둘 다 `pnpm --filter <pkg> deploy --prod /app/out`(이식 트리 생성)을 쓴다.
 * 이 검사는 deploy 단계가 아니라 그 **앞** 단계(`pnpm install --frozen-lockfile --filter ...`)를
 * 지킨다 — install이 workspace: 링크를 못 풀면 deploy까지 갈 수도 없기 때문이다(#161이 바로
 * install 단계에서 죽었다).
 *
 * ── 지원 범위(의도적으로 좁다) ───────────────────────────────────────────────────
 * `pnpm-workspace.yaml`의 `packages:` 항목은 이 리포에서 전부 `"<dir>/*"` 형태다. 이 스크립트는
 * 그 형태만 지원하고, 다른 glob 문법(`!exclude`·`**` 등)이 추가되면 **파싱 에러로 죽는다**(추측
 * 파싱으로 조용히 틀리는 것보다 낫다 — 그때 이 스크립트를 확장해야 한다).
 *
 * ── 사용법 ────────────────────────────────────────────────────────────────────
 *   node infra/scripts/dockerfile-workspace-deps.mjs
 *   node infra/scripts/dockerfile-workspace-deps.mjs --repo-root /path/to/other/repo   # 테스트용
 * 종료 코드: 0=전 대상 통과 / 1=누락 1건 이상 또는 검사 대상 0건 또는 파싱 실패
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// ── pnpm-workspace.yaml 파싱 — 순수 함수 ────────────────────────────────────────

/**
 * `pnpm-workspace.yaml`의 `packages:` 목록에서 `"<dir>/*"` 형태의 항목만 뽑아 `<dir>` 배열을 반환한다.
 * 지원하지 않는 패턴을 만나면 예외를 던진다(추측 파싱 금지 — 위 헤더 주석 "지원 범위" 참조).
 * @param {string} yamlContent
 * @returns {string[]}
 */
export function parsePnpmWorkspaceGlobs(yamlContent) {
  const lines = yamlContent.split('\n');
  const prefixes = [];
  let inPackages = false;
  for (const raw of lines) {
    const withoutComment = raw.replace(/#.*$/, '');
    const trimmed = withoutComment.trim();
    if (!trimmed) continue;
    if (/^packages\s*:\s*$/.test(trimmed)) {
      inPackages = true;
      continue;
    }
    if (!inPackages) continue;
    const itemMatch = trimmed.match(/^-\s*(.+)$/);
    if (!itemMatch) {
      // `packages:` 블록을 벗어난 최상위 키(들여쓰기 없는 `key:`)로 판단하고 목록 읽기를 멈춘다.
      if (/^[A-Za-z0-9_.-]+\s*:/.test(trimmed)) {
        inPackages = false;
        continue;
      }
      throw new Error(`pnpm-workspace.yaml 파싱 실패 — 예상 밖 줄: "${trimmed}"`);
    }
    const pattern = itemMatch[1].trim().replace(/^["']|["']$/g, '');
    const globMatch = pattern.match(/^([A-Za-z0-9_-]+)\/\*$/);
    if (!globMatch) {
      throw new Error(
        `pnpm-workspace.yaml에서 지원하지 않는 glob 패턴: "${pattern}" ` +
          `(이 검사는 "<dir>/*" 형태만 지원한다 — 확장 필요)`,
      );
    }
    prefixes.push(globMatch[1]);
  }
  if (prefixes.length === 0) {
    throw new Error('pnpm-workspace.yaml에서 packages: 목록을 찾지 못했다(파싱 실패)');
  }
  return prefixes;
}

// ── 워크스페이스 전체 패키지명→디렉터리 역해석 — fs 접근 ─────────────────────────

/**
 * `<repoRoot>/<prefix>/*` 를 전부 훑어 package.json이 있는 디렉터리를 이름→상대경로로 매핑한다.
 * @param {string} repoRoot
 * @param {string[]} prefixes
 * @returns {Record<string, string>} 패키지명 → 리포 루트 기준 상대 디렉터리(예: 'packages/config')
 */
export function discoverWorkspacePackages(repoRoot, prefixes) {
  /** @type {Record<string, string>} */
  const map = {};
  for (const prefix of prefixes) {
    const baseDir = join(repoRoot, prefix);
    if (!existsSync(baseDir)) continue;
    const entries = readdirSync(baseDir, { withFileTypes: true }).filter((d) => d.isDirectory());
    for (const entry of entries) {
      const relDir = `${prefix}/${entry.name}`;
      const pkgPath = join(repoRoot, relDir, 'package.json');
      if (!existsSync(pkgPath)) continue;
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
      if (pkg && typeof pkg.name === 'string') {
        map[pkg.name] = relDir;
      }
    }
  }
  return map;
}

// ── package.json → workspace:* 의존 추출 — 순수 함수 ─────────────────────────────

/**
 * dependencies + devDependencies 중 `workspace:`로 시작하는 스펙만 추출한다.
 * @param {any} pkg package.json을 JSON.parse한 객체
 * @returns {{name: string, field: 'dependencies'|'devDependencies', spec: string}[]}
 */
export function extractWorkspaceDeps(pkg) {
  const out = [];
  for (const field of /** @type {const} */ (['dependencies', 'devDependencies'])) {
    const obj = (pkg && pkg[field]) || {};
    for (const [name, spec] of Object.entries(obj)) {
      if (typeof spec === 'string' && spec.startsWith('workspace:')) {
        out.push({ name, field, spec });
      }
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

// ── Dockerfile → COPY 소스 목록 — 순수 함수 ──────────────────────────────────────

/**
 * Dockerfile 본문에서 모든 `COPY` 인스트럭션의 **소스** 인자를 추출한다(목적지 1개 제외,
 * `--from=`/`--chown=` 등 플래그 제외). 트레일링 백슬래시 줄이음도 병합해서 처리한다.
 * @param {string} content
 * @returns {string[]}
 */
export function parseDockerfileCopySources(content) {
  const rawLines = content.split('\n');
  const merged = [];
  let buf = '';
  for (const line of rawLines) {
    buf = buf ? `${buf} ${line.trim()}` : line;
    if (buf.trimEnd().endsWith('\\')) {
      buf = buf.trimEnd().slice(0, -1);
      continue;
    }
    merged.push(buf);
    buf = '';
  }
  if (buf) merged.push(buf);

  const sources = [];
  for (const line of merged) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^COPY\s+(.*)$/i);
    if (!match) continue;
    const tokens = match[1].split(/\s+/).filter((t) => t.length > 0 && !t.startsWith('--'));
    if (tokens.length < 2) continue; // `COPY src dest` 최소 2토큰 미달 — 파싱 불가한 불완전 라인은 건너뜀
    sources.push(...tokens.slice(0, -1)); // 마지막 토큰=목적지, 나머지 전부=소스(다중 소스 COPY 지원)
  }
  return sources;
}

// ── 누락 판정 — 순수 함수 ─────────────────────────────────────────────────────────

/**
 * `depNames` 각각이 Dockerfile COPY로 커버되는지 판정하고 누락만 반환한다.
 * @param {string[]} depNames
 * @param {Record<string, string>} workspaceMap 패키지명 → 상대 디렉터리
 * @param {string[]} copySources
 * @returns {{dep: string, manifestPath: string|null, reason: string}[]}
 */
export function findMissingCopies(depNames, workspaceMap, copySources) {
  const missing = [];
  for (const dep of depNames) {
    const dir = workspaceMap[dep];
    if (!dir) {
      missing.push({
        dep,
        manifestPath: null,
        reason: `워크스페이스에서 '${dep}' 패키지를 찾지 못함(이름 불일치 또는 삭제된 패키지)`,
      });
      continue;
    }
    const manifestPath = `${dir}/package.json`;
    const covered = copySources.some((src) => {
      const normalizedDir = src.replace(/\/+$/, '');
      return src === manifestPath || normalizedDir === dir;
    });
    if (!covered) {
      missing.push({
        dep,
        manifestPath,
        reason: `Dockerfile COPY에 '${manifestPath}'(또는 '${dir}/' 디렉터리 전체 복사)가 없음`,
      });
    }
  }
  return missing;
}

// ── 서비스 1개 판정 — 순수 함수(입력은 이미 읽어들인 문자열) ────────────────────────

/**
 * @param {{ service: string, packageJsonContent: string, dockerfileContent: string, workspaceMap: Record<string,string> }} args
 */
export function checkService({ service, packageJsonContent, dockerfileContent, workspaceMap }) {
  const pkg = JSON.parse(packageJsonContent);
  const workspaceDeps = extractWorkspaceDeps(pkg);
  const copySources = parseDockerfileCopySources(dockerfileContent);
  const missing = findMissingCopies(
    workspaceDeps.map((d) => d.name),
    workspaceMap,
    copySources,
  );
  return { service, workspaceDeps, missing, ok: missing.length === 0 };
}

// ── 전체 실행 — fs 접근(discoverWorkspacePackages·서비스 스캔) ────────────────────

/**
 * `services/*` 를 훑어 (package.json + Dockerfile)을 둘 다 가진 디렉터리만 검사 대상으로 삼고,
 * 나머지는 사유와 함께 건너뛴다(ai-worker = Python 등).
 * @param {string} repoRoot
 */
export function checkAllServices(repoRoot) {
  const wsYaml = readFileSync(join(repoRoot, 'pnpm-workspace.yaml'), 'utf8');
  const prefixes = parsePnpmWorkspaceGlobs(wsYaml);
  const workspaceMap = discoverWorkspacePackages(repoRoot, prefixes);

  const servicesDir = join(repoRoot, 'services');
  if (!existsSync(servicesDir)) {
    return { ok: false, results: [], skipped: [], reason: `services/ 디렉터리가 없다: ${servicesDir}` };
  }
  const serviceNames = readdirSync(servicesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  const targets = [];
  const skipped = [];
  for (const name of serviceNames) {
    const dir = `services/${name}`;
    const pkgPath = join(repoRoot, dir, 'package.json');
    const dockerfilePath = join(repoRoot, dir, 'Dockerfile');
    if (!existsSync(pkgPath)) {
      skipped.push({
        service: name,
        reason: 'package.json 없음 — Node 워크스페이스 패키지가 아님(예: ai-worker=Python/FastAPI, 빌드 컨텍스트도 리포 루트가 아니다). 검사 대상 제외',
      });
      continue;
    }
    if (!existsSync(dockerfilePath)) {
      skipped.push({ service: name, reason: 'Dockerfile 없음 — 컨테이너화 대상 아님. 검사 대상 제외' });
      continue;
    }
    targets.push({ service: name, dir, pkgPath, dockerfilePath });
  }

  if (targets.length === 0) {
    return {
      ok: false,
      results: [],
      skipped,
      reason: 'services/*에서 (package.json + Dockerfile)을 모두 가진 검사 대상을 하나도 찾지 못했다',
    };
  }

  const results = targets.map((t) =>
    checkService({
      service: t.service,
      packageJsonContent: readFileSync(t.pkgPath, 'utf8'),
      dockerfileContent: readFileSync(t.dockerfilePath, 'utf8'),
      workspaceMap,
    }),
  );

  return { ok: results.every((r) => r.ok), results, skipped };
}

// ── CLI ───────────────────────────────────────────────────────────────────────

function main() {
  console.log('── Dockerfile 워크스페이스 의존 COPY 검사 (규율 2, 대장 #161) ──');

  const args = process.argv.slice(2);
  const repoRootIdx = args.indexOf('--repo-root');
  const repoRoot = repoRootIdx >= 0 ? args[repoRootIdx + 1] : REPO_ROOT;

  let outcome;
  try {
    outcome = checkAllServices(repoRoot);
  } catch (err) {
    console.error(`검사 실행 실패: ${err.message}`);
    process.exitCode = 1;
    return;
  }

  for (const s of outcome.skipped) {
    console.log(`  건너뜀: ${s.service} — ${s.reason}`);
  }

  if (outcome.results.length === 0) {
    console.error(`\n판정: FAIL — ${outcome.reason}`);
    process.exitCode = 1;
    return;
  }

  let anyFail = false;
  for (const r of outcome.results) {
    if (r.ok) {
      console.log(`  ✔ ${r.service}: 워크스페이스 의존 ${r.workspaceDeps.length}건 전부 Dockerfile COPY에 포함`);
    } else {
      anyFail = true;
      console.error(`  ✘ ${r.service}: 누락 ${r.missing.length}건`);
      for (const m of r.missing) {
        console.error(`      - ${m.dep}: ${m.reason}`);
      }
    }
  }

  if (anyFail || !outcome.ok) {
    console.error('\n판정: FAIL — 위 누락을 Dockerfile에 COPY로 추가해야 한다(#161 재발 방지).');
    process.exitCode = 1;
    return;
  }

  console.log('\n판정: PASS — 전 대상 서비스의 워크스페이스 의존이 Dockerfile COPY에 포함되어 있다.');
}

const isMainModule = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  main();
}
