#!/usr/bin/env node
/**
 * infra/scripts/check-destructive-migrations.mjs
 *
 * 파괴적 마이그레이션 사전 확인 게이트 (대장 #180 잔여분 ②) — Prisma 마이그레이션 SQL에서
 * 데이터·제약 손실 구문을 탐지하고, 사람이 명시적으로 승인(마커 파일)하지 않은 것이 하나라도
 * 있으면 fail-closed로 CI를 red로 세운다.
 *
 * ── 왜 있는가 ────────────────────────────────────────────────────────────────────
 * `services/api/docker-entrypoint.sh`의 `RUN_MIGRATIONS:-true`가 api 부팅 전 `prisma migrate deploy`를
 * 자동 실행한다. 배포는 이제 자동(main 머지 → GitHub Environment 승인 → 배포)이라, `DROP COLUMN` 같은
 * 마이그레이션이 머지되면 **승인 게이트를 지나 비가역 적용**된다. 승인자는 "배포를 승인"할 뿐 그
 * 마이그레이션이 파괴적인지 화면에서 알 방법이 없다 — 이 스크립트가 그 간극을 승인 *전에* 메운다.
 *
 * ── 검사 정의 ────────────────────────────────────────────────────────────────────
 * `services/api/prisma/migrations/<각 디렉터리>/migration.sql` 각각에서 아래 패턴을 찾는다(대소문자 무관,
 * 넓게 잡는다 — 오탐은 마커로 풀면 되지만 미탐은 비가역이다):
 *   DROP COLUMN · DROP TABLE · TRUNCATE · DROP CONSTRAINT · SET NOT NULL ·
 *   DROP DATABASE · DROP SCHEMA · DROP INDEX · Prisma 자동 경고 주석
 *   ("You are about to drop ... / ... will be lost / A unique constraint covering...")
 * ⚠️ 경고 주석은 신호 중 **하나**일 뿐이다 — 손으로 쓴 SQL(주석 없이 직접 작성)도 실제 DROP/TRUNCATE
 * 구문 패턴으로 잡힌다. 주석 존재 여부에만 기대지 않는다.
 *
 * 파괴적 구문이 있는 마이그레이션은, 같은 디렉터리 안에 승인 마커 파일
 * (`DESTRUCTIVE-APPROVAL.md`, `MARKER_FILENAME`)이 있어야 통과한다. 마커는 존재만으로 통과하지
 * 않는다(규율 21 "있는 척" 방지) — `## 손실 실측`·`## 복원점` 두 섹션에 **그 칸이 실제 절차를 밟았다면
 * 자연히 남는 도메인 신호**가 있어야 유효한 마커로 인정한다: 손실 실측은 "11행 중 0건"처럼 수치+단위,
 * 복원점은 `gachinol-20260902-040924.sql.gz`처럼 타임스탬프+백업 확장자를 가진 식별자. 섹션이 없거나
 * 공백뿐이거나 `-`·`n/a`·`TODO`·문자 반복 같은 자리표시자면 "마커 없음"과 동일하게 취급한다
 * (단순 금칙어 목록이 아니라 도메인 신호 요구 방식 — `isMeaningfulSectionBody` 참조. 완벽하지 않다:
 * 도메인 신호 형태를 흉내 낸 값(예: 실제와 무관한 그럴듯한 숫자·파일명)까지 막지는 못한다).
 *
 * ── fail-closed ─────────────────────────────────────────────────────────────────
 * 미승인 파괴적 마이그레이션 1건 이상 → exit 1. 마이그레이션 디렉터리를 못 찾음 → exit 1.
 * 마이그레이션 디렉터리는 있는데 하위 디렉터리(개별 마이그레이션)가 0건 → exit 1(조용한 통과 금지).
 *
 * ── 사용법 ────────────────────────────────────────────────────────────────────────
 *   node infra/scripts/check-destructive-migrations.mjs
 *   node infra/scripts/check-destructive-migrations.mjs --repo-root /path/to/other/repo   # 테스트용
 * 종료 코드: 0=전 마이그레이션 통과 / 1=미승인 파괴적 구문 1건 이상 또는 대상 0건 또는 디렉터리 부재
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DEFAULT_MIGRATIONS_REL_DIR = 'services/api/prisma/migrations';
export const MARKER_FILENAME = 'DESTRUCTIVE-APPROVAL.md';

// ── 파괴적 구문 패턴 — 순수 데이터 ────────────────────────────────────────────────
// 넓게 잡는다: 오탐(과차단)은 마커로 풀면 되는 저비용이지만, 미탐(과소차단)은 비가역이라 고비용이다.
export const DESTRUCTIVE_PATTERNS = [
  { id: 'drop-column', label: 'DROP COLUMN', re: /\bDROP\s+COLUMN\b/i },
  { id: 'drop-table', label: 'DROP TABLE', re: /\bDROP\s+TABLE\b/i },
  { id: 'truncate', label: 'TRUNCATE', re: /\bTRUNCATE\b/i },
  { id: 'drop-constraint', label: 'DROP CONSTRAINT', re: /\bDROP\s+CONSTRAINT\b/i },
  { id: 'set-not-null', label: 'SET NOT NULL', re: /\bSET\s+NOT\s+NULL\b/i },
  { id: 'drop-database', label: 'DROP DATABASE', re: /\bDROP\s+DATABASE\b/i },
  { id: 'drop-schema', label: 'DROP SCHEMA', re: /\bDROP\s+SCHEMA\b/i },
  { id: 'drop-index', label: 'DROP INDEX', re: /\bDROP\s+INDEX\b/i },
  {
    id: 'prisma-warning-comment',
    label: 'Prisma 자동 경고 주석',
    // Prisma가 스스로 넣는 문구 — 신호 중 하나일 뿐, 이것만으로 판정하지 않는다(위 헤더 주석 참조).
    // ⚠️ `.*`를 `.{0,80}`로 제한: 아래 findDestructiveMatches가 줄바꿈을 공백으로 정규화해 스캔하므로,
    // 무제한 `.*`는 이론상 파일 전체를 가로질러 매치될 수 있다(가비지 텍스트 스니펫 위험). 80자면
    // Prisma 실제 생성 문구("All the data in the column will be lost.")를 넉넉히 덮는다.
    re: /you are about to drop|all the data.{0,80}will be lost|a unique constraint covering/i,
  },
];

/**
 * SQL 본문에서 파괴적 패턴 매치를 전부 찾는다.
 *
 * ⚠️ 단순 줄 단위 스캔이 아니다 — 손으로 정렬한 SQL은 키워드가 개행으로 쪼개질 수 있다
 * (예: `ALTER TABLE foo\nDROP\n  COLUMN bar;`). 개행을 공백 1개로 치환한 "정규화 본문"에서
 * 패턴을 찾되(치환은 길이를 보존하므로 정규화 본문의 문자 오프셋이 원본과 1:1 대응한다),
 * 매치 시작 오프셋을 원본 줄 번호로 역산해 보고 정확도(행 번호)를 잃지 않는다.
 * @param {string} sqlContent
 * @returns {{id: string, label: string, line: number, text: string}[]}
 */
