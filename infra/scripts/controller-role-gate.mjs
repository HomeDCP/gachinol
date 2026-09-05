#!/usr/bin/env node
/**
 * infra/scripts/controller-role-gate.mjs
 *
 * 동반 의무 D1(대장 #181) 기계화 — "NestJS 컨트롤러의 모든 라우트는 @Roles 또는 @Public 중
 * 하나를 반드시 갖는다"를 CI에서 fail-closed로 확인한다.
 *
 * ── 왜 있는가 (대장 #181) ────────────────────────────────────────────────────────
 * `stations.controller.ts`의 `GET /stations`·`GET /stations/:id`에 `@Roles`가 빠져 있었다.
 * `RolesGuard`는 `@Roles` 데코레이터가 없으면 "인증만 요구"로 통과시키므로(수퍼롤 admin뿐 아니라
 * **어떤 인증된 role도 통과**), `role='subscriber'` 토큰으로도 관리용 지사 목록(supportTel·
 * dormantSince·sortOrder)을 읽을 수 있었다. 같은 컨트롤러의 다른 라우트(`@Post()` 등)에는
 * `@Roles('admin')`이 붙어 있어 이 누락은 우연이 아니라 **검사가 닿지 않는 축**이었다
 * (로컬 3게이트 어느 것도 "라우트에 권한 데코레이터가 있는가"를 보지 않는다).
 *
 * ⚠️ 이 리포는 `@Roles`/`@Public`을 라우트 데코레이터(`@Get()`/`@Post()` 등) **아래**에 쓴다
 * (`@Get()` 다음 줄에 `@Roles(...)`). 단순히 "메서드 바로 위 한 줄만" 본다면 그 위치엔 보통
 * `@ApiOperation(...)`이 있어 **대량 오탐**이 난다(실측 42건) — 그래서 이 스크립트는 메서드 위에
 * **연속된 데코레이터 스택 전체**를 수집한다(괄호 깊이 추적, 문자열 내용은 건너뜀).
 *
 * ── 검사 정의 ────────────────────────────────────────────────────────────────────
 * `services/api/src` 아래 모든 `*.controller.ts`에 대해:
 *   1) 파일을 클래스 단위로 스캔한다(`@Controller(...)`가 붙은 클래스만 대상 — 같은 파일에
 *      다른 클래스가 있어도(예: auth.controller.ts의 `WebCsrfGuard`) 무시한다).
 *   2) 각 클래스 멤버 중 HTTP verb 데코레이터(`@Get`·`@Post`·`@Put`·`@Patch`·`@Delete`·`@All`·
 *      `@Options`·`@Head`)가 붙은 것만 "라우트"로 센다.
 *   3) 그 라우트의 데코레이터 스택(+ 클래스 레벨 데코레이터, NestJS Reflector의
 *      `getAllAndOverride([handler, class])`와 동형)에 `@Roles`나 `@Public`이 있으면 통과.
 *   4) 없으면 위반 — 단, 아래 허용 목록(`ROLE_GATE_ALLOWLIST`)에 **의미 있는 사유**와 함께
 *      등재돼 있으면 통과(§ "허용 목록" 참조).
 *   5) 전 파일 스캔이 끝나면 `ROLE_GATE_ALLOWLIST`를 역방향으로도 검사한다 — 등재된 엔트리
 *      (`file`+`method`)에 **실제로 매칭되는 라우트가 하나도 없으면** 위반(§ "허용 목록 부패
 *      방지" 참조). 4)는 "라우트 → 허용목록"만 보고, 5)는 "허용목록 → 라우트"를 본다.
 * 위반이 1건이라도 있으면 exit 1(죽은 허용목록 엔트리 포함). 컨트롤러 파일을 하나도 못 찾아도
 * exit 1(조용한 통과 금지).
 *
 * ── 허용 목록과 규율 21 "있는 척" 방지 ────────────────────────────────────────────
 * `POST /auth/logout`·`GET /auth/me`처럼 role과 무관하게 **인증된 사용자 누구나** 접근해야
 * 정당한 라우트가 있다. 이런 라우트는 `ROLES_ALLOWLIST`에 사유와 함께 등재해 예외로 둔다.
 * ⚠️ 직전 슬라이스(`check-destructive-migrations.mjs`)가 밟은 함정 그대로 재현하지 않는다:
 * 마커 칸에 `-`·`n/a`를 넣어도 통과하면 허용 목록이 사실상 무제한 화이트리스트가 된다.
 * 그래서 `isMeaningfulReason`이 최소 길이 + 최소 문자 다양성(반복 문자 자리표시자 차단)을
 * 강제한다 — 빈칸·짧은 값·저-엔트로피 값은 "사유 없음"과 동일하게 취급해 **위반으로 판정한다**
 * (허용이 아니라 위반 쪽으로 fail-closed — 침묵의 관대함을 허용하지 않는다).
 * ⚠️ **`isMeaningfulReason`의 한계(과장 금지)**: 이 함수는 **순수 어휘적 휴리스틱**(공백 제외
 * 길이 + 서로 다른 문자 종류 수)일 뿐이다. 사유의 **의미**를 이해하지 않는다 — `'not applicable
 * here'`·`'unable to determine'`·`'1234123412'`처럼 길고 문자 종류만 다양하면 실제로는 무의미한
 * 문자열도 통과한다. 이 함수가 실제로 막는 것은 `-`·`n/a`·`TODO`·반복 문자류의 **리터럴
 * 자리표시자뿐**이다. 의미론적 타당성(그 사유가 진짜 말이 되는가) 검증은 정규식/휴리스틱으로
 * 닫을 수 있는 범위 밖이라 이 스크립트가 책임지지 않는다 — 최종 방어선은 사람 리뷰다.
 *
 * ── 허용 목록 부패(allowlist rot) 방지 ───────────────────────────────────────────
 * 라우트가 리네임·삭제돼도 `ROLE_GATE_ALLOWLIST` 엔트리는 자동으로 없어지지 않는다. 죽은
 * 엔트리를 방치하면 아무도 알아채지 못한 채 남아 있다가, **나중에 같은 이름의 새 라우트가
 * 생기면 그것을 조용히 면제**시킬 수 있다(허용목록이 라우트 존재를 검증하지 않고 문자열
 * 매칭만 하기 때문). 그래서 `checkAllControllers`는 전 파일 스캔 후 각 엔트리가 실제 라우트에
 * 매칭됐는지 역검사하고, 매칭되지 않는 엔트리가 있으면 fail-closed로 위반 처리한다
 * (`findUnusedAllowlistEntries`).
 *
 * ── 지원 범위(의도적으로 좁다) ───────────────────────────────────────────────────
 * 문자열은 `'`·`"`·백틱만 인식하고(백틱 템플릿의 `${...}` 내부 중첩은 추적하지 않는다 — 이
 * 리포의 데코레이터 인자에 템플릿 리터럴 보간은 쓰이지 않는다), 파일 끝까지 문자열/블록주석이
 * 닫히지 않거나 괄호 깊이가 0으로 돌아오지 않으면 **예외를 던진다**(추측 파싱 금지 — 지원하지
 * 않는 문법을 만나면 조용히 틀리는 것보다 죽는 편이 낫다, dockerfile-workspace-deps.mjs와 동형).
 *
 * ── 사용법 ────────────────────────────────────────────────────────────────────
 *   node infra/scripts/controller-role-gate.mjs
 *   node infra/scripts/controller-role-gate.mjs --repo-root /path/to/other/repo   # 테스트용
 * 종료 코드: 0=전 라우트 통과(허용 목록 포함) 이고 허용목록 죽은 엔트리 0건 / 1=미허용 위반 1건 이상
 * 또는 컨트롤러 0건 또는 파싱 실패 또는 허용목록 죽은 엔트리 1건 이상
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** HTTP verb 데코레이터 — 이 중 하나가 있어야 "라우트"로 센다(그 외 멤버는 무시). */
const HTTP_VERB_DECORATORS = new Set([
  'Get',
  'Post',
  'Put',
  'Patch',
  'Delete',
  'All',
  'Options',
  'Head',
]);

