#!/usr/bin/env node
// infra/scripts/web-platform-test-gate.mjs
//
// 동반 의무 D1(QUEUE 2-2, 대장 #178) 기계화 — ".web.* 파일은 반드시 웹 jest 축에서 실제로
// 로드되는 테스트가 있어야 한다"를 CI에서 fail-closed로 확인한다.
//
// ── 왜 있는가 (대장 #178) ────────────────────────────────────────────────────────
// 3앱 jest.config.js가 jest-expo(네이티브 preset)만 쓰고 haste.platforms에 'web'이 없어서
// (react-native/jest-preset.js 기본값) .web.* 파일은 어느 테스트에서도 한 번도 로드되지
// 않았다. 이번 슬라이스가 apps/reporter·apps/subscriber에 jest.web.config.js(jest-expo/web
// preset) + test:web 스크립트 + __web_tests__/ 전용 테스트를 신설해 4개 파일 전부를 실행으로
// 로드시켰다(해소 판정 — 접미사 없는 import가 .web.*로 해석됨을 require.resolve() 직접 증거로
// 확인, apps/reporter/src/upload/__web_tests__/http-upload-service.test.ts 등). 이 게이트는
// 그 배선이 미래에 조용히 썩지 않게 막는다 — 새 .web.* 파일이 추가되는데 그에 대응하는 웹
// 테스트가 없으면 CI가 즉시 잡는다.
//
// ⚠️ 2026-09-12 추가(게이트②·독립 검증이 픽스처로 실증한 우회 경로, 대장 #188·#210 축) —
// 최초 버전은 ".web.* 파일과 같은 디렉터리에 __web_tests__가 있고 그 안에 접미사 없는 import가
// 있는가"만 봐서, apps/<app>/app/ 아래(jest.web.config.js testMatch가 절대 스캔하지 않는 위치)에
// .web.* + 완벽한 __web_tests__를 둬도 PASS를 줬다 — jest는 그 테스트를 영원히 선택하지 않는데
// 게이트는 초록이었다. 아래 "검사 정의" ③이 이 사각을 닫는다(JEST_WEB_TESTMATCH_ROOT_SEGMENT
// 상수·isUnderJestScannableRoot() 참조).
//
// ── 검사 정의(controller-role-gate.mjs·reporter-app-thinness-gate.mjs와 동형 구조) ──────
// 리포 전체(node_modules·dist·build·coverage·.expo·.turbo·.git 제외)에서 *.web.ts/*.web.tsx/
// *.web.js/*.web.jsx를 전수 수집한다. 각 파일에 대해(전부 필요조건 — 하나라도 실패하면 그
// 시점에서 위반):
//   ① 경로가 apps/<app>/... 형태가 아니면 — 이 게이트가 판정 가능한 test:web 축이 없다 → 위반
//      (단, 허용목록에 의미 있는 사유로 등재돼 있으면 통과).
//   ② 그 app에 apps/<app>/jest.web.config.js가 없거나 apps/<app>/package.json에 test:web
//      스크립트가 없으면 → 위반(허용목록 예외 동일).
//   ③ [2026-09-12 추가] .web.* 파일 자신이 apps/<app>/${JEST_WEB_TESTMATCH_ROOT_SEGMENT}/
//      (='src') 아래에 있지 않으면 → 위반. jest.web.config.js의 testMatch가 그 루트 밖은
//      원리적으로 스캔하지 않으므로, ④를 아무리 완벽히 만족해도 jest가 절대 선택하지 못하는
//      "허구의 통과"를 막는다.
//   ④ 그 .web.* 파일과 같은 디렉터리의 __web_tests__ 하위(재귀) *.test.ts(x) 파일 중 아무거나,
//      그 .web.* 파일의 접미사를 뗀 이름(예: uploader.web.ts → uploader)을 상대경로 import의
//      마지막 세그먼트로 갖는 import/require가 하나라도 있으면 → 통과. 없으면 → 위반.
//      주의: '../uploader.web'처럼 명시 접미사가 붙은 import는 매칭되지 않는다(위임문이 요구한
//      "명시 경로 import는 판정을 충족하지 않는다"와 동일 기준을 게이트도 강제한다 — 마지막
//      세그먼트를 '.web' 확장자까지 포함해 정확히 비교하므로 'uploader.web' !== 'uploader').
//   ⑤ 전 파일 스캔 후 허용목록(WEB_LOAD_ALLOWLIST)을 역방향 검사 — 실존하지 않는 .web.* 파일을
//      가리키거나, 이미 허용목록 없이도 통과하는(더 이상 필요 없는) 엔트리는 죽은 엔트리로
//      위반 처리한다(controller-role-gate.mjs 허용목록 부패 방지와 동형).
// 위반 1건 이상 또는 스캔 대상 0건 또는 죽은 허용목록 엔트리 1건 이상이면 exit 1.
//
// ── 판정식의 한계(과장 금지) ──────────────────────────────────────────────────────
// 이 게이트는 정적 분석이다 — 실제로 jest를 실행해 커버리지를 재지 않는다(controller-role-
// gate.mjs가 실제 RolesGuard 런타임 강제를 확인하지 않는 것과 같은 층위의 한계). 그래서:
//  · __web_tests__/*.test.ts(x)에 그 이름의 import가 "텍스트로 존재"하면 통과 처리한다 — 그
//    테스트가 실제로 통과하는지, 그 import가 주석·문자열 안에 우연히 나타난 건 아닌지는
//    검증하지 않는다(import/require 구문 형태만 정규식으로 본다 — 완전한 오탐 방지는 AST 파싱이
//    필요하고 이 스크립트의 무의존성·저비용 설계 밖이다, reporter-app-thinness-gate.mjs와 동형).
//    ⚠️ 이 한계는 **일부러 고치지 않는다**(2026-09-12 조율자 결정) — 이 게이트는 고의 우회를
//    막는 장치가 아니라 실수(새 .web.* 파일에 대응 테스트를 깜빡하는 것)를 잡는 장치다. 주석·
//    문자열 안에 가짜 import를 적고 본문을 빈 assertion으로 채우는 것은 "실수"의 범주를 벗어난
//    고의적 회피이고, 그런 고의를 막으려면 AST 파싱(무의존성 설계 포기)이 필요하다.
//  · jest.web.config.js의 testMatch를 직접 파싱해서 끌어오지는 않는다 — 대신 그 testMatch가
//    실제로 요구하는 두 가지 구조적 전제를 이 게이트가 상수·함수로 각각 하드코딩해 강제한다:
//      ⑴ __web_tests__ 디렉터리 이름 관례(이번 슬라이스가 정함 — 웹 테스트를 이 이름이 아닌
//         디렉터리에 두면(관례 위반) 이 게이트는 그 배선을 못 보고 위반으로 오판할 수 있다.
//         그 경우 파일을 __web_tests__로 옮기거나 허용목록에 사유와 함께 등재한다).
//      ⑵ [2026-09-12 추가] .web.* 파일 자신이 testMatch 루트(JEST_WEB_TESTMATCH_ROOT_SEGMENT)
//         아래에 있어야 한다는 전제(위 "검사 정의" ③).
//    ⑴·⑵ 모두 testMatch 문자열을 실제로 읽어 끌어오지 않고 하드코딩으로 별도 명시하는 선택이다
//    (속도·단순성 우선 — controller-role-gate.mjs·reporter-app-thinness-gate.mjs 등 이 리포의
//    다른 게이트도 전부 스캔 루트를 하드코딩한다, 사본이 아니라 이 리포 게이트 공통 설계다).
//    그래서 이 하드코딩이 실제 jest.web.config.js와 어긋나면(예: 누군가 testMatch의 루트를
//    바꾸면서 JEST_WEB_TESTMATCH_ROOT_SEGMENT를 안 고치면) 이 게이트가 조용히 틀린 판정을 낼 수
//    있다 — 그 드리프트는 이 파일이 아니라 web-platform-test-gate.test.mjs의 자기검증(실제 두
//    jest.web.config.js 원문을 읽어 이 상수와 대조)이 잡는다(reporter-app-thinness-gate.test.mjs
//    의 APP_LINE_BASELINE 자기검증과 동형 사상).
//  · moduleNameMapper·transformIgnorePatterns 같은 실행 시점 병합/대체 함정(jest.web.config.js
//    헤더 주석 "실행 확인 결과" 참조)은 이 게이트가 아니라 실제 test:web 실행(로컬 3게이트·CI)이
//    잡는다 — 이 게이트는 "테스트가 존재하고 그 파일을 가리키는가"만 본다. 즉 "로드된다"가 아니라
//    "로드되도록 배선돼 있다"를 본다 — 둘의 차이는 실제 실행(게이트①)으로만 메워진다.
//
// ── 사용법 ────────────────────────────────────────────────────────────────────
//   node infra/scripts/web-platform-test-gate.mjs
//   node infra/scripts/web-platform-test-gate.mjs --repo-root /path/to/other/repo   # 테스트용
// 종료 코드: 0=전 파일 통과(허용목록 포함) 이고 허용목록 죽은 엔트리 0건 / 1=위반 1건 이상
// 또는 스캔 대상 0건 또는 허용목록 죽은 엔트리 1건 이상
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMeaningfulReason } from './controller-role-gate.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** .web.* 대상 확장자 */
const WEB_FILE_RE = /\.web\.(ts|tsx|js|jsx)$/;
/** 웹 축 테스트 파일 확장자 */
const TEST_FILE_RE = /\.test\.(ts|tsx|js|jsx)$/;
/** 걷지 않는 디렉터리(생성물·벤더) — packages/config/eslint/base.mjs ignores와 동형 목록 */
const IGNORED_DIR_NAMES = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  '.expo',
  '.turbo',
  '.next',
]);
/** import/require 문자열 리터럴 경로 추출 — from '...' 또는 require('...') 양쪽 */
const IMPORT_SPECIFIER_RE = /(?:from\s+|require\(\s*)['"]([^'"]+)['"]/g;

/**
 * apps/reporter·apps/subscriber의 jest.web.config.js testMatch(`<rootDir>/src/**\/__web_tests__/
 * **\/*.test.ts?(x)`)가 실제로 스캔하는 루트 세그먼트. `.web.*` 파일이 `apps/<app>/${이 값}/` 아래에
 * 있지 않으면(예: `apps/<app>/app/...`) 그 옆에 `__web_tests__`를 아무리 정확히 둬도 jest가 그
 * 테스트를 절대 선택하지 않는다 — 2026-09-12 게이트②(독립 검증) 픽스처가 실증한 우회 경로다
 * (대장 #188·#210 축 — app/** 검사 사각의 또 다른 얼굴).
 *
 * ⚠️ 이 값은 jest.web.config.js의 testMatch 문자열을 실제로 파싱해 끌어온 것이 아니라 **하드코딩된
 * 미러**다(속도·단순성 우선 — controller-role-gate.mjs·reporter-app-thinness-gate.mjs 등 이 리포의
 * 다른 게이트도 전부 스캔 루트를 이렇게 하드코딩한다). 그래서 누군가 testMatch의 루트를 바꾸면서
 * 이 상수를 함께 고치지 않으면 이 게이트가 조용히 틀린 판정을 낼 수 있다 — 그 드리프트는 이 파일이
 * 아니라 web-platform-test-gate.test.mjs의 자기검증(실제 두 jest.web.config.js 원문을 읽어 이 값과
 * 대조)이 잡는다(reporter-app-thinness-gate.test.mjs의 APP_LINE_BASELINE 자기검증과 동형 사상).
 */
export const JEST_WEB_TESTMATCH_ROOT_SEGMENT = 'src';

// ── 순수 함수 ────────────────────────────────────────────────────────────────────

/**
 * .web.ts(x) 파일명에서 접미사를 뗀 "맨 이름"을 얻는다.
 * @param {string} fileName 예: 'register-service-worker.web.ts'
 * @returns {string} 예: 'register-service-worker'
 */
export function bareModuleName(fileName) {
  return fileName.replace(WEB_FILE_RE, '');
}

/**
 * 리포 루트 기준 상대경로에서 앱 이름을 뽑는다. apps/<app>/... 형태가 아니면 null.
 * @param {string} relFile
 * @returns {string|null}
 */
export function appOf(relFile) {
  const segments = relFile.split('/');
  if (segments[0] !== 'apps' || !segments[1]) return null;
  return segments[1];
}

/**
 * 상대경로의 부모 디렉터리(리포 루트 기준, posix 구분자).
 * @param {string} relFile
 * @returns {string}
 */
export function dirOf(relFile) {
  const idx = relFile.lastIndexOf('/');
  return idx === -1 ? '' : relFile.slice(0, idx);
}

/**
 * `.web.*` 파일이 jest.web.config.js의 testMatch가 실제로 도달할 수 있는 루트
 * (`apps/<app>/${JEST_WEB_TESTMATCH_ROOT_SEGMENT}/`) 아래에 있는지 확인한다. `apps/<app>/app/...`
 * 처럼 그 바깥에 있으면 false — 옆에 `__web_tests__`를 아무리 정확히 둬도 jest가 절대 선택하지
 * 않는다(위 JEST_WEB_TESTMATCH_ROOT_SEGMENT 주석 참조).
 * @param {string} relFile
 * @returns {boolean}
 */
export function isUnderJestScannableRoot(relFile) {
  const app = appOf(relFile);
  if (!app) return false;
  return relFile.startsWith(`apps/${app}/${JEST_WEB_TESTMATCH_ROOT_SEGMENT}/`);
}

/**
 * 소스 텍스트에서 import/require 문자열 리터럴 경로를 전부 뽑는다.
 * @param {string} content
 * @returns {string[]}
 */
export function extractImportSpecifiers(content) {
  const specifiers = [];
  const re = new RegExp(IMPORT_SPECIFIER_RE);
  let m;
  while ((m = re.exec(content))) {
    specifiers.push(m[1]);
  }
  return specifiers;
}

/**
 * content 안의 어떤 상대경로 import/require든 마지막 세그먼트(확장자 제외)가 정확히 bareName과
 * 같으면 true. '../uploader.web' 같은 명시 접미사 경로는 마지막 세그먼트가 'uploader.web'이라
 * bareName('uploader')과 다르므로 매칭되지 않는다(의도된 동작 — 위 헤더 §3 참조).
 * @param {string} content
 * @param {string} bareName
 * @returns {boolean}
 */
export function importsBareModule(content, bareName) {
  return extractImportSpecifiers(content).some((spec) => {
    if (!spec.startsWith('.')) return false; // 상대경로만 인정 — 패키지 import는 대상이 아니다
    const lastSegment = spec.split('/').pop() ?? '';
    const stripped = lastSegment.replace(/\.(ts|tsx|js|jsx)$/, '');
    return stripped === bareName;
  });
}

// ── 허용 목록 (규율 21 — 사유는 의미 있어야 인정된다. isMeaningfulReason은
//    controller-role-gate.mjs에서 cross-import — 사본 금지) ─────────────────────────
/**
 * @typedef {{ file: string, reason: string }} WebLoadAllowlistEntry
 * @type {WebLoadAllowlistEntry[]}
 */
export const WEB_LOAD_ALLOWLIST = [];

/**
 * @param {WebLoadAllowlistEntry[]} allowlist
 * @param {string} relFile
 * @returns {WebLoadAllowlistEntry|undefined}
 */
export function findAllowlistEntry(allowlist, relFile) {
  const normalized = relFile.split(sep).join('/');
  return allowlist.find((e) => e.file === normalized);
}

/** 허용목록 유무·의미 있는 사유 여부에 따라 최종 판정을 내리는 공통 분기(순수). */
function allowlistedOrViolation(relFile, allowlist, defaultReason) {
  const entry = findAllowlistEntry(allowlist, relFile);
  if (entry && isMeaningfulReason(entry.reason)) {
    return { file: relFile, ok: true, viaAllowlist: true, reason: entry.reason };
  }
  return {
    file: relFile,
    ok: false,
    viaAllowlist: false,
    reason: entry
      ? '허용목록에 있으나 사유가 무의미함(규율 21) — 위반으로 취급'
      : defaultReason,
  };
}

// ── 파일 1건 판정 — 순수 함수(입력은 이미 읽어들인 데이터) ──────────────────────────

/**
 * 판정 순서(전부 필요조건 — 하나라도 실패하면 그 시점에서 위반): app 소속 → wired(웹 테스트
 * 인프라 존재) → 위치(JEST_WEB_TESTMATCH_ROOT_SEGMENT 아래인가, 2026-09-12 추가) → 로드 증거
 * (접미사 없는 import).
 * @param {{ relFile: string, wired: boolean, testFileContents: string[] }} args
 *   wired: 그 app에 jest.web.config.js + package.json test:web 스크립트가 둘 다 있는가
 *   testFileContents: 같은 디렉터리 __web_tests__ 하위 *.test.ts(x) 파일들의 원문
 * @param {WebLoadAllowlistEntry[]} allowlist
 * @returns {{ file: string, ok: boolean, viaAllowlist: boolean, reason: string|null }}
 */
export function judgeWebPlatformFile({ relFile, wired, testFileContents }, allowlist = WEB_LOAD_ALLOWLIST) {
  const app = appOf(relFile);
  if (!app) {
    return allowlistedOrViolation(
      relFile,
      allowlist,
      'apps/<app>/ 바깥 파일이다 — 이 게이트가 판정 가능한 test:web 축이 없다',
    );
  }
  if (!wired) {
    return allowlistedOrViolation(
      relFile,
      allowlist,
      `apps/${app}에 jest.web.config.js 또는 package.json test:web 스크립트가 없다`,
    );
  }
  if (!isUnderJestScannableRoot(relFile)) {
    return allowlistedOrViolation(
      relFile,
      allowlist,
      `apps/${app}/${JEST_WEB_TESTMATCH_ROOT_SEGMENT}/ 바깥이다(예: app/) — jest.web.config.js의 ` +
        `testMatch는 apps/${app}/${JEST_WEB_TESTMATCH_ROOT_SEGMENT}/**/__web_tests__/**만 스캔해, ` +
        `이 파일 옆에 __web_tests__를 아무리 정확히 둬도 jest가 그 테스트를 절대 선택하지 않는다 ` +
        `(대장 #188·#210 축 — app/** 배치 사각). ` +
        `apps/${app}/${JEST_WEB_TESTMATCH_ROOT_SEGMENT}/ 아래로 파일을 옮기거나(권장), ` +
        `jest.web.config.js의 testMatch를 이 파일이 있는 경로까지 넓혀야 한다.`,
    );
  }
  const bareName = bareModuleName(relFile.split('/').pop());
  const loaded = testFileContents.some((c) => importsBareModule(c, bareName));
  if (!loaded) {
    return allowlistedOrViolation(
      relFile,
      allowlist,
      `${dirOf(relFile)}/__web_tests__/**의 어떤 테스트도 접미사 없는 '${bareName}' 경로를 import하지 않는다`,
    );
  }
  return { file: relFile, ok: true, viaAllowlist: false, reason: null };
}

// ── 허용 목록 부패(allowlist rot) 검출 — 순수 함수 ──────────────────────────────────

/**
 * 실존하지 않거나(파일이 사라짐) 이미 허용목록 없이도 통과하는(더 이상 필요 없는) 엔트리를 찾는다.
 * @param {WebLoadAllowlistEntry[]} allowlist
 * @param {{ relFile: string, wired: boolean, testFileContents: string[] }[]} fileInputs 현재 존재하는 .web.* 파일들의 판정 입력
 * @returns {WebLoadAllowlistEntry[]}
 */
export function findDeadAllowlistEntries(allowlist, fileInputs) {
  const byFile = new Map(fileInputs.map((f) => [f.relFile, f]));
  return allowlist.filter((e) => {
    const input = byFile.get(e.file);
    if (!input) return true; // 파일이 사라졌다 — 죽은 엔트리
    // 허용목록 없이(빈 배열) 판정해 이미 자력으로 통과하면 더 이상 필요 없는 엔트리다.
    const withoutAllowlist = judgeWebPlatformFile(input, []);
    return withoutAllowlist.ok;
  });
}

// ── 전체 실행 — fs 접근 ────────────────────────────────────────────────────────────

/**
 * dir 이하를 재귀 탐색해 predicate(entry.name)가 true인 파일의 절대경로를 모은다.
 * IGNORED_DIR_NAMES는 내려가지 않는다.
 * @param {string} dir
 * @param {(name: string) => boolean} predicate
 * @returns {string[]}
 */
function walkFiles(dir, predicate) {
  const results = [];
  if (!existsSync(dir)) return results;
  const walk = (d) => {
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (IGNORED_DIR_NAMES.has(entry.name)) continue;
        walk(join(d, entry.name));
        continue;
      }
      if (entry.isFile() && predicate(entry.name)) {
        results.push(join(d, entry.name));
      }
    }
  };
  walk(dir);
  return results;
}