export function findDestructiveMatches(sqlContent) {
  if (typeof sqlContent !== 'string') return [];
  const lines = sqlContent.split('\n');

  // 각 줄의 시작 오프셋(정규화 본문 기준 — 개행→공백 치환은 1:1이라 원본과 오프셋이 같다).
  const lineStarts = [];
  let cursor = 0;
  for (const line of lines) {
    lineStarts.push(cursor);
    cursor += line.length + 1; // +1 = 이 줄 뒤의 개행(마지막 줄엔 실제로 없어도 이후 조회가 없어 무해)
  }

  function lineNumberAt(offset) {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (lineStarts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1; // 1-based
  }

  const normalized = sqlContent.replace(/\n/g, ' ');
  const matches = [];
  for (const pattern of DESTRUCTIVE_PATTERNS) {
    const flags = pattern.re.flags.includes('g') ? pattern.re.flags : `${pattern.re.flags}g`;
    const globalRe = new RegExp(pattern.re.source, flags);
    let m;
    while ((m = globalRe.exec(normalized)) !== null) {
      const matchLen = Math.max(m[0].length, 1);
      const startLine = lineNumberAt(m.index);
      const endLine = lineNumberAt(m.index + matchLen - 1);
      const text = lines
        .slice(startLine - 1, endLine)
        .map((l) => l.trim())
        .filter(Boolean)
        .join(' ⏎ ');
      matches.push({ id: pattern.id, label: pattern.label, line: startLine, text });
      if (globalRe.lastIndex === m.index) globalRe.lastIndex += 1; // 빈 매치 무한루프 가드
    }
  }
  matches.sort((a, b) => a.line - b.line);
  return matches;
}

// ── 승인 마커 파싱 — 순수 함수 ─────────────────────────────────────────────────────

/** 마커 통과에 필요한 섹션(둘 다 "도메인 신호"가 있어야 유효 — 아래 SECTION_VALIDATORS 참조). */
export const REQUIRED_MARKER_SECTIONS = ['손실 실측', '복원점'];

/**
 * 마크다운 본문에서 `## <heading>` 섹션의 본문(다음 `## ` 헤딩 전까지)을 뽑는다.
 * 섹션 자체가 없으면 `null`을 반환한다.
 * @param {string} markdown
 * @param {string} heading
 * @returns {string|null}
 */
export function extractMarkerSection(markdown, heading) {
  if (typeof markdown !== 'string') return null;
  const lines = markdown.split('\n');
  const headingRe = new RegExp(`^##\\s+${heading}\\s*$`);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (headingRe.test(lines[i].trim())) {
      start = i + 1;
      break;
    }
  }
  if (start === -1) return null;
  const body = [];
  for (let i = start; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i].trim())) break;
    body.push(lines[i]);
  }
  return body.join('\n').trim();
}