/** 게이트로 인정하는 데코레이터 — 이 중 하나가 라우트 또는 클래스 레벨에 있으면 통과. */
const GATE_DECORATORS = new Set(['Roles', 'Public']);

// ── 허용 목록 (규율 21 — 사유는 의미 있어야 인정된다) ────────────────────────────

/**
 * @typedef {{ file: string, method: string, reason: string }} AllowlistEntry
 * @type {AllowlistEntry[]}
 */
export const ROLE_GATE_ALLOWLIST = [
  {
    file: 'services/api/src/auth/auth.controller.ts',
    method: 'logout',
    reason:
      'POST /auth/logout — 로그아웃은 role과 무관하게 인증된 사용자 누구나 자신의 세션(refresh family)을 ' +
      '끝낼 수 있어야 하는 라우트다. role별 접근 제한이 아니라 "인증됐는가"만 필요(대장 #181 D1 검토, 2026-09).',
  },
  {
    file: 'services/api/src/auth/auth.controller.ts',
    method: 'me',
    reason:
      'GET /auth/me — 내 정보 조회는 access 토큰이 곧 대상(자기 자신)을 결정하므로 role 게이트가 ' +
      '의미가 없다(모든 role이 자기 자신 정보는 봐야 한다, 대장 #181 D1 검토, 2026-09).',
  },
];

