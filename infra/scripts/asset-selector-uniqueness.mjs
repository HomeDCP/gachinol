#!/usr/bin/env node
/**
 * infra/scripts/asset-selector-uniqueness.mjs
 *
 * 동반 의무 D1-c(대장 #232 태스크②, 대장 #139 겸 해소) — "배포 렌디션 선택 규칙은
 * `services/api/src/media/asset-selectors.ts` 한 곳에만 있다"를 CI에서 fail-closed로 확인한다.
 *
 * ── 왜 있는가 (대장 #232 태스크②) ─────────────────────────────────────────────────
 * `feed.service.ts`·`public-media.service.ts`·`distribution-producer.service.ts` 세 곳에 같은
 * "720p 렌디션 우선, 없으면 첫 렌디션 폴백" 규칙이 표현만 다르게 복제돼 있었다(대장 #139). 단일
 * 모듈(`asset-selectors.ts`)로 모았지만, 모듈을 만드는 것만으로는 **사본이 다시 생기는 것**을
 * 막지 못한다(검사가 닿지 않는 축엔 결함이 다시 산다 — `exec/ROOT-CAUSE-2026-08.md`와 동형 정신).
 * 이 스크립트가 그 재발을 fail-closed로 잡는다.
 *
 * ⭐ 선호 레이블 하드코딩이 특히 위험한 이유: 레이블을 만드는 쪽(`queue-producer.service.ts`의
 * transcode 인큐·media-worker의 `autoEditProfile`)은 `MEDIA_RENDITION_HEIGHT`에서 레이블을
 * 파생한다. 그 env가 720이 아닌 값으로 바뀌면 하드코딩된 `'720p'` 비교는 **에러도 경고도 없이**
 * 조용히 폴백 분기로 떨어진다 — 그래서 이 게이트는 "규칙 중복"뿐 아니라 "레이블 리터럴 하드코딩"도
 * 함께 잡는다(아래 검사 정의 ②).
 *
 * ── 검사 정의 ───────────────────────────────────────────────────────────────────
 * `services/api/src` 아래 `*.ts`(스펙 파일 `*.spec.ts` 제외 — 아래 "spec 제외 근거" 참조, 지정
 * 단일 원천 파일 `media/asset-selectors.ts` 자신도 제외)에 대해 각 줄을 두 패턴으로 스캔한다:
 *   1) `renditionLabel\s*===` — `renditionLabel` 필드를 직접 비교하는 코드(선택 규칙 재구현).
 *   2) `['"][0-9]+p['"]` — `'720p'`처럼 따옴표로 감싼 렌디션 레이블 리터럴(선호 레이블 하드코딩).
 * 둘 중 하나라도 걸리면 그 줄은 위반. 위반이 1건이라도 있으면 exit 1. 스캔 대상이 0건이어도
 * exit 1(조용한 통과 금지 — `controller-role-gate.mjs`·`reporter-app-thinness-gate.mjs`와 동형).
 *
 * ── spec 제외 근거 ─────────────────────────────────────────────────────────────
 * `*.spec.ts`는 스캔하지 않는다. 테스트 픽스처가 `renditionLabel: '720p'`처럼 **목 데이터** 값을
 * 대입하는 것은 선택 "규칙"이 아니다(비교가 아니라 값 지정) — 그리고 실측상 이 리포의 spec 파일들이
 * 그런 목 데이터로 `'720p'`·`'480p'`·`'1080p'` 리터럴을 광범위하게 쓴다(`feed.service.spec.ts`·
 * `public-media.service.spec.ts`·`distribution-producer.service.spec.ts` 등, 대장 #232 태스크②
 * 조사 시점 실측 10곳 이상). 제외하지 않으면 그 목 데이터 전부가 오탐이 된다. 반대로 실제
 * `renditionLabel ===` 비교는 리포의 spec 파일 어디에도 나타나지 않는다(재현:
 * `grep -rn "renditionLabel\s*===" services/api/src` — 실 서비스 3파일에서만 나온다) — spec 제외가
 * 진짜 위반을 가리는 사례는 지금 없다.
 *
 * ── 지원 범위(의도적으로 좁다) ───────────────────────────────────────────────────
 * `services/api/src` 고정. 정규식 줄 스캔이라 문자열/주석 구분을 하지 않는다 — 대신 리터럴 패턴을
 * 좁게 잡아(따옴표+숫자+p, 정확히 `renditionLabel ===`) 이 리포의 주석 오탐을 실측으로 배제했다
 * (예: `env.schema.ts`·`queue-producer.service.ts`의 "720p"를 언급하는 주석은 따옴표로 감싸지
 * 않아 패턴 ②에 걸리지 않는다, 재현: `grep -rn "720p" services/api/src` vs
 * `grep -rnE "['\"][0-9]+p['\"]" services/api/src`).
 *
 * ── 사용법 ────────────────────────────────────────────────────────────────────
 *   node infra/scripts/asset-selector-uniqueness.mjs
 *   node infra/scripts/asset-selector-uniqueness.mjs --repo-root /path/to/other/repo   # 테스트용
 * 종료 코드: 0=위반 0건 / 1=위반 1건 이상 또는 스캔 대상 0건
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** 단일 원천 모듈 — 이 파일 안에서는 렌디션 선택 규칙 구현이 정당하다(스캔 제외). */
export const SELECTOR_SOURCE_FILE = 'services/api/src/media/asset-selectors.ts';

