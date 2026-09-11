#!/usr/bin/env node
/**
 * infra/scripts/reporter-app-thinness-gate.mjs
 *
 * `apps/reporter/app/**` "화면은 얇게" 정책의 신규 유입 차단 게이트 (동반 의무 D1, 대장 #173+#188,
 * 2026-09-11).
 *
 * ── 왜 있는가 (대장 #173) ────────────────────────────────────────────────────────
 * `apps/reporter/app/(app)/contents/new/index.tsx`의 촬영 로직(빈 uri·0바이트 방어 없음)이
 * "유령 영상"을 만들었다. 3앱 jest의 `testMatch`가 `src/**`만 잡아서(`apps/reporter/jest.config.js`
 * `testMatch: ['**\/src/**\/__tests__/**\/*.test.ts?(x)']`) `app/**`는 **어느 플랫폼에서도 0회
 * 로드되지 않는다** — 그 안에 로직이 생기면 테스트가 원천적으로 닿지 않는다. 수리(#173)는 로직을
 * `src/capture/video-capture.ts`·`src/upload/*.ts`로 빼고 `app/**`는 얇은 호출만 남겼다. 이
 * 스크립트는 그 얇음이 **다시 두꺼워지는 것**(신규 로직 유입)을 막는다 — 기존 40파일(reporter
 * 18·subscriber 10·control-center 12, 8,108행)을 지금 옮기는 게 목적이 아니다(범위 폭발 — #188
 * 동반 의무는 신규 유입 차단이 요지다). **이번 게이트는 reporter만** 본다(subscriber·control-center는
 * 이 슬라이스 범위 밖 — `apps/reporter/**` 소유 경계와 일치시킨다. §"지원 범위" 참조).
 *
 * ── 검사 정의(줄 수 예산, controller-role-gate.mjs와 동형 구조) ───────────────────
 * `apps/reporter/app` 아래 모든 `*.ts(x)`에 대해 **줄 수**(countLines — 트레일링 개행 1개는
 * 세지 않는다)를 그 파일의 "기준선"과 비교한다:
 *   1) `APP_LINE_BASELINE`에 등재된 파일 — 등재값(=이 게이트를 들여놓은 시점의 실측 줄 수, 아래
 *      "기준선" 절 참조)이 기준.
 *   2) 미등재(신규) 파일 — `NEW_FILE_FREE_LINES`(사소한 라우트·레이아웃 신설까지 매번 등재를
 *      강제하지 않는 여유치)가 기준.
 *   3) `GROWTH_ALLOWLIST`에 그 파일 엔트리가 있고 사유가 의미 있으면(`isMeaningfulReason`,
 *      controller-role-gate.mjs에서 재사용 — 사본 금지) `upToLines`가 기준을 **대체**한다(단,
 *      `upToLines`가 기준선보다 커야 실제로 완화된다).
 * 실측 줄 수가 유효 기준을 넘으면 위반. 위반은 "src/로 로직을 빼라" 또는 "GROWTH_ALLOWLIST에
 * 의미 있는 사유와 함께 등재하라"로 해소한다.
 *   4) 전 파일 스캔 후 `GROWTH_ALLOWLIST`를 역방향으로도 검사한다 — 실제 줄 수가 **원 기준선
 *      이하로 돌아온** 엔트리(더 이상 완화가 필요 없다)는 죽은 엔트리로 위반 처리한다
 *      (controller-role-gate.mjs의 허용목록 부패 방지와 동형).
 * 위반이 1건이라도 있으면 exit 1(죽은 허용목록 엔트리 포함). 스캔 대상이 0건이어도 exit 1
 * (조용한 통과 금지).
 *
 * ── 기준선 ("얇다"는 판단이 아니라 이 시점의 스냅샷) ────────────────────────────
 * `APP_LINE_BASELINE`의 각 값은 "이 정도가 적정하다"는 판단이 아니라 **#173+#188 수리 완료
 * 시점의 실측치를 그대로 옮긴 것**이다(9개 파일이 이미 150줄을 넘는다 — 그중 다수는 JSX 분량이지
 * 로직이 아니다). 막는 것은 절대 크기가 아니라 **이 시점 이후의 증가**다. 재현:
 *   node infra/scripts/reporter-app-thinness-gate.mjs --print-baseline
 * 이 현재 실측치를 다시 뽑아 표와 대조할 수 있다(D7-1 박제 금지 — 수치는 이 파일에만 있다).
 *
 * ── 지표의 한계(과장 금지) ────────────────────────────────────────────────────
 * "줄 수"는 **의미를 이해하지 않는 순수 기계적 프록시**다(controller-role-gate.mjs의
 * `isMeaningfulReason` 한계 주석과 같은 정신). JSX만 늘어도, 로직이 늘어도 똑같이 잡힌다 —
 * 이 게이트가 실제로 막는 것은 "로직 유입 자체를 정확히 탐지"가 아니라 **"화면이 커지면 반드시
 * 눈에 띄고(등재 필요), 커지는 이유를 코드 리뷰에서 설명해야 한다"**는 압력이다. 그 압력이
 * "이 로직은 src/로 빼는 게 낫다"는 선택을 유도한다 — 직접 탐지가 아니라 간접 유인이다.
 * 정밀한 "이 줄은 로직인가 JSX인가" 판정(예: 완전한 TS AST 파싱)은 이 스크립트의 저비용·
 * 무의존성 설계 밖이다(다른 7개 스크립트와 동형 — 괄호 깊이 스캔 선까지만 손으로 판다).
 *
 * ── 지원 범위(의도적으로 좁다) ───────────────────────────────────────────────────
 * `apps/reporter/app` 고정(다른 앱은 스캔하지 않는다 — 2026-09-11 위임 범위: "이번엔 reporter만").
 * `--repo-root`로 저장소 루트만 바꿀 수 있다(테스트용) — 스캔 대상 앱은 바꿀 수 없다.
 *
 * ── 사용법 ────────────────────────────────────────────────────────────────────
 *   node infra/scripts/reporter-app-thinness-gate.mjs
 *   node infra/scripts/reporter-app-thinness-gate.mjs --repo-root /path/to/other/repo   # 테스트용
 *   node infra/scripts/reporter-app-thinness-gate.mjs --print-baseline                  # 현재 실측치만 출력(정본 대조용)
 * 종료 코드: 0=전 파일 통과(허용목록 포함) 이고 허용목록 죽은 엔트리 0건 / 1=위반 1건 이상
 * 또는 스캔 대상 0건 또는 허용목록 죽은 엔트리 1건 이상
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMeaningfulReason } from './controller-role-gate.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** app/** 스캔 대상 확장자 */
const APP_FILE_EXTENSIONS = /\.(ts|tsx)$/;

