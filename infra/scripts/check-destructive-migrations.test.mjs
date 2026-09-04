// infra/scripts/check-destructive-migrations.test.mjs
// 파괴적 마이그레이션 사전 확인 게이트(대장 #180 잔여 ②) 단위 테스트.
//
// ⭐ 핵심은 "DROP COLUMN이 든 마이그레이션이 승인 마커 없이 머지되면 이 검사가 잡는가"다 —
// 아래 "실제 마이그레이션 재현" 블록이 그 증거다: 리포에 실재하는
// `20260827203549_drop_minor_consent_confirmation/migration.sql`을 그대로 픽스처로 재사용한다.
//
// ⚠️ 루트 `package.json`의 `test:scripts`에 이 파일을 등재해야 한다 — 잊으면
// `daejang-recheck.test.mjs`의 self-check(test:scripts 등재 검사)가 레드로 잡는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DESTRUCTIVE_PATTERNS,
  MARKER_FILENAME,
  REQUIRED_MARKER_SECTIONS,
  findDestructiveMatches,
  extractMarkerSection,
  isMeaningfulSectionBody,
  parseApprovalMarker,
  checkMigrationDir,
  checkAllMigrations,
} from './check-destructive-migrations.mjs';

const SCRIPT_PATH = fileURLToPath(new URL('./check-destructive-migrations.mjs', import.meta.url));
const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

// ── findDestructiveMatches ───────────────────────────────────────────────────

test('findDestructiveMatches: DROP COLUMN을 잡는다', () => {
  const sql = 'ALTER TABLE "contents" DROP COLUMN "foo";';
  const matches = findDestructiveMatches(sql);
  assert.ok(matches.some((m) => m.id === 'drop-column'));
});

test('findDestructiveMatches: DROP TABLE을 잡는다', () => {
  const matches = findDestructiveMatches('DROP TABLE "widgets";');
  assert.ok(matches.some((m) => m.id === 'drop-table'));
});

test('findDestructiveMatches: TRUNCATE을 잡는다', () => {
  const matches = findDestructiveMatches('TRUNCATE TABLE "widgets";');
  assert.ok(matches.some((m) => m.id === 'truncate'));
});

test('findDestructiveMatches: DROP CONSTRAINT를 잡는다', () => {
  const matches = findDestructiveMatches('ALTER TABLE "x" DROP CONSTRAINT "x_fkey";');
  assert.ok(matches.some((m) => m.id === 'drop-constraint'));
});

test('findDestructiveMatches: SET NOT NULL을 잡는다', () => {
  const matches = findDestructiveMatches('ALTER TABLE "x" ALTER COLUMN "y" SET NOT NULL;');
  assert.ok(matches.some((m) => m.id === 'set-not-null'));
});

test('findDestructiveMatches: DROP DATABASE/DROP SCHEMA/DROP INDEX을 잡는다', () => {
  assert.ok(findDestructiveMatches('DROP DATABASE "x";').some((m) => m.id === 'drop-database'));
  assert.ok(findDestructiveMatches('DROP SCHEMA "x";').some((m) => m.id === 'drop-schema'));
  assert.ok(findDestructiveMatches('DROP INDEX "x_idx";').some((m) => m.id === 'drop-index'));
});

test('findDestructiveMatches: Prisma 자동 경고 주석도 신호로 잡는다(주석 전용)', () => {
  const sql = '/*\n  - You are about to drop the column `x` on the `y` table.\n*/\n';
  assert.ok(findDestructiveMatches(sql).some((m) => m.id === 'prisma-warning-comment'));
});

test('findDestructiveMatches: 손으로 쓴 SQL — 주석이 없어도 실제 구문으로 잡힌다', () => {
  const handWritten = 'ALTER TABLE "residents" DROP COLUMN "ssn_hash";'; // 주석 0줄
  const matches = findDestructiveMatches(handWritten);
  assert.ok(matches.some((m) => m.id === 'drop-column'));
});

test('findDestructiveMatches: 파괴적 구문이 없으면 빈 배열', () => {
  const sql = 'CREATE TABLE "widgets" (\n  "id" TEXT NOT NULL,\n  PRIMARY KEY ("id")\n);';
  assert.deepEqual(findDestructiveMatches(sql), []);
});

test('findDestructiveMatches: 라인 번호를 정확히 보고한다', () => {
  const sql = 'CREATE TABLE "x" ("id" TEXT);\nDROP TABLE "y";\n';
  const matches = findDestructiveMatches(sql);
  const dropTable = matches.find((m) => m.id === 'drop-table');
  assert.equal(dropTable.line, 2);
});

