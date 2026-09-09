// infra/scripts/controller-role-gate.test.mjs
// 동반 의무 D1(대장 #181) 단위 테스트 — "NestJS 컨트롤러의 모든 라우트가 @Roles 또는 @Public을
// 갖는가"를 fail-closed로 잡는지 확인한다.
//
// ⭐ 핵심은 "#181이 다시 일어나면 이 검사가 잡는가"다 — 아래 "#181 사례 재현" 블록이 그 증거다:
// stations.controller.ts에서 @Roles를 지운 상태를 픽스처로 재구성하고 checkControllerFile이
// 그것을 위반으로 잡아내는지 확인한다.
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
  scanLineBrackets,
  extractControllerRoutes,
  isMeaningfulReason,
  findAllowlistEntry,
  judgeRoute,
  checkControllerFile,
  findControllerFiles,
  checkAllControllers,
  findUnusedAllowlistEntries,
  ROLE_GATE_ALLOWLIST,
} from './controller-role-gate.mjs';

const SCRIPT_PATH = fileURLToPath(new URL('./controller-role-gate.mjs', import.meta.url));

// ── scanLineBrackets ─────────────────────────────────────────────────────────

test('scanLineBrackets: 단순 괄호 깊이 변화를 센다', () => {
  const state = { inString: null, inBlockComment: false };
  assert.equal(scanLineBrackets("@Roles('admin')", state), 0); // 열고 닫혀 순변화 0
  assert.equal(scanLineBrackets('@ApiOperation({', state), 2); // ( { 열림만
});

test('scanLineBrackets: 문자열 안의 괄호는 세지 않는다(한국어 문자열에 괄호가 섞여도 안전)', () => {
  const state = { inString: null, inBlockComment: false };
  const delta = scanLineBrackets(
    "@ApiOperation({ summary: '지사 목록 (관리 화면용 — 구독자 공개 목록은 GET /v1/feed/stations)' })",
    state,
  );
  assert.equal(delta, 0); // ( { 그리고 } ) 만 세고, 문자열 내부의 ( )는 무시 → 순변화 0
});

test('scanLineBrackets: 줄 주석 이후는 무시한다', () => {
  const state = { inString: null, inBlockComment: false };
  assert.equal(scanLineBrackets('@Roles() // 주석 안의 ( 도 무시', state), 0);
});

test('scanLineBrackets: 여러 줄 문자열은 state로 이어진다', () => {
  const state = { inString: null, inBlockComment: false };
  scanLineBrackets("const s = `line with (", state);
  assert.equal(state.inString, '`');
  // 다음 줄에서도 문자열 안이므로 괄호를 세지 않는다
  const delta = scanLineBrackets('still inside ) string`);', state);
  assert.equal(state.inString, null); // 백틱으로 닫힘
  assert.equal(delta, -1); // 문자열이 끝난 뒤의 ) 한 개만 카운트
});

// ── extractControllerRoutes ──────────────────────────────────────────────────

test('extractControllerRoutes: 단일 라우트 — @Get() 스택 위에 @Roles가 있으면 인식', () => {
  const src = [
    "@Controller('stations')",
    'export class StationsController {',
    '  @Get()',
    "  @Roles('center_operator')",
    "  @ApiOperation({ summary: 'x' })",
    '  list(): void {}',
    '}',
  ].join('\n');
  const { controllers } = extractControllerRoutes(src);
  assert.equal(controllers.length, 1);
  assert.equal(controllers[0].className, 'StationsController');
  assert.deepEqual(controllers[0].classDecorators, ['Controller']);
  assert.equal(controllers[0].routes.length, 1);
  assert.deepEqual(controllers[0].routes[0].decoratorNames, ['Get', 'Roles', 'ApiOperation']);
});