/** 새 파일(APP_LINE_BASELINE 미등재)이 등재 없이 허용되는 최대 줄 수 */
export const NEW_FILE_FREE_LINES = 20;

// ── 기준선 (대장 #173+#188 수리 시점 실측, 2026-09-11 — 헤더 "기준선" 절 참조) ──────
/** @type {Record<string, number>} 리포 루트 기준 상대경로 → 실측 줄 수 */
export const APP_LINE_BASELINE = {
  'apps/reporter/app/(app)/_layout.tsx': 20,
  'apps/reporter/app/(app)/contents/[id]/captions.tsx': 185,
  'apps/reporter/app/(app)/contents/[id]/edit.tsx': 199,
  'apps/reporter/app/(app)/contents/[id]/index.tsx': 444,
  'apps/reporter/app/(app)/contents/[id]/preview.tsx': 432,
  'apps/reporter/app/(app)/contents/new/_layout.tsx': 54,
  'apps/reporter/app/(app)/contents/new/classify.tsx': 100,
  'apps/reporter/app/(app)/contents/new/index.tsx': 193,
  'apps/reporter/app/(app)/contents/new/mode.tsx': 82,
  'apps/reporter/app/(app)/contents/new/scenes.tsx': 39,
  'apps/reporter/app/(app)/contents/new/upload.tsx': 174,
  'apps/reporter/app/(app)/index.tsx': 313,
  'apps/reporter/app/(app)/resident-uploads/[id].tsx': 298,
  'apps/reporter/app/(app)/resident-uploads/index.tsx': 178,
  'apps/reporter/app/(app)/resident-uploads/issue.tsx': 123,
  'apps/reporter/app/(auth)/_layout.tsx': 8,
  'apps/reporter/app/(auth)/login.tsx': 114,
  'apps/reporter/app/_layout.tsx': 48,
};