test('DESTRUCTIVE_PATTERNS: 요구된 최소 5구문(DROP COLUMN·DROP TABLE·TRUNCATE·DROP CONSTRAINT·SET NOT NULL)을 포함한다', () => {
  const ids = DESTRUCTIVE_PATTERNS.map((p) => p.id);
  for (const required of ['drop-column', 'drop-table', 'truncate', 'drop-constraint', 'set-not-null']) {
    assert.ok(ids.includes(required), `누락: ${required}`);
  }
});

test('findDestructiveMatches: 대소문자 무관 + 다중 공백(단일 줄)을 잡는다(회귀 고정)', () => {
  const sql = 'alter table "x" drop   column "y";\nDrop   Table "z";';
  const matches = findDestructiveMatches(sql);
  assert.ok(matches.some((m) => m.id === 'drop-column' && m.line === 1));
  assert.ok(matches.some((m) => m.id === 'drop-table' && m.line === 2));
});

// ── ⭐ 결함② 회귀 고정 — 키워드가 개행으로 쪼개지면 줄 단위 스캔은 놓친다 ──────────
// 검증자 반증 원문 재현: `ALTER TABLE foo\nDROP\n  COLUMN bar;` → 종전 구현은 매치 0건.

test('findDestructiveMatches: DROP\\nCOLUMN — 2줄로 쪼개진 키워드를 잡는다', () => {
  const sql = 'ALTER TABLE foo\nDROP\n  COLUMN bar;';
  const matches = findDestructiveMatches(sql);
  const hit = matches.find((m) => m.id === 'drop-column');
  assert.ok(hit, '개행으로 쪼개진 DROP COLUMN을 놓쳤다');
  assert.equal(hit.line, 2, 'DROP 키워드가 시작하는 줄(2)을 보고해야 한다');
});

test('findDestructiveMatches: DROP\\nTABLE — 2줄로 쪼개진 키워드를 잡는다', () => {
  const matches = findDestructiveMatches('DROP\nTABLE "widgets";');
  const hit = matches.find((m) => m.id === 'drop-table');
  assert.ok(hit, '개행으로 쪼개진 DROP TABLE을 놓쳤다');
  assert.equal(hit.line, 1);
});

test('findDestructiveMatches: SET\\nNOT\\nNULL — 3줄로 쪼개진 키워드를 잡는다', () => {
  const sql = 'ALTER TABLE "x" ALTER COLUMN "y"\nSET\nNOT\nNULL;';
  const matches = findDestructiveMatches(sql);
  const hit = matches.find((m) => m.id === 'set-not-null');
  assert.ok(hit, '개행으로 쪼개진 SET NOT NULL을 놓쳤다');
  assert.equal(hit.line, 2, 'SET 키워드가 시작하는 줄(2)을 보고해야 한다');
});

test('findDestructiveMatches: 개행 분리 매치도 단일 줄 매치와 같은 줄 번호 보고 정확도를 유지한다', () => {
  // 단일 줄 매치(회귀 없음 확인용 대조군) + 개행 분리 매치가 섞인 파일
  const sql = 'DROP TABLE "single_line";\n\nALTER TABLE foo\nDROP\n  COLUMN bar;';
  const matches = findDestructiveMatches(sql);
  const singleLine = matches.find((m) => m.id === 'drop-table');
  const split = matches.find((m) => m.id === 'drop-column');
  assert.equal(singleLine.line, 1);
  assert.equal(split.line, 4);
});

// ── extractMarkerSection / parseApprovalMarker ───────────────────────────────

test('extractMarkerSection: 섹션 본문을 정확히 뽑는다', () => {
  const md = '# 제목\n\n## 손실 실측\n11행 중 0건 영향.\n\n## 복원점\nbackup.sql.gz\n';
  assert.equal(extractMarkerSection(md, '손실 실측'), '11행 중 0건 영향.');
  assert.equal(extractMarkerSection(md, '복원점'), 'backup.sql.gz');
});

test('extractMarkerSection: 섹션 자체가 없으면 null', () => {
  const md = '# 제목\n\n## 손실 실측\n내용\n';
  assert.equal(extractMarkerSection(md, '복원점'), null);
});

test('extractMarkerSection: 섹션이 있는데 본문이 공백뿐이면 빈 문자열(trim)', () => {
  const md = '## 복원점\n   \n\n## 비고\nx\n';
  assert.equal(extractMarkerSection(md, '복원점'), '');
});