test('extractControllerRoutes: @Roles가 없으면(대장 #181 원형) decoratorNames에서도 빠진다', () => {
  const src = [
    "@Controller('stations')",
    'export class StationsController {',
    '  @Get()',
    "  @ApiOperation({ summary: '지사 목록' })",
    '  list(): void {}',
    '}',
  ].join('\n');
  const { controllers } = extractControllerRoutes(src);
  assert.deepEqual(controllers[0].routes[0].decoratorNames, ['Get', 'ApiOperation']);
});

test('extractControllerRoutes: 다중 라인 @ApiOperation({...}) 객체 리터럴을 건너뛰고 다음 멤버를 정확히 잡는다', () => {
  const src = [
    "@Controller('contents')",
    'export class ContentsController {',
    '  @Get()',
    "  @Roles('reporter', 'center_operator')",
    '  @ApiOperation({',
    "    summary: '목록',",
    "    description: '여러 줄 (괄호가 섞인) 설명',",
    '  })',
    '  list(): void {}',
    '}',
  ].join('\n');
  const { controllers } = extractControllerRoutes(src);
  assert.equal(controllers[0].routes.length, 1);
  assert.equal(controllers[0].routes[0].methodName, 'list');
  assert.ok(controllers[0].routes[0].decoratorNames.includes('Roles'));
});

test('extractControllerRoutes: 다중 라인 메서드 시그니처(파라미터 데코레이터 포함)를 새 멤버로 오인하지 않는다', () => {
  const src = [
    "@Controller('stations')",
    'export class StationsController {',
    "  @Post(':id/transitions')",
    "  @Roles('admin', 'center_operator')",
    "  @ApiOperation({ summary: 'x' })",
    '  async transition(',
    "    @Param('id') id: string,",
    '    @Body() body: TransitionStationDto,',
    '    @CurrentUser() user: User,',
    '  ): Promise<Station> {',
    '    return this.workflow.transition(id, body, user);',
    '  }',
    '}',
  ].join('\n');
  const { controllers } = extractControllerRoutes(src);
  // @Param·@Body·@CurrentUser가 새 클래스 멤버로 오인되면 routes.length가 4 이상이 된다
  assert.equal(controllers[0].routes.length, 1);
  assert.equal(controllers[0].routes[0].methodName, 'transition');
  assert.deepEqual(controllers[0].routes[0].decoratorNames, ['Post', 'Roles', 'ApiOperation']);
});

test('extractControllerRoutes: HTTP verb 데코레이터가 없는 멤버(private 헬퍼·생성자)는 라우트로 세지 않는다', () => {
  const src = [
    "@Controller('auth')",
    'export class AuthController {',
    '  constructor(private readonly auth: AuthService) {}',
    '',
    '  @Post(\'login\')',
    '  @Public()',
    '  login(): void {}',
    '',
    '  private helper(): void {',
    '    return;',
    '  }',
    '}',
  ].join('\n');
  const { controllers } = extractControllerRoutes(src);
  assert.equal(controllers[0].routes.length, 1);
  assert.equal(controllers[0].routes[0].methodName, 'login');
});

test('extractControllerRoutes: 같은 파일에 @Controller 아닌 클래스(가드 등)가 있어도 별도 클래스로 분리된다', () => {
  // auth.controller.ts의 실제 형태(WebCsrfGuard + AuthController) 축소판
  const src = [
    '@Injectable()',
    'export class WebCsrfGuard implements CanActivate {',
    '  canActivate(context: ExecutionContext): boolean {',
    '    return true;',
    '  }',
    '}',
    '',
    "@Controller('auth')",
    'export class AuthController {',
    "  @Post('logout')",
    '  @ApiBearerAuth()',
    '  async logout(): Promise<void> {}',
    '',
    "  @Get('me')",
    '  @ApiBearerAuth()',
    '  me(): void {}',
    '}',
  ].join('\n');
  const { controllers } = extractControllerRoutes(src);
  assert.equal(controllers.length, 2);
  assert.equal(controllers[0].className, 'WebCsrfGuard');
  assert.deepEqual(controllers[0].classDecorators, ['Injectable']);
  assert.equal(controllers[0].routes.length, 0); // canActivate는 HTTP verb 데코레이터가 없다
  assert.equal(controllers[1].className, 'AuthController');
  assert.equal(controllers[1].routes.length, 2);
  // @ApiBearerAuth는 게이트로 인정되지 않는다(Swagger 문서용일 뿐)
  assert.ok(!controllers[1].routes[0].decoratorNames.includes('Roles'));
  assert.ok(!controllers[1].routes[0].decoratorNames.includes('Public'));
});