/**
 * 리포 전체에서 .web.ts(x)/.web.js(x) 파일을 재귀 탐색한다(node_modules 등 생성물 제외).
 * @param {string} repoRoot
 * @returns {string[]} 절대경로 목록(정렬됨)
 */
export function findWebPlatformFiles(repoRoot) {
  return walkFiles(repoRoot, (name) => WEB_FILE_RE.test(name)).sort();
}

/**
 * apps/<app>에 jest.web.config.js와 package.json의 test:web 스크립트가 둘 다 있는지 확인한다.
 * @param {string} repoRoot
 * @param {string} app
 * @returns {boolean}
 */
export function isWebTestScriptWired(repoRoot, app) {
  const configPath = join(repoRoot, 'apps', app, 'jest.web.config.js');
  if (!existsSync(configPath)) return false;
  const pkgPath = join(repoRoot, 'apps', app, 'package.json');
  if (!existsSync(pkgPath)) return false;
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    return typeof pkg.scripts?.['test:web'] === 'string' && pkg.scripts['test:web'].trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * absWebFile과 같은 디렉터리의 __web_tests__ 하위(재귀) *.test.ts(x) 파일들의 원문을 읽는다.
 * @param {string} absWebFile
 * @returns {string[]}
 */
export function readSiblingWebTestContents(absWebFile) {
  const testDir = join(dirname(absWebFile), '__web_tests__');
  const files = walkFiles(testDir, (name) => TEST_FILE_RE.test(name));
  return files.map((f) => readFileSync(f, 'utf8'));
}

/**
 * @param {string} repoRoot
 * @param {WebLoadAllowlistEntry[]} allowlist
 */
export function checkRepo(repoRoot, allowlist = WEB_LOAD_ALLOWLIST) {
  const absFiles = findWebPlatformFiles(repoRoot);
  if (absFiles.length === 0) {
    return {
      ok: false,
      results: [],
      deadAllowlistEntries: [],
      reason: `.web.* 파일을 리포에서 하나도 찾지 못했다: ${repoRoot}`,
    };
  }

  const wiredCache = new Map(); // app -> boolean
  const fileInputs = absFiles.map((abs) => {
    const relFile = abs.slice(repoRoot.length + 1).split(sep).join('/');
    const app = appOf(relFile);
    let wired = false;
    if (app) {
      if (!wiredCache.has(app)) wiredCache.set(app, isWebTestScriptWired(repoRoot, app));
      wired = wiredCache.get(app);
    }
    const testFileContents = wired ? readSiblingWebTestContents(abs) : [];
    return { relFile, wired, testFileContents };
  });

  const results = fileInputs.map((input) => judgeWebPlatformFile(input, allowlist));
  const deadAllowlistEntries = findDeadAllowlistEntries(allowlist, fileInputs);

  return {
    ok: results.every((r) => r.ok) && deadAllowlistEntries.length === 0,
    results,
    deadAllowlistEntries,
  };
}

// ── CLI ───────────────────────────────────────────────────────────────────────

function main() {
  console.log('── 웹 플랫폼(.web.*) 테스트 배선 게이트 (동반 의무 D1, QUEUE 2-2·대장 #178) ──');

  const args = process.argv.slice(2);
  const repoRootIdx = args.indexOf('--repo-root');
  const repoRoot = repoRootIdx >= 0 ? args[repoRootIdx + 1] : REPO_ROOT;

  const outcome = checkRepo(repoRoot);

  if (outcome.results.length === 0) {
    console.error(`\n판정: FAIL — ${outcome.reason}`);
    process.exitCode = 1;
    return;
  }

  let anyFail = false;
  let viaAllowlistCount = 0;
  for (const r of outcome.results) {
    if (r.ok) {
      if (r.viaAllowlist) {
        viaAllowlistCount += 1;
        console.log(`  ✔ ${r.file} (허용목록 경유: ${r.reason})`);
      } else {
        console.log(`  ✔ ${r.file}`);
      }
    } else {
      anyFail = true;
      console.error(`  ✘ ${r.file}: ${r.reason}`);
    }
  }

  if (outcome.deadAllowlistEntries.length > 0) {
    anyFail = true;
    console.error(`  ✘ 허용목록 부패: 더 이상 필요 없거나 실존하지 않는 죽은 엔트리 ${outcome.deadAllowlistEntries.length}건`);
    for (const e of outcome.deadAllowlistEntries) {
      console.error(
        `      - ${e.file}: 파일이 사라졌거나 이제 허용목록 없이도 통과한다 — WEB_LOAD_ALLOWLIST에서 제거해야 한다.`,
      );
    }
  }

  if (anyFail || !outcome.ok) {
    console.error(
      '\n판정: FAIL — 위 파일에 apps/<app>/src/**/__web_tests__/**에 접미사 없는 import 테스트를 ' +
        '추가하거나(권장 — apps/reporter/src/upload/__web_tests__/http-upload-service.test.ts 참고), ' +
        'WEB_LOAD_ALLOWLIST에 의미 있는 사유와 함께 등재해야 한다. 죽은 허용목록 엔트리는 제거해야 한다.',
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `\n판정: PASS — .web.* 파일 ${outcome.results.length}개 전부 웹 축 테스트 배선 확인` +
      `(허용목록 경유 ${viaAllowlistCount}건, 죽은 엔트리 0건).`,
  );
}

const isMainModule = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  main();
}