// ── 섹션 "무의미값" 판정 — 순수 함수 ───────────────────────────────────────────────
// ⚠️ 규율 21 "있는 척" 방지의 핵심부. 단순 금칙어 목록(`-`·`n/a`·`TODO`)은 `.`·`x`·"확인함"으로
// 즉시 우회되므로 쓰지 않는다. 대신 그 칸이 **실제 절차를 밟았다면 자연히 남는 도메인 신호**를
// 요구한다: 손실 실측은 "몇 건/몇 행" 같은 수치, 복원점은 실제 백업 파일명(타임스탬프+확장자) 식별자.
// 길이·문자 다양성 조건은 함께 걸되 그것만으로는 부족하다(같은 글자 반복 우회 방지용 보조 조건일 뿐).

/** 유효 판정 최소 길이(공백 제외). `-`·`n/a`·`TODO` 전부 이 미만이다. */
const MIN_SECTION_CHARS = 8;
/** 최소 서로 다른 문자 종류 수. `--------`·`TODOTODO`·`00000000` 같은 반복 우회를 막는다. */
const MIN_UNIQUE_CHARS = 4;

function nonWhitespace(text) {
  return (text ?? '').replace(/\s+/g, '');
}

/** 반복 문자(또는 극소수 문자 종류)로만 채운 자리표시자인지. */
function isLowEntropy(text) {
  const compact = nonWhitespace(text);
  if (compact.length === 0) return true;
  return new Set(compact).size < MIN_UNIQUE_CHARS;
}