test('extractControllerRoutes: 클래스 레벨 @Public()도 인식한다(향후 대비 — 현재 리포엔 없음)', () => {
  const src = [
    '@Public()',
    "@Controller('open')",
    'export class OpenController {',
    '  @Get()',
    '  list(): void {}',
    '}',
  ].join('\n');
  const { controllers } = extractControllerRoutes(src);
  assert.deepEqual(controllers[0].classDecorators, ['Public', 'Controller']);
});

test('extractControllerRoutes: 문자열이 파일 끝까지 닫히지 않으면 예외(추측 파싱 금지)', () => {
  const src = "@Controller('x')\nexport class X {\n  @Get()\n  list() { const s = 'unterminated;\n}\n";
  assert.throws(() => extractControllerRoutes(src), /파싱 실패/);
});

test('extractControllerRoutes: 괄호 깊이가 0으로 안 돌아오면 예외', () => {
  const src = "@Controller('x')\nexport class X {\n  @Get()\n  list() {\n";
  assert.throws(() => extractControllerRoutes(src), /파싱 실패/);
});

// ── isMeaningfulReason (규율 21) ─────────────────────────────────────────────

test('isMeaningfulReason: 빈칸·공백만은 무의미', () => {
  assert.equal(isMeaningfulReason(''), false);
  assert.equal(isMeaningfulReason('   '), false);
  assert.equal(isMeaningfulReason(undefined), false);
  assert.equal(isMeaningfulReason(null), false);
});

test('isMeaningfulReason: "-"·"n/a"·"TODO" 같은 자리표시자는 무의미(규율 21 핵심)', () => {
  assert.equal(isMeaningfulReason('-'), false);
  assert.equal(isMeaningfulReason('n/a'), false);
  assert.equal(isMeaningfulReason('N/A'), false);
  assert.equal(isMeaningfulReason('TODO'), false);
  assert.equal(isMeaningfulReason('.'), false);
});

test('isMeaningfulReason: 반복 문자로 길이만 채운 값도 무의미(저-엔트로피)', () => {
  assert.equal(isMeaningfulReason('----------'), false);
  assert.equal(isMeaningfulReason('aaaaaaaaaaaaaaaa'), false);
});

test('isMeaningfulReason: 실제 문장은 유의미', () => {
  assert.equal(
    isMeaningfulReason('로그아웃은 role과 무관하게 인증된 사용자 누구나 접근해야 한다'),
    true,
  );
});

test('허용 목록(ROLE_GATE_ALLOWLIST) 자신의 사유도 규율 21을 통과한다(자기 검증)', () => {
  for (const entry of ROLE_GATE_ALLOWLIST) {
    assert.equal(
      isMeaningfulReason(entry.reason),
      true,
      `${entry.file}#${entry.method}의 사유가 규율 21 기준 미달`,
    );
  }
});

// ── findAllowlistEntry / judgeRoute ──────────────────────────────────────────

test('findAllowlistEntry: file+method 정확 일치만 찾는다', () => {
  const list = [{ file: 'a/b.ts', method: 'foo', reason: '충분히 긴 의미있는 사유 문장입니다' }];
  assert.ok(findAllowlistEntry(list, 'a/b.ts', 'foo'));
  assert.equal(findAllowlistEntry(list, 'a/b.ts', 'bar'), undefined);
  assert.equal(findAllowlistEntry(list, 'a/other.ts', 'foo'), undefined);
});

test('judgeRoute: @Roles 있으면 허용목록 없이도 통과', () => {
  const route = { methodName: 'list', decoratorNames: ['Get', 'Roles'], line: 1 };
  const res = judgeRoute(route, [], [], 'x.ts');
  assert.equal(res.ok, true);
  assert.equal(res.viaAllowlist, false);
});

