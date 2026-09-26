#!/usr/bin/env node
/**
 * infra/scripts/master-scale-dual-axis-gate.mjs
 *
 * 동반 의무 D1-c(대장 #240·#241) — "스케일 식이 두 변 모두에 상한을 갖는가"를 CI에서
 * fail-closed로 확인한다. 선례는 `infra/scripts/asset-selector-uniqueness.mjs`(idiom 동형).
 *
 * ── 왜 있는가 (대장 #240 동반 의무 D1-c) ─────────────────────────────────────────
 * `processors.spec.ts`의 태스크① 주석이 밝히듯, 舊 D1-a 픽스처 승격은 **해상도 축만** 넓히고
 * **방향(orientation) 축**은 넓히지 않아서, 같은 `autoEdit()` 함수에서 세로 영상 오처리(#240)가
 * 바로 재발했다 — "검사가 닿지 않는 축엔 결함이 다시 산다"(`exec/ROOT-CAUSE-2026-08.md`와 동형
 * 정신). 테스트 픽스처를 늘리는 것만으로는 **미래의** 회귀(누가 마스터 스케일 식을 다시 단일축
 * 캡으로 되돌리는 것)를 못 잡는다 — 이 정적 게이트가 그 재발을 구조적으로 막는다.
 *
 * ── 검사 정의 ────────────────────────────────────────────────────────────────
 * `services/media-worker/src/ffmpeg.ts`를 줄 단위로 스캔해 "스케일 필터 정의 줄"(문자열 리터럴에
 * `scale=`을 담은 코드 줄 — 주석 줄은 제외)을 찾는다. 각 정의가 속한 함수(가장 가까이 앞서 나온
 * `function NAME(` 선언)를 추적하고, 그 함수가 **allowlist에 없으면** 정의 줄이 "두 변 모두에
 * 상한을 갖는가"(`min(iw...`와 `min(ih...`가 **같은 줄에** 함께 있는가)를 검사한다. 없으면 위반.
 *
 * ⚠️ 검사가 "같은 줄"만 보는 이유: 이 리포는 `scale` 변수를 여러 줄 `+` 연결로 쪼개 쓸 수도 있는
 * 스타일이라, 멀티라인 파싱은 과설계다. 대신 `ffmpeg.ts`의 마스터 스케일 정의 자신이 **한 줄로
 * 유지되도록** 주석으로 못박아 뒀다(그 줄 바로 위 주석 참조) — 검사기를 단순하게 유지하는 대가로
 * 산출 코드 쪽에 "이 줄을 쪼개지 마라"는 제약을 하나 거는 트레이드오프다.
 *
 * ── allowlist(사유 명시) ────────────────────────────────────────────────────
 * `transcode`·`preview`·`thumbnail`은 의도적으로 한 변만 캡한다(렌디션·프리뷰는 내부 MVP
 * 시연·확인용으로 송출 마스터가 아니고, 썸네일은 대장 #239 사용자 결정 대기) — 아래
 * `ALLOWLISTED_SCALE_FUNCTIONS`가 사유를 명시적으로 담는다. **`autoEdit`(마스터)은 allowlist에
 * 없다** — 그래서 마스터 스케일 식이 다시 단일축 캡으로 퇴행하면 이 게이트가 즉시 red가 된다.
 *
 * ── 사용법 ──────────────────────────────────────────────────────────────────
 *   node infra/scripts/master-scale-dual-axis-gate.mjs
 *   node infra/scripts/master-scale-dual-axis-gate.mjs --repo-root /path/to/other/repo   # 테스트용
 * 종료 코드: 0=위반 0건(및 스캔 대상 1건 이상) / 1=위반 1건 이상 또는 스캔 대상(정의) 0건
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** 스캔 대상 — 이 리포에서 `scale=` 필터를 정의하는 유일한 파일(재현: `grep -rn "scale=" services/media-worker/src`). */
export const SCALE_TARGET_FILE = 'services/media-worker/src/ffmpeg.ts';

/**
 * 함수 이름 → allowlist 사유. 이 목록에 있는 함수의 스케일 정의는 단일축이어도 위반으로 잡지
 * 않는다. 사유 없는 등재는 금지(항상 문자열을 채운다) — 다음 사람이 "왜 빠졌는지"를 코드만
 * 읽고 알 수 있어야 한다.
 */
export const ALLOWLISTED_SCALE_FUNCTIONS = {
  transcode:
    '렌디션(720p, MVP 시연·내부 배포용) — 송출 마스터가 아니다. 대장 #240 범위 밖(무변경 지시, ' +
    '위임 5-6 "하지 않을 것").',
  preview:
    '기자 승인용 저화질 프리뷰(payload maxHeight 캡) — 송출 대상 아니다. 대장 #240 범위 밖(무변경 ' +
    '지시, 위임 5-6 "하지 않을 것").',
  thumbnail: '단일 프레임 JPEG 썸네일 — 한 변 고정이 의도적. 대장 #239 사용자 결정 대기.',
};