// ── 성장 허용목록 (규율 21 — 사유는 의미 있어야 인정된다) ────────────────────────
/**
 * @typedef {{ file: string, upToLines: number, reason: string }} GrowthAllowlistEntry
 * @type {GrowthAllowlistEntry[]}
 */
export const GROWTH_ALLOWLIST = [];

// ── 순수 함수 ────────────────────────────────────────────────────────────────────

/**
 * 파일 내용의 "줄 수"를 센다 — 트레일링 개행 1개는 줄로 세지 않는다(에디터·git 관례와 일치).
 * @param {string} content
 * @returns {number}
 */
export function countLines(content) {
  const normalized = content.endsWith('\n') ? content.slice(0, -1) : content;
  return normalized.length === 0 ? 0 : normalized.split('\n').length;
}

/**
 * @param {GrowthAllowlistEntry[]} allowlist
 * @param {string} relFile
 * @returns {GrowthAllowlistEntry|undefined}
 */
export function findGrowthEntry(allowlist, relFile) {
  const normalized = relFile.split(sep).join('/');
  return allowlist.find((e) => e.file === normalized);
}

/**
 * 파일 1건 판정 — 순수 함수.
 * @param {{ relFile: string, actualLines: number }} file
 * @param {Record<string, number>} baseline
 * @param {GrowthAllowlistEntry[]} allowlist
 * @returns {{ file: string, actualLines: number, baseCeiling: number, effectiveCeiling: number, ok: boolean, viaAllowlist: boolean, reason: string|null }}
 */
export function judgeFile(
  { relFile, actualLines },
  baseline = APP_LINE_BASELINE,
  allowlist = GROWTH_ALLOWLIST,
) {
  const baseCeiling = baseline[relFile] ?? NEW_FILE_FREE_LINES;
  const entry = findGrowthEntry(allowlist, relFile);
  const meaningfulOverride = Boolean(
    entry && isMeaningfulReason(entry.reason) && entry.upToLines > baseCeiling,
  );
  const effectiveCeiling = meaningfulOverride ? entry.upToLines : baseCeiling;
  const ok = actualLines <= effectiveCeiling;

  let reason = null;
  if (!ok) {
    reason =
      entry && !isMeaningfulReason(entry.reason)
        ? '허용목록에 있으나 사유가 무의미함(규율 21) — 위반으로 취급'
        : `기준(${effectiveCeiling}줄) 초과 — src/로 로직을 빼거나 GROWTH_ALLOWLIST에 의미 있는 사유와 함께 등재해야 한다`;
  }

  return {
    file: relFile,
    actualLines,
    baseCeiling,
    effectiveCeiling,
    ok,
    viaAllowlist: meaningfulOverride,
    reason,
  };
}

/**
 * `GROWTH_ALLOWLIST` 엔트리 중 실제 줄 수가 **원 기준선 이하로 돌아온**(=더 이상 완화가 필요
 * 없는) 죽은 엔트리를 찾는다. 파일이 삭제된 경우(actualLinesByFile에 키가 없음)도 죽은 것으로 본다.
 * @param {GrowthAllowlistEntry[]} allowlist
 * @param {Record<string, number>} actualLinesByFile
 * @param {Record<string, number>} baseline
 * @returns {GrowthAllowlistEntry[]}
 */
export function findStaleGrowthEntries(
  allowlist,
  actualLinesByFile,
  baseline = APP_LINE_BASELINE,
) {
  return allowlist.filter((e) => {
    const actual = actualLinesByFile[e.file];
    const baseCeiling = baseline[e.file] ?? NEW_FILE_FREE_LINES;
    return actual === undefined || actual <= baseCeiling;
  });
}

// ── 전체 실행 — fs 접근 ────────────────────────────────────────────────────────────

/**
 * `apps/reporter/app` 아래 `*.ts`/`*.tsx`를 재귀 탐색한다.
 * @param {string} repoRoot
 * @returns {string[]} 절대경로 목록(정렬됨)
 */
export function findReporterAppFiles(repoRoot) {
  const root = join(repoRoot, 'apps', 'reporter', 'app');
  const results = [];
  if (!existsSync(root)) return results;

  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (entry.isFile() && APP_FILE_EXTENSIONS.test(entry.name)) {
        results.push(full);
      }
    }
  };
  walk(root);
  return results.sort();
}