test('parseApprovalMarker: 두 섹션 모두 채워지면 valid=true', () => {
  const md = '## 손실 실측\n11행 중 0건 영향 확인\n\n## 복원점\nbackup-20260101-000000.sql.gz\n';
  const result = parseApprovalMarker(md);
  assert.equal(result.valid, true);
  assert.deepEqual(result.missing, []);
});

test('parseApprovalMarker: markdown이 null(마커 파일 부재)이면 전부 누락', () => {
  const result = parseApprovalMarker(null);
  assert.equal(result.valid, false);
  assert.deepEqual(result.missing.sort(), [...REQUIRED_MARKER_SECTIONS].sort());
});

test('parseApprovalMarker: ⭐ 규율 21 — 섹션은 있는데 본문이 빈칸이면 "마커 없음"과 동일 취급', () => {
  const md = '## 손실 실측\n\n## 복원점\nbackup-20260101-000000.sql.gz\n';
  const result = parseApprovalMarker(md);
  assert.equal(result.valid, false, '빈 칸인데 valid=true면 "있는 척" 마커를 통과시키는 것이다');
  assert.deepEqual(result.missing, ['손실 실측']);
});

test('parseApprovalMarker: 한 섹션만 누락돼도 invalid', () => {
  const md = '## 손실 실측\n11행 중 0건 영향 확인\n';
  const result = parseApprovalMarker(md);
  assert.equal(result.valid, false);
  assert.deepEqual(result.missing, ['복원점']);
});

// ── ⭐ 결함① 회귀 고정 — 검증자가 뚫은 3경로 + 추가 우회 시도 ───────────────────────
// 단순 금칙어 목록이 아니라 "도메인 신호"(손실 실측=수치+단위, 복원점=백업 식별자)를 요구하므로,
// 아래는 전부 무의미로 판정돼야 한다(형태만 그럴듯한 자리표시자).

test('isMeaningfulSectionBody: 검증자가 뚫었던 "-"·"n/a"·"TODO"는 전부 무의미', () => {
  for (const placeholder of ['-', 'n/a', 'N/A', 'TODO', 'todo']) {
    assert.equal(
      isMeaningfulSectionBody('손실 실측', placeholder),
      false,
      `"${placeholder}"가 통과하면 검증자 반증이 재발한 것`,
    );
    assert.equal(isMeaningfulSectionBody('복원점', placeholder), false, `"${placeholder}"가 통과하면 검증자 반증이 재발한 것`);
  }
});

test('isMeaningfulSectionBody: 반복 문자로 늘린 자리표시자(길이만 늘림)는 무의미', () => {
  for (const placeholder of ['--------', 'TODOTODOTODO', 'n/an/an/a', '00000000', '........']) {
    assert.equal(
      isMeaningfulSectionBody('손실 실측', placeholder),
      false,
      `"${placeholder}"가 통과하면 반복 문자 우회가 뚫린 것`,
    );
  }
});

test('isMeaningfulSectionBody: 손실 실측 — 숫자만으로는 부족하다(수치+단위 필요)', () => {
  // "asdf1234"는 길고 숫자도 있지만 실측 단위(건/행/개 등)가 없다 — 실제 절차의 산출물이 아니다.
  assert.equal(isMeaningfulSectionBody('손실 실측', 'asdf1234'), false);
  assert.equal(isMeaningfulSectionBody('손실 실측', '11행 중 0건 영향 확인'), true);
});

test('isMeaningfulSectionBody: 복원점 — 확장자만으로는 부족하다(타임스탬프 숫자 필요)', () => {
  // "backup.sql.gz"는 확장자는 있지만 숫자가 없다 — 누구나 타이핑 가능한 값이다.
  assert.equal(isMeaningfulSectionBody('복원점', 'backup.sql.gz'), false);
  assert.equal(isMeaningfulSectionBody('복원점', 'gachinol-20260902-040924.sql.gz'), true);
});

test('isMeaningfulSectionBody: 실제 소급 마커 형태(11행 중 0건 / 타임스탬프.sql.gz)는 유효', () => {
  assert.equal(
    isMeaningfulSectionBody(
      '손실 실측',
      '`contents` 테이블 11행 중 두 컬럼이 NOT NULL 제약을 가진 행 **0건**임을 확인했다.',
    ),
    true,
  );
  assert.equal(isMeaningfulSectionBody('복원점', '`gachinol-20260902-040924.sql.gz` (제온 백업)'), true);
});

// ── checkMigrationDir ─────────────────────────────────────────────────────────

test('checkMigrationDir: 파괴적 구문이 없으면 마커 없이도 ok=true', () => {
  const result = checkMigrationDir({
    name: '20260101000000_init',
    sqlContent: 'CREATE TABLE "x" ("id" TEXT NOT NULL);',
    markerContent: null,
  });
  assert.equal(result.ok, true);
});