// 손실 실측: 실제로 확인했다면 "11행"·"0건"처럼 수치+단위가 함께 남는다.
// 숫자 존재만으로 판정하면 "asdf1234" 같은 의미 없는 값도 통과하므로, 숫자 뒤에 실측 단위가
// 붙는 형태까지 요구한다.
const MEASUREMENT_UNIT_RE = /\d+\s*(건|행|개|줄|열|rows?|cases?|columns?|records?)/i;
function hasMeasurementSignal(text) {
  return MEASUREMENT_UNIT_RE.test(text ?? '');
}

// 복원점: 실제로 백업을 확보했다면 복원 가능한 파일 식별자(타임스탬프+백업 확장자)가 남는다.
// 예: `gachinol-20260902-040924.sql.gz`. 확장자만 요구하면 "backup.sql.gz"처럼 확장자를 아는
// 사람이면 누구나 타이핑할 수 있는 값도 통과하므로, 타임스탬프로 보이는 4자리 이상 연속 숫자를
// 함께 요구한다.
const BACKUP_IDENTIFIER_RE = /\d{4,}[\w.-]*\.(sql\.gz|sql|dump|bak|tar\.gz|tar|gz|zip)\b/i;
function hasBackupIdentifierSignal(text) {
  return BACKUP_IDENTIFIER_RE.test(text ?? '');
}

/** 섹션별 도메인 신호 검사기. */
const SECTION_VALIDATORS = {
  손실실측: hasMeasurementSignal,
  복원점: hasBackupIdentifierSignal,
};
// 위 키는 공백 없는 식별자로 두고, 조회는 아래에서 heading의 공백을 제거해 맞춘다
// (REQUIRED_MARKER_SECTIONS의 '손실 실측'과 매핑하기 위함).

/**
 * 섹션 본문이 "실제 절차의 산출물"로 볼 수 있는지 판정한다(빈칸·짧은 값·반복 문자·
 * 도메인 신호 없는 값을 전부 무의미로 취급).
 * @param {string} heading
 * @param {string|null} body
 * @returns {boolean}
 */
export function isMeaningfulSectionBody(heading, body) {
  if (!body) return false;
  if (nonWhitespace(body).length < MIN_SECTION_CHARS) return false;
  if (isLowEntropy(body)) return false;
  const validator = SECTION_VALIDATORS[heading.replace(/\s+/g, '')];
  if (validator && !validator(body)) return false;
  return true;
}

/**
 * 마커 본문을 파싱해 필수 섹션이 전부 "무의미값이 아닌지"(도메인 신호를 포함하는지) 판정한다.
 * `markdown`이 `null`(마커 파일 부재)이면 전 섹션이 누락으로 처리된다.
 * @param {string|null} markdown
 * @returns {{ sections: Record<string,string|null>, missing: string[], valid: boolean }}
 */
export function parseApprovalMarker(markdown) {
  const sections = {};
  const missing = [];
  for (const heading of REQUIRED_MARKER_SECTIONS) {
    const body = markdown == null ? null : extractMarkerSection(markdown, heading);
    const meaningful = isMeaningfulSectionBody(heading, body);
    sections[heading] = meaningful ? body : null; // 무의미값(빈칸·자리표시자)도 "없음"으로 취급(규율 21)
    if (!meaningful) missing.push(heading);
  }
  return { sections, missing, valid: missing.length === 0 };
}

// ── 마이그레이션 1건 판정 — 순수 함수 ────────────────────────────────────────────

/**
 * @param {{ name: string, sqlContent: string, markerContent: string|null }} args
 */
export function checkMigrationDir({ name, sqlContent, markerContent }) {
  const matches = findDestructiveMatches(sqlContent);
  if (matches.length === 0) {
    return {
      name,
      matches,
      hasMarker: markerContent != null,
      marker: null,
      ok: true,
      reason: '파괴적 구문 없음',
    };
  }

  const marker = parseApprovalMarker(markerContent);
  if (marker.valid) {
    return {
      name,
      matches,
      hasMarker: true,
      marker,
      ok: true,
      reason: `파괴적 구문 ${matches.length}건 — 승인 마커 확인됨(${MARKER_FILENAME})`,
    };
  }

  const reason =
    markerContent == null
      ? `승인 마커 파일 없음(${MARKER_FILENAME})`
      : `승인 마커의 필수 칸 미기재: ${marker.missing.join(', ')}`;
  return { name, matches, hasMarker: markerContent != null, marker, ok: false, reason };
}