// ── 문자열/주석을 건너뛰는 괄호 깊이 스캐너 — 순수 함수 ────────────────────────────

/**
 * 한 줄의 괄호/중괄호/대괄호 깊이 변화량을 계산한다. 문자열(`'`·`"`·백틱) 내부와 주석
 * (`//`·`/* *\/`) 내부의 괄호는 세지 않는다. `state`는 호출 간 이어지는 상태(여러 줄 문자열·
 * 블록주석)를 들고 다니며 in-place로 갱신된다.
 * @param {string} line
 * @param {{ inString: string|null, inBlockComment: boolean }} state
 * @returns {number}
 */
export function scanLineBrackets(line, state) {
  let delta = 0;
  let i = 0;
  while (i < line.length) {
    const c = line[i];
    if (state.inBlockComment) {
      if (c === '*' && line[i + 1] === '/') {
        state.inBlockComment = false;
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }
    if (state.inString) {
      if (c === '\\') {
        i += 2; // 이스케이프 문자 — 다음 글자는 검사하지 않고 건너뜀
        continue;
      }
      if (c === state.inString) state.inString = null;
      i += 1;
      continue;
    }
    if (c === '/' && line[i + 1] === '/') break; // 줄 끝까지 라인 주석 — 남은 글자 무시
    if (c === '/' && line[i + 1] === '*') {
      state.inBlockComment = true;
      i += 2;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      state.inString = c;
      i += 1;
      continue;
    }
    if (c === '(' || c === '{' || c === '[') {
      delta += 1;
      i += 1;
      continue;
    }
    if (c === ')' || c === '}' || c === ']') {
      delta -= 1;
      i += 1;
      continue;
    }
    i += 1;
  }
  return delta;
}

// ── 컨트롤러 파일 → 클래스·라우트 구조 추출 — 순수 함수 ────────────────────────────

const CLASS_DECL_RE = /^(export\s+)?(abstract\s+)?class\s+([A-Za-z_$][\w$]*)/;
const DECORATOR_NAME_RE = /^@([A-Za-z_$][\w$]*)/;
const MEMBER_NAME_RE =
  /^(private\s+|public\s+|protected\s+|readonly\s+|static\s+|async\s+|get\s+|set\s+)*([A-Za-z_$][\w$]*)\s*[(:=]/;

/**
 * TypeScript 컨트롤러 소스를 클래스 단위로 스캔해 각 클래스의 데코레이터·멤버(데코레이터 스택
 * 포함)를 추출한다. `@Controller`가 없는 클래스(예: 같은 파일의 가드·헬퍼 클래스)도 구조는
 * 수집하되 호출측이 걸러낸다.
 * @param {string} content
 * @returns {{ controllers: { className: string, classDecorators: string[], routes: { methodName: string, decoratorNames: string[], line: number, isRoute: boolean }[] }[] }}
 */
export function extractControllerRoutes(content) {
  const lines = content.split('\n');
  const state = { inString: null, inBlockComment: false };
  let depth = 0;
  let mode = 'file'; // 'file' | 'classBody'
  let classBodyDepth = null;
  let pendingDecorators = [];
  let currentClass = null;
  /** @type {{ className: string, classDecorators: string[], routes: { methodName: string, decoratorNames: string[], line: number, isRoute: boolean }[] }[]} */
  const controllers = [];

  for (let idx = 0; idx < lines.length; idx += 1) {
    const line = lines[idx];
    const startDepth = depth;
    const trimmed = line.trim();
    const atTopLevel =
      !state.inString &&
      !state.inBlockComment &&
      ((mode === 'file' && startDepth === 0) || (mode === 'classBody' && startDepth === classBodyDepth));

    if (atTopLevel) {
      if (mode === 'file') {
        const classMatch = trimmed.match(CLASS_DECL_RE);
        if (classMatch) {
          currentClass = { className: classMatch[3], classDecorators: pendingDecorators, routes: [] };
          pendingDecorators = [];
          controllers.push(currentClass);
          depth += scanLineBrackets(line, state);
          mode = 'classBody';
          classBodyDepth = depth;
          continue; // 이 줄의 괄호 반영은 이미 위에서 했다
        }
        if (trimmed.startsWith('@')) {
          const m = trimmed.match(DECORATOR_NAME_RE);
          if (m) pendingDecorators.push(m[1]);
        } else if (
          trimmed === '' ||
          trimmed.startsWith('//') ||
          trimmed.startsWith('/*') ||
          trimmed.startsWith('*')
        ) {
          // 빈 줄·주석 — 대기 중인 데코레이터를 유지한다(그 사이에 있어도 같은 대상)
        } else {
          // import 등 다른 파일 레벨 statement — 이어지지 않는 잔존 데코레이터 방지
          pendingDecorators = [];
        }
      } else {
        // classBody
        if (trimmed.startsWith('@')) {
          const m = trimmed.match(DECORATOR_NAME_RE);
          if (m) pendingDecorators.push(m[1]);
        } else if (
          trimmed === '' ||
          trimmed.startsWith('//') ||
          trimmed.startsWith('/*') ||
          trimmed.startsWith('*') ||
          trimmed === '}'
        ) {
          // 빈 줄·주석·클래스 닫는 중괄호 자체는 멤버로 취급하지 않는다
        } else {
          const mm = trimmed.match(MEMBER_NAME_RE);
          const methodName = mm ? mm[2] : trimmed.slice(0, 40);
          const decoratorNames = pendingDecorators;
          currentClass.routes.push({
            methodName,
            decoratorNames,
            line: idx + 1,
            isRoute: decoratorNames.some((d) => HTTP_VERB_DECORATORS.has(d)),
          });
          pendingDecorators = [];
        }
      }
    }

    depth += scanLineBrackets(line, state);

    if (mode === 'classBody' && depth < classBodyDepth) {
      mode = 'file';
      classBodyDepth = null;
      pendingDecorators = [];
      currentClass = null;
    }
  }

  if (state.inString) {
    throw new Error('파싱 실패 — 문자열이 파일 끝까지 닫히지 않음(지원하지 않는 문법)');
  }
  if (state.inBlockComment) {
    throw new Error('파싱 실패 — 블록주석이 파일 끝까지 닫히지 않음(지원하지 않는 문법)');
  }
  if (depth !== 0) {
    throw new Error(`파싱 실패 — 괄호 깊이가 0으로 돌아오지 않음(최종 depth=${depth})`);
  }

  for (const c of controllers) {
    c.routes = c.routes.filter((r) => r.isRoute);
  }

  return { controllers };
}

// ── 허용 목록 판정 — 순수 함수 ─────────────────────────────────────────────────────

/** 최소 길이(공백 제외). 규율 21 — `-`·`n/a` 류 자리표시자는 이 미만이다. */
const MIN_REASON_CHARS = 10;
/** 최소 서로 다른 문자 종류. 반복 문자(`----------`) 우회를 막는 보조 조건. */
const MIN_REASON_UNIQUE_CHARS = 4;

function nonWhitespace(text) {
  return (text ?? '').replace(/\s+/g, '');
}

/**
 * 허용 목록 사유가 "실제로 검토했다"고 볼 수 있는 최소 신호를 갖는지 판정한다.
 * 빈칸·`-`·`n/a`·`TODO`·반복 문자는 전부 무의미로 친다(규율 21 — 있는 척 방지).
 * @param {string|undefined|null} reason
 * @returns {boolean}
 */
export function isMeaningfulReason(reason) {
  const compact = nonWhitespace(reason);
  if (compact.length < MIN_REASON_CHARS) return false;
  if (new Set(compact).size < MIN_REASON_UNIQUE_CHARS) return false;
  return true;
}

/**
 * @param {AllowlistEntry[]} allowlist
 * @param {string} relFile 리포 루트 기준 상대경로(예: 'src/auth/auth.controller.ts')
 * @param {string} methodName
 * @returns {AllowlistEntry|undefined}
 */
export function findAllowlistEntry(allowlist, relFile, methodName) {
  // 경로 구분자(윈도우 대비) 정규화 — 이 리포는 posix지만 방어적으로 both를 받는다
  const normalized = relFile.split(sep).join('/');
  return allowlist.find((e) => e.file === normalized && e.method === methodName);
}

// ── 라우트 1건 판정 — 순수 함수 ─────────────────────────────────────────────────────

/**
 * @param {{ methodName: string, decoratorNames: string[], line: number }} route
 * @param {string[]} classDecorators
 * @param {AllowlistEntry[]} allowlist
 * @param {string} relFile
 * @returns {{ methodName: string, line: number, ok: boolean, viaAllowlist: boolean, reason: string|null }}
 */
export function judgeRoute(route, classDecorators, allowlist, relFile) {
  const gatedDirectly =
    route.decoratorNames.some((d) => GATE_DECORATORS.has(d)) ||
    classDecorators.some((d) => GATE_DECORATORS.has(d));
  if (gatedDirectly) {
    return { methodName: route.methodName, line: route.line, ok: true, viaAllowlist: false, reason: null };
  }
  const entry = findAllowlistEntry(allowlist, relFile, route.methodName);
  if (entry && isMeaningfulReason(entry.reason)) {
    return {
      methodName: route.methodName,
      line: route.line,
      ok: true,
      viaAllowlist: true,
      reason: entry.reason,
    };
  }
  return {
    methodName: route.methodName,
    line: route.line,
    ok: false,
    viaAllowlist: false,
    reason: entry
      ? '허용 목록에 있으나 사유가 무의미함(규율 21) — 위반으로 취급'
      : '@Roles·@Public 둘 다 없음(클래스 레벨 포함)',
  };
}

// ── 컨트롤러 파일 1개 판정 — 순수 함수(입력은 이미 읽어들인 문자열) ─────────────────

/**
 * @param {{ relFile: string, content: string, allowlist?: AllowlistEntry[] }} args
 */
export function checkControllerFile({ relFile, content, allowlist = ROLE_GATE_ALLOWLIST }) {
  const { controllers } = extractControllerRoutes(content);
  const realControllers = controllers.filter((c) => c.classDecorators.includes('Controller'));
  if (realControllers.length === 0) {
    throw new Error(
      `파싱 실패 — '${relFile}'에서 @Controller가 붙은 클래스를 찾지 못함(*.controller.ts 명명 규약 위반 가능성)`,
    );
  }

  const routeResults = [];
  /** @type {string[]} `${relFile}#${methodName}` 형태 — 이 파일에 실존하는 라우트 키(허용목록 역검사용) */
  const routeKeys = [];
  for (const c of realControllers) {
    for (const r of c.routes) {
      routeResults.push({ className: c.className, ...judgeRoute(r, c.classDecorators, allowlist, relFile) });
      routeKeys.push(`${relFile}#${r.methodName}`);
    }
  }

  const violations = routeResults.filter((r) => !r.ok);
  const allowed = routeResults.filter((r) => r.ok && r.viaAllowlist);
  return {
    relFile,
    routeCount: routeResults.length,
    violations,
    allowed,
    routeKeys,
    ok: violations.length === 0,
  };
}

// ── 허용 목록 부패(allowlist rot) 검출 — 순수 함수 ──────────────────────────────────

/**
 * `ROLE_GATE_ALLOWLIST` 엔트리 중 실제로 존재하는 라우트에 하나도 매칭되지 않는(=죽은) 엔트리를
 * 찾는다. 라우트가 리네임·삭제됐는데 허용목록 엔트리만 방치되면, 훗날 같은 이름의 새 라우트가
 * 생겼을 때 그 엔트리가 조용히 그 라우트를 면제시킬 수 있다(§ "허용 목록 부패 방지" 참조).
 * @param {AllowlistEntry[]} allowlist
 * @param {Set<string>|string[]} existingRouteKeys `${relFile}#${methodName}` 형태의 실존 라우트 키 전체
 * @returns {AllowlistEntry[]} 매칭되는 라우트가 없는 엔트리 목록(원본 순서 유지)
 */
export function findUnusedAllowlistEntries(allowlist, existingRouteKeys) {
  const keySet = existingRouteKeys instanceof Set ? existingRouteKeys : new Set(existingRouteKeys);
  return allowlist.filter((e) => !keySet.has(`${e.file}#${e.method}`));
}

// ── 전체 실행 — fs 접근 ────────────────────────────────────────────────────────────

/**
 * `services/api/src` 아래 `*.controller.ts`(스펙 파일 제외)를 재귀 탐색한다.
 * @param {string} repoRoot
 * @returns {string[]} 절대경로 목록(정렬됨)
 */
export function findControllerFiles(repoRoot) {
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
      if (entry.isFile() && entry.name.endsWith('.controller.ts') && !entry.name.includes('.spec.')) {
        results.push(full);
      }
    }
  };
  walk(root);
  return results.sort();
}