test('checkMigrationDir: 파괴적 구문이 있고 마커가 없으면 ok=false', () => {
  const result = checkMigrationDir({
    name: '20260101000001_drop_x',
    sqlContent: 'ALTER TABLE "x" DROP COLUMN "y";',
    markerContent: null,
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /마커 파일 없음/);
});

test('checkMigrationDir: 파괴적 구문이 있고 마커가 유효하면 ok=true', () => {
  const marker = '## 손실 실측\n대상 3행 중 영향 0건 확인\n\n## 복원점\nbackup-20260101.sql.gz\n';
  const result = checkMigrationDir({
    name: '20260101000001_drop_x',
    sqlContent: 'ALTER TABLE "x" DROP COLUMN "y";',
    markerContent: marker,
  });
  assert.equal(result.ok, true);
});

test('checkMigrationDir: 파괴적 구문이 있고 마커는 있지만 필수 칸이 비어 ok=false', () => {
  const marker = '## 손실 실측\n\n## 복원점\nbackup.sql.gz\n';
  const result = checkMigrationDir({
    name: '20260101000001_drop_x',
    sqlContent: 'ALTER TABLE "x" DROP COLUMN "y";',
    markerContent: marker,
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /필수 칸 미기재/);
});

// ── checkAllMigrations — fs 픽스처 통합 ────────────────────────────────────────

function withFixtureRepo(build, run) {
  const dir = mkdtempSync(join(tmpdir(), 'check-destructive-migrations-'));
  try {
    build(dir);
    return run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function writeMigration(repoRoot, name, sql, marker) {
  const dir = join(repoRoot, 'services/api/prisma/migrations', name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'migration.sql'), sql, 'utf8');
  if (marker != null) {
    writeFileSync(join(dir, MARKER_FILENAME), marker, 'utf8');
  }
}

test('checkAllMigrations: 마이그레이션 디렉터리 자체가 없으면 fail-closed', () => {
  withFixtureRepo(
    () => {},
    (root) => {
      const outcome = checkAllMigrations(root);
      assert.equal(outcome.ok, false);
      assert.match(outcome.reason, /찾지 못함/);
    },
  );
});

test('checkAllMigrations: 마이그레이션 디렉터리는 있는데 하위 디렉터리가 0건이면 fail-closed', () => {
  withFixtureRepo(
    (root) => mkdirSync(join(root, 'services/api/prisma/migrations'), { recursive: true }),
    (root) => {
      const outcome = checkAllMigrations(root);
      assert.equal(outcome.ok, false);
      assert.match(outcome.reason, /0건/);
    },
  );
});

test('checkAllMigrations: 파괴적 구문 없는 마이그레이션만 있으면 ok=true', () => {
  withFixtureRepo(
    (root) => {
      writeMigration(root, '20260101000000_init', 'CREATE TABLE "x" ("id" TEXT NOT NULL);', null);
    },
    (root) => {
      const outcome = checkAllMigrations(root);
      assert.equal(outcome.ok, true);
    },
  );
});

test('⭐ checkAllMigrations: 승인 마커 없는 파괴적 마이그레이션 1건이면 전체 ok=false(뮤테이션 실증 동형)', () => {
  withFixtureRepo(
    (root) => {
      writeMigration(root, '20260101000000_init', 'CREATE TABLE "x" ("id" TEXT NOT NULL);', null);
      writeMigration(
        root,
        '20260102000000_drop_secret',
        'ALTER TABLE "x" DROP COLUMN "secret";',
        null, // 마커 없음 — 이게 이 게이트의 존재 이유다
      );
    },
    (root) => {
      const outcome = checkAllMigrations(root);
      assert.equal(outcome.ok, false, '미승인 파괴적 마이그레이션인데 ok=true면 이 게이트는 무의미하다');
      const bad = outcome.results.find((r) => r.name === '20260102000000_drop_secret');
      assert.equal(bad.ok, false);
    },
  );
});

test('checkAllMigrations: 승인 마커가 유효하면 ok=true', () => {
  withFixtureRepo(
    (root) => {
      writeMigration(
        root,
        '20260102000000_drop_secret',
        'ALTER TABLE "x" DROP COLUMN "secret";',
        '## 손실 실측\n3행 중 0건 영향 확인\n\n## 복원점\nbackup-20260101-000000.sql.gz\n',
      );
    },
    (root) => {
      const outcome = checkAllMigrations(root);
      assert.equal(outcome.ok, true);
    },
  );
});

// ── ⭐ 결함① CLI 통합 회귀 — 검증자가 뚫은 3경로가 fail-closed로 막히는지 ─────────────

test('checkAllMigrations: ⭐ 검증자 반증 재현 — "-"/"n/a" 마커는 무효(fail-closed)', () => {
  withFixtureRepo(
    (root) => {
      writeMigration(
        root,
        '20260102000000_drop_secret',
        'ALTER TABLE "x" DROP COLUMN "secret";',
        '## 손실 실측\n-\n## 복원점\nn/a\n',
      );
    },
    (root) => {
      const outcome = checkAllMigrations(root);
      assert.equal(outcome.ok, false, '"-"/"n/a" 마커가 통과하면 검증자 반증이 재발한 것');
    },
  );
});

test('checkAllMigrations: ⭐ 검증자 반증 재현 — "TODO"/"TODO" 마커는 무효(fail-closed)', () => {
  withFixtureRepo(
    (root) => {
      writeMigration(
        root,
        '20260102000000_drop_secret',
        'ALTER TABLE "x" DROP COLUMN "secret";',
        '## 손실 실측\nTODO\n## 복원점\nTODO\n',
      );
    },
    (root) => {
      const outcome = checkAllMigrations(root);
      assert.equal(outcome.ok, false, '"TODO" 마커가 통과하면 검증자 반증이 재발한 것');
    },
  );
});

test('checkAllMigrations: migration.sql이 없는 디렉터리는 fail-closed', () => {
  withFixtureRepo(
    (root) => {
      mkdirSync(join(root, 'services/api/prisma/migrations/20260101000000_empty'), { recursive: true });
    },
    (root) => {
      const outcome = checkAllMigrations(root);
      assert.equal(outcome.ok, false);
      const bad = outcome.results.find((r) => r.name === '20260101000000_empty');
      assert.match(bad.reason, /migration\.sql 없음/);
    },
  );
});

// ── 실제 리포 마이그레이션 재현 — 이 도구의 존재 이유 ────────────────────────────
// `20260827203549_drop_minor_consent_confirmation`은 리포에 실재하는 이미 적용 완료된 마이그레이션.
// 그 실제 SQL을 그대로 읽어 검사하고, 이 태스크가 소급 생성한 마커로 통과하는지 확인한다.

test('실제 마이그레이션 재현: drop_minor_consent_confirmation의 SQL은 파괴적 구문 3건 이상을 포함한다', () => {
  const sqlPath = join(
    REPO_ROOT,
    'services/api/prisma/migrations/20260827203549_drop_minor_consent_confirmation/migration.sql',
  );
  const sql = readFileSync(sqlPath, 'utf8');
  const matches = findDestructiveMatches(sql);
  const ids = matches.map((m) => m.id);
  assert.ok(ids.includes('drop-column'));
  assert.ok(ids.includes('drop-constraint'));
  assert.ok(matches.length >= 3, `실측 매치 ${matches.length}건 — 최소 3건(컬럼 2 + constraint 1) 기대`);
});

// ── CLI(fail-closed) 통합 ────────────────────────────────────────────────────────

function runCli(extraArgs = []) {
  try {
    const stdout = execFileSync('node', [SCRIPT_PATH, ...extraArgs], { encoding: 'utf8' });
    return { code: 0, stdout };
  } catch (err) {
    return { code: err.status ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

test('CLI: 현재 리포 상태는 exit 0(소급 마커가 유효해야 한다)', () => {
  const { code, stdout } = runCli();
  assert.equal(code, 0, `현재 리포가 FAIL이면 소급 마커가 무효하거나 없는 것 — stdout:\n${stdout}`);
  assert.match(stdout, /판정: PASS/);
  assert.match(stdout, /drop_minor_consent_confirmation/);
});

test('CLI: --repo-root로 미승인 파괴적 마이그레이션 픽스처를 가리키면 exit 1', () => {
  withFixtureRepo(
    (root) => {
      writeMigration(root, '20260101000000_drop_x', 'ALTER TABLE "x" DROP COLUMN "y";', null);
    },
    (root) => {
      const { code, stderr } = runCli(['--repo-root', root]);
      assert.equal(code, 1);
      assert.match(stderr, /마커 파일 없음/);
    },
  );
});

test('CLI: --repo-root가 마이그레이션 디렉터리 자체가 없는 곳을 가리키면 exit 1', () => {
  withFixtureRepo(
    () => {},
    (root) => {
      const { code, stderr } = runCli(['--repo-root', root]);
      assert.equal(code, 1);
      assert.match(stderr, /찾지 못함/);
    },
  );
});