test('judgeRoute: @Public 있으면 통과', () => {
  const route = { methodName: 'list', decoratorNames: ['Get', 'Public'], line: 1 };
  const res = judgeRoute(route, [], [], 'x.ts');
  assert.equal(res.ok, true);
});

test('judgeRoute: 게이트 없고 허용목록도 없으면 위반', () => {
  const route = { methodName: 'list', decoratorNames: ['Get'], line: 1 };
  const res = judgeRoute(route, [], [], 'x.ts');
  assert.equal(res.ok, false);
  assert.match(res.reason, /둘 다 없음/);
});

test('judgeRoute: 게이트 없지만 허용목록에 의미있는 사유로 등재되면 통과(viaAllowlist=true)', () => {
  const route = { methodName: 'logout', decoratorNames: ['Post'], line: 1 };
  const list = [{ file: 'x.ts', method: 'logout', reason: '역할 무관 정당 사유 — 충분히 길다' }];
  const res = judgeRoute(route, [], list, 'x.ts');
  assert.equal(res.ok, true);
  assert.equal(res.viaAllowlist, true);
});

test('judgeRoute: 허용목록에 있어도 사유가 무의미(규율 21)하면 위반으로 취급 — "있는 척" 방지', () => {
  const route = { methodName: 'logout', decoratorNames: ['Post'], line: 1 };
  const list = [{ file: 'x.ts', method: 'logout', reason: '-' }];
  const res = judgeRoute(route, [], list, 'x.ts');
  assert.equal(res.ok, false);
  assert.match(res.reason, /규율 21/);
});

// ── checkControllerFile ──────────────────────────────────────────────────────

test('checkControllerFile: @Controller 클래스가 없으면 예외(*.controller.ts 명명 규약 위반 감지)', () => {
  const src = '@Injectable()\nexport class NotAController {\n  @Get()\n  list(): void {}\n}\n';
  assert.throws(
    () => checkControllerFile({ relFile: 'x.controller.ts', content: src }),
    /@Controller가 붙은 클래스를 찾지 못함/,
  );
});

// ── ⭐ #181 사례 재현 — 이 도구의 존재 이유 ─────────────────────────────────────
// 실제로 있었던 일: stations.controller.ts의 GET /stations, GET /stations/:id에 @Roles가
// 빠져 있었다(같은 컨트롤러의 @Post()에는 @Roles('admin')이 있어 누락이 분명했다). 그 원형을
// 그대로 픽스처로 재구성하고 checkControllerFile이 잡아내는지 확인한다.

test('#181 재현: stations.controller.ts에서 @Roles를 지운 원형은 checkControllerFile이 잡는다', () => {
  const brokenSrc = [
    "@ApiTags('stations')",
    "@Controller('stations')",
    'export class StationsController {',
    '  @Get()',
    "  @ApiOperation({ summary: '지사 목록 (관리 화면용)' })",
    '  list(): void {}',
    '',
    "  @Get(':id')",
    "  @ApiOperation({ summary: '지사 단건 조회' })",
    '  get(): void {}',
    '',
    '  @Post()',
    "  @Roles('admin')",
    "  @ApiOperation({ summary: '지사 생성' })",
    '  create(): void {}',
    '}',
  ].join('\n');

  const result = checkControllerFile({
    relFile: 'services/api/src/stations/stations.controller.ts',
    content: brokenSrc,
  });

  assert.equal(result.ok, false, '#181과 동형인 누락 상태인데 ok=true로 판정하면 이 도구는 무의미하다');
  assert.equal(result.violations.length, 2);
  assert.deepEqual(
    result.violations.map((v) => v.methodName).sort(),
    ['get', 'list'],
  );
});