/** ① `renditionLabel` 필드 직접 비교 — 선택 규칙 재구현의 가장 확실한 신호. */
const RENDITION_LABEL_COMPARISON_RE = /renditionLabel\s*===/;
/** ② 따옴표로 감싼 렌디션 레이블 리터럴(`'720p'`류) — 선호 레이블 하드코딩. */
const RENDITION_LABEL_LITERAL_RE = /['"][0-9]+p['"]/;

/**
 * 파일 1개(이미 읽어들인 내용)를 줄 단위로 스캔해 위반 목록을 반환한다 — 순수 함수.
 * @param {{ relFile: string, content: string }} args
 * @returns {{ file: string, line: number, pattern: string, snippet: string }[]}
 */
export function scanFileForViolations({ relFile, content }) {
  const violations = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (RENDITION_LABEL_COMPARISON_RE.test(line)) {
      violations.push({
        file: relFile,
        line: i + 1,
        pattern: 'renditionLabel-comparison',
        snippet: line.trim(),
      });
      continue; // 한 줄에서 두 패턴이 동시에 걸려도 위반 1건으로 충분(중복 보고 방지)
    }
    if (RENDITION_LABEL_LITERAL_RE.test(line)) {
      violations.push({
        file: relFile,
        line: i + 1,
        pattern: 'rendition-label-literal',
        snippet: line.trim(),
      });
    }
  }
  return violations;
}

/**
 * `services/api/src` 아래 `*.ts`(스펙 제외, 단일 원천 파일 제외)를 재귀 탐색한다.
 * @param {string} repoRoot
 * @returns {string[]} 절대경로 목록(정렬됨)
 */
export function findScanTargetFiles(repoRoot) {
  const root = join(repoRoot, 'services', 'api', 'src');
  const results = [];
  if (!existsSync(root)) return results;

  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith('.ts')) continue;
      if (entry.name.endsWith('.spec.ts')) continue; // spec 제외 — 헤더 "spec 제외 근거" 참조
      const relFile = full.slice(repoRoot.length + 1).split(sep).join('/');
      if (relFile === SELECTOR_SOURCE_FILE) continue; // 단일 원천 자신은 제외
      results.push(full);
    }
  };
  walk(root);
  return results.sort();
}

/**
 * @param {string} repoRoot
 * @returns {{ ok: boolean, violations: { file: string, line: number, pattern: string, snippet: string }[], filesScanned: number, reason?: string }}
 */
export function checkAssetSelectorUniqueness(repoRoot) {
  const files = findScanTargetFiles(repoRoot);
  if (files.length === 0) {
    return {
      ok: false,
      violations: [],
      filesScanned: 0,
      reason: `services/api/src 아래 스캔 대상을 하나도 찾지 못했다: ${join(repoRoot, 'services', 'api', 'src')}`,
    };
  }

  const violations = [];
  for (const abs of files) {
    const relFile = abs.slice(repoRoot.length + 1).split(sep).join('/');
    const content = readFileSync(abs, 'utf8');
    violations.push(...scanFileForViolations({ relFile, content }));
  }

  return { ok: violations.length === 0, violations, filesScanned: files.length };
}

// ── CLI ───────────────────────────────────────────────────────────────────────

function main() {
  console.log('── 자산 셀렉터 유일성 게이트 (동반 의무 D1-c, 대장 #232 태스크②·#139) ──');

  const args = process.argv.slice(2);
  const repoRootIdx = args.indexOf('--repo-root');
  const repoRoot = repoRootIdx >= 0 ? args[repoRootIdx + 1] : REPO_ROOT;

  const outcome = checkAssetSelectorUniqueness(repoRoot);

  if (outcome.filesScanned === 0) {
    console.error(`\n판정: FAIL — ${outcome.reason}`);
    process.exitCode = 1;
    return;
  }

  if (!outcome.ok) {
    console.error(`  ✘ 렌디션 선택 규칙 사본 ${outcome.violations.length}건 발견:`);
    for (const v of outcome.violations) {
      console.error(`      - ${v.file}:${v.line} [${v.pattern}] ${v.snippet}`);
    }
    console.error(
      '\n판정: FAIL — 렌디션 선택 규칙은 services/api/src/media/asset-selectors.ts 한 곳에만 ' +
        '있어야 한다. selectPlaybackRendition·selectDistributionVideo·renditionLabelForHeight를 ' +
        '재사용하도록 고쳐라(대장 #232 태스크②·#139 재발 방지).',
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `\n판정: PASS — services/api/src ${outcome.filesScanned}개 파일 스캔, 셀렉터 사본 0건 ` +
      `(단일 원천: ${SELECTOR_SOURCE_FILE}).`,
  );
}

const isMainModule = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  main();
}