/** 주석 줄 판정 — `//`·`*`(JSDoc continuation)로 시작하는 줄은 스캔에서 제외(위양성 방지). */
function isCommentLine(line) {
  const t = line.trim();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
}

/** 함수 선언 줄에서 함수 이름 추출. `export function NAME(` / `function NAME(` 양쪽을 잡는다. */
const FUNCTION_DECL_RE = /^\s*(?:export\s+)?function\s+([A-Za-z0-9_]+)\s*\(/;

/** 같은 줄 안에 `min(iw...`와 `min(ih...`가 함께 있는가 — "두 변 모두에 상한"의 직접적 증거. */
const MIN_IW_RE = /min\(\s*iw\b/i;
const MIN_IH_RE = /min\(\s*ih\b/i;

/**
 * 소스 문자열에서 스케일 필터 "정의 줄"을 찾는다 — 순수 함수.
 * @param {string} content
 * @returns {{ functionName: string, line: number, snippet: string, dualAxis: boolean }[]}
 */
export function findScaleDefinitions(content) {
  const lines = content.split('\n');
  const defs = [];
  let currentFn = '(module-level)';
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    const declMatch = raw.match(FUNCTION_DECL_RE);
    if (declMatch) {
      currentFn = declMatch[1];
      continue;
    }
    if (isCommentLine(raw)) continue;
    if (!raw.includes('scale=')) continue;
    defs.push({
      functionName: currentFn,
      line: i + 1,
      snippet: raw.trim(),
      dualAxis: MIN_IW_RE.test(raw) && MIN_IH_RE.test(raw),
    });
  }
  return defs;
}

/**
 * @param {string} repoRoot
 * @param {string} [targetFile]
 * @returns {{ ok: boolean, violations: { functionName: string, line: number, snippet: string }[], definitionsScanned: number, reason?: string }}
 */
export function checkMasterScaleDualAxis(repoRoot, targetFile = SCALE_TARGET_FILE) {
  const abs = join(repoRoot, ...targetFile.split('/'));
  if (!existsSync(abs)) {
    return {
      ok: false,
      violations: [],
      definitionsScanned: 0,
      reason: `스캔 대상 파일을 찾지 못했다: ${abs}`,
    };
  }
  const content = readFileSync(abs, 'utf8');
  const defs = findScaleDefinitions(content);
  if (defs.length === 0) {
    return {
      ok: false,
      violations: [],
      definitionsScanned: 0,
      reason: `${targetFile}에서 스케일 필터 정의를 하나도 찾지 못했다(스캔 로직 드리프트 의심).`,
    };
  }

  const violations = defs
    .filter((d) => !d.dualAxis && !(d.functionName in ALLOWLISTED_SCALE_FUNCTIONS))
    .map(({ functionName, line, snippet }) => ({ functionName, line, snippet }));

  return { ok: violations.length === 0, violations, definitionsScanned: defs.length };
}

// ── CLI ───────────────────────────────────────────────────────────────────────

function main() {
  console.log('── 송출 마스터 스케일 회전 대칭 게이트 (동반 의무 D1-c, 대장 #240·#241) ──');

  const args = process.argv.slice(2);
  const repoRootIdx = args.indexOf('--repo-root');
  const repoRoot = repoRootIdx >= 0 ? args[repoRootIdx + 1] : REPO_ROOT;

  const outcome = checkMasterScaleDualAxis(repoRoot);

  if (outcome.definitionsScanned === 0) {
    console.error(`\n판정: FAIL — ${outcome.reason}`);
    process.exitCode = 1;
    return;
  }

  if (!outcome.ok) {
    console.error(`  ✘ 단일축 스케일 캡(allowlist 밖) ${outcome.violations.length}건 발견:`);
    for (const v of outcome.violations) {
      console.error(`      - ${SCALE_TARGET_FILE}:${v.line} [${v.functionName}] ${v.snippet}`);
    }
    console.error(
      '\n판정: FAIL — 송출 마스터(auto_edit)의 스케일 식은 긴 변·짧은 변 양쪽에 상한을 가져야 ' +
        `한다(같은 줄에 min(iw...와 min(ih...가 함께 있어야 함). 의도적으로 한 변만 캡하는 함수는 ` +
        'ALLOWLISTED_SCALE_FUNCTIONS에 사유와 함께 등재하라(대장 #240 동반 의무 D1-c).',
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `\n판정: PASS — ${SCALE_TARGET_FILE} 스케일 정의 ${outcome.definitionsScanned}건 스캔, ` +
      `위반 0건(allowlist ${Object.keys(ALLOWLISTED_SCALE_FUNCTIONS).length}건: ` +
      `${Object.keys(ALLOWLISTED_SCALE_FUNCTIONS).join(', ')}).`,
  );
}

const isMainModule = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  main();
}