/**
 * @param {string} repoRoot
 * @param {AllowlistEntry[]} allowlist
 */
export function checkAllControllers(repoRoot, allowlist = ROLE_GATE_ALLOWLIST) {
  const files = findControllerFiles(repoRoot);
  if (files.length === 0) {
    return {
      ok: false,
      results: [],
      unusedAllowlistEntries: [],
      reason: `컨트롤러 파일을 하나도 찾지 못했다: ${join(repoRoot, 'services', 'api', 'src')}`,
    };
  }

  const results = files.map((abs) => {
    const relFile = relative(repoRoot, abs).split(sep).join('/');
    const content = readFileSync(abs, 'utf8');
    return checkControllerFile({ relFile, content, allowlist });
  });

  const existingRouteKeys = new Set(results.flatMap((r) => r.routeKeys));
  const unusedAllowlistEntries = findUnusedAllowlistEntries(allowlist, existingRouteKeys);

  return {
    ok: results.every((r) => r.ok) && unusedAllowlistEntries.length === 0,
    results,
    unusedAllowlistEntries,
  };
}

// ── CLI ───────────────────────────────────────────────────────────────────────

function main() {
  console.log('── 컨트롤러 라우트 권한 게이트 검사 (동반 의무 D1, 대장 #181) ──');

  const args = process.argv.slice(2);
  const repoRootIdx = args.indexOf('--repo-root');
  const repoRoot = repoRootIdx >= 0 ? args[repoRootIdx + 1] : REPO_ROOT;

  // 허용 목록 자체도 규율 21을 지켜야 한다 — 사유가 무의미하면 그 항목은 즉시 판정 실패로 드러난다
  // (checkAllControllers 실행 중 자연히 violations로 나타나므로 별도 사전 검증은 생략).

  let outcome;
  try {
    outcome = checkAllControllers(repoRoot);
  } catch (err) {
    console.error(`검사 실행 실패: ${err.message}`);
    process.exitCode = 1;
    return;
  }

  if (outcome.results.length === 0) {
    console.error(`\n판정: FAIL — ${outcome.reason}`);
    process.exitCode = 1;
    return;
  }

  let totalRoutes = 0;
  let totalAllowed = 0;
  let anyFail = false;
  for (const r of outcome.results) {
    totalRoutes += r.routeCount;
    totalAllowed += r.allowed.length;
    if (r.ok) {
      const allowedNote = r.allowed.length > 0 ? ` (허용목록 ${r.allowed.length}건 포함)` : '';
      console.log(`  ✔ ${r.relFile}: 라우트 ${r.routeCount}건 전부 권한 게이트 보유${allowedNote}`);
    } else {
      anyFail = true;
      console.error(`  ✘ ${r.relFile}: 위반 ${r.violations.length}건`);
      for (const v of r.violations) {
        console.error(`      - ${v.className}.${v.methodName} (line ${v.line}): ${v.reason}`);
      }
    }
  }

  const unusedEntries = outcome.unusedAllowlistEntries ?? [];
  if (unusedEntries.length > 0) {
    anyFail = true;
    console.error(`  ✘ 허용목록 부패: 매칭되는 라우트가 없는 죽은 엔트리 ${unusedEntries.length}건`);
    for (const e of unusedEntries) {
      console.error(
        `      - ${e.file}#${e.method}: 이 file+method 조합의 라우트가 존재하지 않는다` +
          '(라우트 리네임·삭제 후 방치된 엔트리로 추정 — 같은 이름의 새 라우트를 조용히 면제시킬 수 있다).',
      );
    }
  }

  if (anyFail || !outcome.ok) {
    console.error(
      '\n판정: FAIL — 위 라우트에 @Roles 또는 @Public을 추가하거나(진짜 role 무관이면) ' +
        'ROLE_GATE_ALLOWLIST에 의미 있는 사유와 함께 등재해야 한다(대장 #181 재발 방지). ' +
        '죽은 허용목록 엔트리는 ROLE_GATE_ALLOWLIST에서 제거해야 한다(허용목록 부패 방지).',
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `\n판정: PASS — 컨트롤러 ${outcome.results.length}개, 라우트 ${totalRoutes}건 전부 권한 게이트 보유` +
      `(허용목록 경유 ${totalAllowed}건, 죽은 엔트리 0건).`,
  );
}

const isMainModule = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  main();
}