/**
 * @param {string} repoRoot
 * @param {Record<string, number>} baseline
 * @param {GrowthAllowlistEntry[]} allowlist
 */
export function checkReporterApp(
  repoRoot,
  baseline = APP_LINE_BASELINE,
  allowlist = GROWTH_ALLOWLIST,
) {
  const files = findReporterAppFiles(repoRoot);
  if (files.length === 0) {
    return {
      ok: false,
      results: [],
      staleGrowthEntries: [],
      reason: `apps/reporter/app 아래 *.ts(x)를 하나도 찾지 못했다: ${join(repoRoot, 'apps', 'reporter', 'app')}`,
    };
  }

  /** @type {Record<string, number>} */
  const actualLinesByFile = {};
  const results = files.map((abs) => {
    const relFile = abs.slice(repoRoot.length + 1).split(sep).join('/');
    const actualLines = countLines(readFileSync(abs, 'utf8'));
    actualLinesByFile[relFile] = actualLines;
    return judgeFile({ relFile, actualLines }, baseline, allowlist);
  });

  const staleGrowthEntries = findStaleGrowthEntries(allowlist, actualLinesByFile, baseline);

  return {
    ok: results.every((r) => r.ok) && staleGrowthEntries.length === 0,
    results,
    staleGrowthEntries,
  };
}

// ── CLI ───────────────────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  const repoRootIdx = args.indexOf('--repo-root');
  const repoRoot = repoRootIdx >= 0 ? args[repoRootIdx + 1] : REPO_ROOT;

  if (args.includes('--print-baseline')) {
    const files = findReporterAppFiles(repoRoot);
    for (const abs of files) {
      const relFile = abs.slice(repoRoot.length + 1).split(sep).join('/');
      console.log(`${countLines(readFileSync(abs, 'utf8'))}\t${relFile}`);
    }
    return;
  }

  console.log('── apps/reporter/app 얇은 화면 게이트 (동반 의무 D1, 대장 #173+#188) ──');

  const outcome = checkReporterApp(repoRoot);

  if (outcome.results.length === 0) {
    console.error(`\n판정: FAIL — ${outcome.reason}`);
    process.exitCode = 1;
    return;
  }

  // 정상 파일은 개별 로그하지 않는다 — 기준선이 "현재값 스냅샷"이라 매 실행마다 18개 전부가
  // 100%에 걸려 있는 게 정상이다(§ "기준선" 절). 그걸 매번 찍으면 신호 대비 잡음만 커진다
  // (controller-role-gate.mjs는 라우트마다 게이트 종류가 달라 개별 로그가 유의미하지만, 여기는
  // "그대로면 전부 100%"라 위반만 보여주는 편이 낫다).
  let anyFail = false;
  for (const r of outcome.results) {
    if (!r.ok) {
      anyFail = true;
      console.error(`  ✘ ${r.file}: ${r.actualLines}줄 — ${r.reason}`);
    }
  }
  const viaAllowlistCount = outcome.results.filter((r) => r.viaAllowlist).length;

  if (outcome.staleGrowthEntries.length > 0) {
    anyFail = true;
    console.error(`  ✘ 허용목록 부패: 더 이상 필요 없는 죽은 엔트리 ${outcome.staleGrowthEntries.length}건`);
    for (const e of outcome.staleGrowthEntries) {
      console.error(
        `      - ${e.file}: 실측 줄 수가 원 기준선 이하로 돌아왔다 — GROWTH_ALLOWLIST에서 제거해야 한다.`,
      );
    }
  }

  if (anyFail || !outcome.ok) {
    console.error(
      '\n판정: FAIL — 위 파일의 로직을 apps/reporter/src/로 빼거나(테스트가 그쪽만 잡는다) ' +
        'GROWTH_ALLOWLIST에 의미 있는 사유와 함께 등재해야 한다. 죽은 허용목록 엔트리는 제거해야 한다.',
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `\n판정: PASS — apps/reporter/app ${outcome.results.length}개 파일 전부 기준선 이내` +
      `(허용목록 경유 ${viaAllowlistCount}건, 죽은 엔트리 0건).`,
  );
}

const isMainModule = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  main();
}