test('#181 재현 — 수리 후(실제 해소 형태): @Roles가 각 라우트에 붙으면 통과한다', () => {
  const fixedSrc = [
    "@Controller('stations')",
    'export class StationsController {',
    '  @Get()',
    "  @Roles('center_operator')",
    "  @ApiOperation({ summary: '지사 목록' })",
    '  list(): void {}',
    '',
    "  @Get(':id')",
    "  @Roles('reporter', 'center_operator')",
    "  @ApiOperation({ summary: '지사 단건 조회' })",
    '  get(): void {}',
    '}',
  ].join('\n');

  const result = checkControllerFile({
    relFile: 'services/api/src/stations/stations.controller.ts',
    content: fixedSrc,
  });
  assert.equal(result.ok, true);
  assert.equal(result.violations.length, 0);
});

// ── findControllerFiles + checkAllControllers — fs 픽스처 통합 ──────────────────

function withFixtureRepo(build, run) {
  const dir = mkdtempSync(join(tmpdir(), 'controller-role-gate-'));
  try {
    build(dir);
    return run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function writeController(repoRoot, relDir, fileName, content) {
  const fullDir = join(repoRoot, relDir);
  mkdirSync(fullDir, { recursive: true });
  writeFileSync(join(fullDir, fileName), content, 'utf8');
}

test('findControllerFiles: services/api/src 아래 *.controller.ts만 재귀 수집, .spec.ts는 제외', () => {
  withFixtureRepo(
    (root) => {
      writeController(root, 'services/api/src/a', 'a.controller.ts', "@Controller('a')\nexport class AController {}\n");
      writeController(root, 'services/api/src/a', 'a.controller.spec.ts', '// 스펙 파일 — 대상 아님\n');
      writeController(root, 'services/api/src/b/nested', 'b.controller.ts', "@Controller('b')\nexport class BController {}\n");
      writeController(root, 'services/api/src/b', 'b.service.ts', '// 컨트롤러 아님\n');
    },
    (root) => {
      const files = findControllerFiles(root);
      assert.equal(files.length, 2);
      assert.ok(files.every((f) => f.endsWith('.controller.ts')));
    },
  );
});

test('checkAllControllers: services/api/src가 없으면 빈 배열(0건) → fail-closed', () => {
  withFixtureRepo(
    (root) => {
      mkdirSync(root, { recursive: true });
    },
    (root) => {
      const outcome = checkAllControllers(root, []);
      assert.equal(outcome.ok, false);
      assert.match(outcome.reason, /컨트롤러 파일을 하나도 찾지 못했다/);
    },
  );
});

test('checkAllControllers: #181 재현 — 전체 스캔 경로로도 위반을 잡는다', () => {
  withFixtureRepo(
    (root) => {
      writeController(
        root,
        'services/api/src/stations',
        'stations.controller.ts',
        [
          "@Controller('stations')",
          'export class StationsController {',
          '  @Get()',
          "  @ApiOperation({ summary: 'x' })",
          '  list(): void {}',
          '}',
        ].join('\n'),
      );
    },
    (root) => {
      const outcome = checkAllControllers(root, []);
      assert.equal(outcome.ok, false);
      assert.equal(outcome.results[0].violations[0].methodName, 'list');
    },
  );
});

test('checkAllControllers: 허용목록을 커스텀으로 주입하면 그 목록 기준으로 판정한다', () => {
  withFixtureRepo(
    (root) => {
      writeController(
        root,
        'services/api/src/x',
        'x.controller.ts',
        [
          "@Controller('x')",
          'export class XController {',
          "  @Post('logout')",
          '  logout(): void {}',
          '}',
        ].join('\n'),
      );
    },
    (root) => {
      const withoutAllowlist = checkAllControllers(root, []);
      assert.equal(withoutAllowlist.ok, false);

      const withAllowlist = checkAllControllers(root, [
        {
          file: 'services/api/src/x/x.controller.ts',
          method: 'logout',
          reason: '테스트 전용 커스텀 허용 사유 — 충분히 길다',
        },
      ]);
      assert.equal(withAllowlist.ok, true);
    },
  );
});

// ── findUnusedAllowlistEntries (허용목록 부패 방지) ──────────────────────────────
// 검증자 실측: ROLE_GATE_ALLOWLIST에 존재하지 않는 라우트를 등재해도 조용히 무시되고
// ok=true가 됐다(findAllowlistEntry가 "라우트 → 허용목록" 방향만 보고, "허용목록 → 라우트"
// 역방향은 아무도 안 봤기 때문). 이 절은 그 역방향 검사를 고정한다.

test('findUnusedAllowlistEntries: 매칭되는 라우트 키가 있으면 사용됨(빈 배열)', () => {
  const list = [{ file: 'a/b.ts', method: 'foo', reason: '충분히 긴 의미있는 사유 문장입니다' }];
  const unused = findUnusedAllowlistEntries(list, new Set(['a/b.ts#foo']));
  assert.deepEqual(unused, []);
});

test('findUnusedAllowlistEntries: 매칭되는 라우트 키가 없으면 죽은 엔트리로 잡는다', () => {
  const list = [{ file: 'a/b.ts', method: 'foo', reason: '충분히 긴 의미있는 사유 문장입니다' }];
  const unused = findUnusedAllowlistEntries(list, new Set(['a/b.ts#bar']));
  assert.equal(unused.length, 1);
  assert.equal(unused[0].method, 'foo');
});

test('findUnusedAllowlistEntries: 배열(Set 아님)도 받는다', () => {
  const list = [{ file: 'a/b.ts', method: 'foo', reason: '충분히 긴 의미있는 사유 문장입니다' }];
  assert.deepEqual(findUnusedAllowlistEntries(list, ['a/b.ts#foo']), []);
  assert.equal(findUnusedAllowlistEntries(list, []).length, 1);
});

// ⓐ 존재하지 않는 파일을 가리키는 엔트리 — checkAllControllers 통합 경로
test('checkAllControllers: 허용목록 부패 ⓐ — 존재하지 않는 파일을 가리키는 엔트리는 fail-closed', () => {
  withFixtureRepo(
    (root) => {
      writeController(
        root,
        'services/api/src/x',
        'x.controller.ts',
        [
          "@Controller('x')",
          'export class XController {',
          "  @Get()",
          "  @Roles('admin')",
          '  list(): void {}',
          '}',
        ].join('\n'),
      );
    },
    (root) => {
      const outcome = checkAllControllers(root, [
        {
          // 실제로는 존재하지 않는 파일(리네임·삭제 시나리오) — 조용히 무시되면 안 된다
          file: 'services/api/src/x/deleted-controller.controller.ts',
          method: 'removedMethod',
          reason: '이 라우트는 이미 삭제됐지만 허용목록에는 남아있는 죽은 엔트리입니다',
        },
      ]);
      assert.equal(outcome.ok, false, '죽은 엔트리가 조용히 통과하면 허용목록 부패가 재발한다');
      assert.equal(outcome.unusedAllowlistEntries.length, 1);
      assert.equal(outcome.unusedAllowlistEntries[0].method, 'removedMethod');
    },
  );
});

// ⓑ 파일은 맞는데 메서드명이 틀린 엔트리
test('checkAllControllers: 허용목록 부패 ⓑ — 파일은 맞지만 메서드명이 틀린 엔트리는 fail-closed', () => {
  withFixtureRepo(
    (root) => {
      writeController(
        root,
        'services/api/src/x',
        'x.controller.ts',
        [
          "@Controller('x')",
          'export class XController {',
          "  @Post('logout')",
          "  @Public()",
          '  logout(): void {}',
          '}',
        ].join('\n'),
      );
    },
    (root) => {
      const outcome = checkAllControllers(root, [
        {
          file: 'services/api/src/x/x.controller.ts',
          // 실제 메서드명은 logout — oldLogout은 리네임 이전 이름이 방치된 시나리오
          method: 'oldLogout',
          reason: '메서드가 리네임되기 전 이름으로 등재된 채 방치된 허용목록 엔트리입니다',
        },
      ]);
      assert.equal(outcome.ok, false);
      assert.equal(outcome.unusedAllowlistEntries.length, 1);
      assert.equal(outcome.unusedAllowlistEntries[0].method, 'oldLogout');
      // logout 라우트 자신은 @Public이 붙어 있어 정상 통과 — 위반은 오직 죽은 허용목록 엔트리 때문
      assert.equal(outcome.results[0].ok, true);
    },
  );
});

// ⓒ 정상 상태(현재 리포)는 여전히 PASS — CLI 통합 테스트(아래)가 이미 exit 0을 확인하지만,
// checkAllControllers 레벨에서도 unusedAllowlistEntries가 빈 배열임을 직접 고정한다.
test('checkAllControllers: 허용목록 부패 ⓒ — 현재 리포 ROLE_GATE_ALLOWLIST는 죽은 엔트리 0건(정상 상태 회귀 방지)', () => {
  const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
  const outcome = checkAllControllers(repoRoot, ROLE_GATE_ALLOWLIST);
  assert.deepEqual(outcome.unusedAllowlistEntries, []);
  assert.equal(outcome.ok, true);
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

test('CLI: 현재 리포 상태는 exit 0(전 컨트롤러·전 라우트 게이트 보유 + 허용목록 2건)', () => {
  const { code, stdout } = runCli();
  assert.equal(code, 0);
  assert.match(stdout, /판정: PASS/);
  assert.match(stdout, /stations\/stations\.controller\.ts: 라우트 5건 전부 권한 게이트 보유/);
  assert.match(stdout, /auth\/auth\.controller\.ts: 라우트 7건 전부 권한 게이트 보유 \(허용목록 2건 포함\)/);
});

test('CLI: --repo-root로 #181 픽스처(stations 게이트 제거)를 가리키면 exit 1', () => {
  withFixtureRepo(
    (root) => {
      writeController(
        root,
        'services/api/src/stations',
        'stations.controller.ts',
        [
          "@Controller('stations')",
          'export class StationsController {',
          '  @Get()',
          "  @ApiOperation({ summary: 'x' })",
          '  list(): void {}',
          '',
          "  @Get(':id')",
          "  @ApiOperation({ summary: 'y' })",
          '  get(): void {}',
          '}',
        ].join('\n'),
      );
    },
    (root) => {
      const { code, stderr } = runCli(['--repo-root', root]);
      assert.equal(code, 1);
      assert.match(stderr, /stations\.controller\.ts: 위반 2건/);
      assert.match(stderr, /StationsController\.list/);
      assert.match(stderr, /StationsController\.get/);
    },
  );
});

test('CLI: --repo-root가 컨트롤러 0건인 경로를 가리키면 exit 1', () => {
  withFixtureRepo(
    (root) => {
      mkdirSync(join(root, 'services', 'api', 'src'), { recursive: true });
    },
    (root) => {
      const { code, stderr } = runCli(['--repo-root', root]);
      assert.equal(code, 1);
      assert.match(stderr, /판정: FAIL/);
    },
  );
});

test('CLI: 파싱 불가능한 컨트롤러(문자열 미종결)는 exit 1(검사 실행 실패로 명시)', () => {
  withFixtureRepo(
    (root) => {
      writeController(
        root,
        'services/api/src/broken',
        'broken.controller.ts',
        "@Controller('broken')\nexport class BrokenController {\n  @Get()\n  list() { const s = 'unterminated;\n}\n",
      );
    },
    (root) => {
      const { code, stderr } = runCli(['--repo-root', root]);
      assert.equal(code, 1);
      assert.match(stderr, /검사 실행 실패/);
    },
  );
});

// 참고: 실제 stations.controller.ts에서 @Roles를 지워 exit 1을 확인하는 절차(뮤테이션)는 이
// 테스트 파일이 아니라 게이트①(완료 보고)에서 수동으로 실행하고 원상복구한다 — 이 파일은
// mkdtemp 임시 픽스처만 사용해 실제 리포에 부수효과를 남기지 않는다.