// ── 전체 실행 — fs 접근 ────────────────────────────────────────────────────────────

/**
 * @param {string} repoRoot
 * @param {string} migrationsRelDir
 */
export function checkAllMigrations(repoRoot, migrationsRelDir = DEFAULT_MIGRATIONS_REL_DIR) {
  const migrationsDir = join(repoRoot, migrationsRelDir);
  if (!existsSync(migrationsDir)) {
    return {
      ok: false,
      results: [],
      migrationsDir,
      reason: `마이그레이션 디렉터리를 찾지 못함: ${migrationsDir}`,
    };
  }

  const entries = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  if (entries.length === 0) {
    return {
      ok: false,
      results: [],
      migrationsDir,
      reason: `마이그레이션 디렉터리에 하위 디렉터리가 0건: ${migrationsDir}`,
    };
  }

  const results = entries.map((name) => {
    const sqlPath = join(migrationsDir, name, 'migration.sql');
    if (!existsSync(sqlPath)) {
      return {
        name,
        matches: [],
        hasMarker: false,
        marker: null,
        ok: false,
        reason: `migration.sql 없음: ${sqlPath}`,
      };
    }
    const sqlContent = readFileSync(sqlPath, 'utf8');
    const markerPath = join(migrationsDir, name, MARKER_FILENAME);
    const markerContent = existsSync(markerPath) ? readFileSync(markerPath, 'utf8') : null;
    return checkMigrationDir({ name, sqlContent, markerContent });
  });

  return { ok: results.every((r) => r.ok), results, migrationsDir };
}

// ── CLI ─────────────────────────────────────────────────────────────────────────

function main() {
  console.log('── 파괴적 마이그레이션 사전 확인 (대장 #180) ──');

  const args = process.argv.slice(2);
  const repoRootIdx = args.indexOf('--repo-root');
  const repoRoot = repoRootIdx >= 0 ? args[repoRootIdx + 1] : REPO_ROOT;
  const migDirIdx = args.indexOf('--migrations-dir');
  const migrationsRelDir = migDirIdx >= 0 ? args[migDirIdx + 1] : DEFAULT_MIGRATIONS_REL_DIR;

  let outcome;
  try {
    outcome = checkAllMigrations(repoRoot, migrationsRelDir);
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

  let anyFail = false;
  for (const r of outcome.results) {
    if (r.matches.length === 0) {
      console.log(`  ✔ ${r.name}: 파괴적 구문 없음`);
      continue;
    }
    if (r.ok) {
      console.log(`  ✔ ${r.name}: ${r.reason}`);
    } else {
      anyFail = true;
      console.error(`  ✘ ${r.name}: 파괴적 구문 ${r.matches.length}건 — ${r.reason}`);
      for (const m of r.matches) {
        console.error(`      - L${m.line} [${m.label}] ${m.text}`);
      }
    }
  }

  if (anyFail || !outcome.ok) {
    console.error(
      `\n판정: FAIL — 승인 마커(${MARKER_FILENAME})를 해당 마이그레이션 디렉터리에 추가하고 ` +
        `"## 손실 실측"(수치+단위, 예: "11행 중 0건")·"## 복원점"(백업 파일 식별자, 예: ` +
        `"gachinol-20260902-040924.sql.gz")을 실측 내용으로 채워야 한다(빈 칸·자리표시자는 마커로 인정하지 않는다).`,
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    '\n판정: PASS — 파괴적 구문이 있는 마이그레이션은 전부 승인 마커가 확인됐다(또는 파괴적 구문이 없다).',
  );
}

const isMainModule = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  main();
}
