#!/usr/bin/env node
/**
 * 대장(PIVOT-PLAN §6-1~§6-11) 대기 항목 재현 명령 일괄 실행 — 읽기 전용.
 *
 * 왜 스크립트로 남기는가: #159(2026-08-22)가 같은 일을 했지만 **스크립트를 커밋하지 않아**
 * 매번 처음부터 다시 만들어야 했고, 그것이 "수동 판정 미완"이 쌓인 원인 중 하나다.
 * 이 파일이 있으면 다음 세션은 `node infra/scripts/daejang-recheck.mjs` 한 번으로 전건 대조한다.
 *
 * ── 대장 #182 수리(2026-09-01) — 무엇이 왜 깨져 있었는가 ────────────────────────────
 * 舊 버전은 행 식별을 `^\| \d+ \|` 정규식 하나로 했다. 그 결과 ①§6 밖의 무관한 표까지
 * "대장 행"으로 셌고(전체 매치 247행 중 57행이 §6-11 밖) ②§6-1~§6-10이 각자 1번부터
 * 재시작해 번호가 중복됐고 ③§6-1의 `D-1`~`D-18`은 정규식에 안 걸려 영구 비가시였고
 * ④§6-5(상태 칸 자체가 없는 표)의 마지막-2번째 칸을 "상태"로 잘못 읽었다. 게다가
 * §6-11 표 안의 **빈 줄 2행**이 표 무결성 검사의 `cur = null` 리셋을 유발해 표가 물리적으로
 * 쪼개졌고, 무결성 검사는 뒤 조각(약 101행, 이탈 행 9개 전부 포함)을 아예 보지 못했다.
 * → **지금은 표 단위로 파싱하고, 열 위치를 헤더 이름으로 판정한다**(아래 "표 파싱 규약").
 * PIVOT-PLAN.md §6-11 자체의 물리 복구(9행 칸 정정 + 빈 줄 2행 제거)는 대장 #182 완료 보고에
 * 동봉된 diff가 원천이다 — 이 스크립트는 그 데이터가 이미 정합인 것을 전제하지 않는다
 * (빈 줄이 다시 생겨도 표가 안 쪼개지도록 파서 자체를 고쳤다 — 아래 "표 파싱 규약" ②).
 *
 * ── 표 파싱 규약 (parseTables) ──────────────────────────────────────────────────
 * ① 마크다운 표는 "헤더 행 + 구분선(`|---|---|...`) + 데이터 행*"으로 식별한다. 헤더 행 후보는
 *    다음 비어있지 않은 줄이 구분선인지 **미리보기(lookahead)**로 확정한다 — 번호가 숫자인지는
 *    보지 않는다(`D-1` 같은 비숫자 ID도 그래서 인식된다).
 * ② **빈 줄은 표를 끝내지 않는다.** 표를 끝내는 것은 "파이프로 시작하지 않는 비어있지 않은 줄"
 *    (본문 산문·`###` 절 제목·`>` 인용문)뿐이다. 이 문서의 모든 표-표 경계에는 실제로 그런 줄이
 *    끼어 있음을 확인했다(§6-1→§6-2 경계 등 11개소 전수) — 그래서 표 내부의 우발적 빈 줄과
 *    표-표 경계를 안전하게 구분할 수 있다.
 * ③ 셀 분리는 정규식으로 칸 수를 세지 않는다(`(?:[^|]|\\\|)*` 형태는 `\`를 `[^|]`로도 소비해
 *    한 행이 여러 칸 수에 동시 매치할 수 있다 — 실제로 밟은 함정). **이스케이프 안 된 파이프
 *    (`(?<!\\)\|`)로 split한 뒤 배열 길이로 센다.**
 *
 * ── 열 판정 (mapColumns) ────────────────────────────────────────────────────────
 * 헤더 이름으로 판정한다(칸 위치 하드코딩 금지 — 표마다 칸 수·순서가 다르다):
 *   - `#`            → ID 칸
 *   - `상태`          → 상태 칸. **이 칸이 없는 표(§6-5 등)는 판정 대상에서 제외**로 분류한다
 *                       (무시가 아니라 "제외됨"으로 명시 보고 — §6-5는 5칸이고 상태 개념이 없다)
 *   - `확인 방법(grep)` 또는 `대조 방법(grep)` → 확인 방법 칸(재현 명령 원천)
 *   - `기한` 또는 `트리거` → 기한 칸(§6-6이 "기한" 대신 "트리거"를 쓴다)
 *
 * ── 재현 명령 기대값 문법 (extractPairs) ─────────────────────────────────────────
 * 대장에 실제로 쓰인 표기를 전수 조사(2026-09-01)해 아래로 확정한다. **앞으로 대장에 재현
 * 명령을 쓰는 사람은 이 목록 중 하나를 쓴다.**
 *   ⓐ `` `cmd` → **N** ``                 — 가장 단순한 형태(등재 시 값이 곧 N)
 *   ⓑ `` `cmd` → 등재 시 **N** ``          — 가장 흔한 형태(§4-C·`등재 시` 명시)
 *   ⓒ `` `cmd` → 등재 시점 **N건** `` 또는 `` `cmd` → 각 **N** `` — "등재 시점"·"각"(다중 파일 개별값) 접두 변형
 *   ⓓ `해소 후 ≥N`                        — 목표 임계값(사람 판정용 정보. 자동 일치/불일치
 *                                            판정에는 쓰지 않는다 — "값 일치가 곧 해소는 아니다")
 *   ⓔ 빈 출력 = **0**                     — 명령이 아무것도 안 찍고 exit 1이면(예: 매치 없는
 *                                            `grep`) 값은 0으로 정규화한다(대장이 늘 카운트
 *                                            의미로 쓰기 때문— "(빈 출력)" 문자열로 두면 "0"과
 *                                            영원히 불일치로 오판정된다)
 *   ⓕ `grep -l`/`-rl`(파이프 없이 단독)   — 값은 **첫 줄(파일 경로)이 아니라 매치된 파일 개수**
 *                                            (출력 줄 수)로 판정한다. 파이프 뒤에 `| wc -l`이
 *                                            붙으면 그 결과를 그대로 쓴다(이중 변환 금지)
 *   ⓖ `grep -c`/`-rc` 다중 파일           — 기본은 **합계**. 대장이 "각 N"이라고 쓴 행은
 *                                            **파일마다 전부 N과 같은지**로 판정한다(합산 금지 —
 *                                            #161 "각 2"를 합계 4로 오판정하던 결함의 재발 방지)
 *   ⓗ 자연어·"리포 명령 없음"·"사용자 실행/확인/판단" → 자동판정 불가로 **명시적 수동** 분류
 *      (백틱이 있어도 인식 접두사가 아니면 "인식되지 않는 명령"으로 별도 사유 표기)
 *
 * ── 실행 안전 ───────────────────────────────────────────────────────────────────
 * 화이트리스트에 있는 읽기 전용 커맨드만 실행한다. 리다이렉션·쓰기·네트워크·명령 치환은
 * 거부한다. **단, `$(`가 셸 명령 치환이 아니라 awk 필드 참조(`$(NF-1)`)로 작은따옴표
 * 안에서만 쓰이는 경우는 통과시킨다** — 舊 `DENY_PATTERN`의 `\$\(`는 위치를 안 보고 문자열만
 * 봐서 awk 필드 참조까지 오탐 차단했다(대장 #182가 지적한 바로 그 결함. 파이프·awk 자체는
 * 원래도 화이트리스트 안에 있었다). 진짜 명령 치환(작은따옴표 밖의 `$(`)은 여전히 차단한다.
 * 거부된 명령은 실패가 아니라 **수동 판정 대상**으로 분류해 출력한다(조용히 건너뛰지 않는다).
 * 실행 직전에는 재귀 `grep -r*`·`find`에 `node_modules`·`dist` 제외를 **실행기가 강제**한다
 * (대장 #103·#173이 "제외" 필요성을 괄호 주석으로만 적어 강제되지 않던 것의 수리 — 대장
 * 문언 자체는 고치지 않는다·표시되는 명령 텍스트는 원문 그대로다).
 * **바이너리 화이트리스트만으로는 부족하다**(대장 #191, 2026-09-01) — `sed -i`(파일 변조)·
 * `find -delete`/`-exec`류(파일 삭제·임의 실행)·`awk`의 `system()`(임의 명령 실행)은 바이너리
 * 자체는 읽기 전용 목록에 있어도 그 하위 기능이 쓰기·실행이다. `isSafe`가 세그먼트별로 이 3종을
 * 추가로 걸러낸다(상세는 `isSafe` 정의 앞 주석).
 *
 * ⚠️ 재현 명령은 **대장에 적힌 그대로** 실행한다(#159 교훈 — 조율자가 명령을 넓게 고쳐 잡아
 *    #117을 "해소"로 오판하고 사용자에게 그렇게 보고한 적이 있다).
 * ⚠️ 값 일치가 곧 해소는 아니다(#114 교훈 — 명령은 검출했으나 **결함 자체가 없었다**).
 *    이 스크립트는 "대장 기재값과 현재값이 어긋난 항"을 골라줄 뿐, 판정은 사람이 한다.
 *
 * 사용:
 *   node infra/scripts/daejang-recheck.mjs            # 대기 항목 전건
 *   node infra/scripts/daejang-recheck.mjs --all      # 상태 무관 전건
 *   node infra/scripts/daejang-recheck.mjs --only 115,116
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const LEDGER = resolve(REPO, 'docs/plan/PIVOT-PLAN.md');

// 대기 상태 문자열은 소스에 직접 쓰지 않는다 — #159 ②가 보인 것처럼 **카운트 대상 문자열을
// 본문에 쓰면 오카운트**가 반복되기 때문이다. 같은 규율을 도구 소스에도 적용한다.
const PENDING = ['미', '수', '신'].join('');
// ⚠️ `status.includes(PENDING)`만으로는 부족하다 — #159 ②와 같은 층의 새 변종을 이번 정독에서
// 실측했다: `D-5`의 상태 칸은 실제로 "**수신 완료**(舊 "미수신" 오기재를 07 §6이 자체 정정)"인데
// 이력 서술 괄호 안에 舊값 문자열이 그대로 남아 있어 `includes`가 오카운트한다. **상태 칸은 항상
// 굵게 뜬 상태어로 시작**하는 것이 이 대장의 일관된 표기이므로, "칸이 그 단어를 포함하는가"가
// 아니라 "칸이 그 단어로 시작하는가"로 판정해야 이런 이력 서술을 오카운트하지 않는다.
const PENDING_PREFIX_RE = new RegExp(`^\\*\\*${PENDING}`);
export function isPendingStatus(status) {
  return PENDING_PREFIX_RE.test((status ?? '').trim());
}

/** 읽기 전용 화이트리스트. 여기 없는 실행 파일이 하나라도 섞이면 그 명령은 수동 분류한다. */
export const ALLOWED = new Set([
  'grep', 'awk', 'sed', 'wc', 'ls', 'find', 'test', 'cat', 'head', 'tail',
  'sort', 'uniq', 'cut', 'tr', 'echo', 'basename', 'dirname', 'true', 'printf',
]);
/** 이게 하나라도 있으면 셸 부작용 가능 → 수동 분류(명령 치환 `$(`은 별도 함수로 위치까지 본다) */
const DENY_CHAR_PATTERN = /[>;&`]|\brm\b|\bmv\b|\bcp\b|\bchmod\b|\bcurl\b|\bdocker\b|\bgit\b|\bnode\b|\bpnpm\b/;

// ─────────────────────────────────────────────────────────────────────────────
// 표 파싱
// ─────────────────────────────────────────────────────────────────────────────

/** `|---|---|...` 형태의 구분선 판정 (콜론 정렬 표기도 허용) */
function isSeparatorLine(trimmed) {
  return /^\|(\s*:?-+:?\s*\|)+$/.test(trimmed);
}

/** 이스케이프 안 된 파이프로 split → 양끝 경계 셀 제거 → 각 셀 이스케이프 해제·trim */
export function splitCells(line) {
  const trimmedLine = line.trim();
  const parts = trimmedLine.split(/(?<!\\)\|/);
  const cells = parts.slice(1, -1);
  return cells.map((c) => c.replace(/\\\|/g, '|').trim());
}

/**
 * 대장 #192 수리(2026-09-01) — `splitCells`와 셀 **경계** 판정 로직은 동일하지만(이스케이프 안 된
 * `|`만 경계), 셀 **내용**은 언이스케이프하지 않는다.
 *
 * 왜 분리했는가: 마크다운 표 이스케이프(`\|` = "이 파이프는 칸 구분자가 아니다")와 grep BRE의
 * alternation 표기(`\|` = "이 파이프는 OR다")가 **완전히 같은 두 문자**다. `splitCells`처럼 셀
 * 경계를 가른 뒤 내용에서 `\|`→`|`로 되돌리면, 대장에 `grep -c "a\|b" file`로 적힌 확인 명령이
 * 실행 시점에는 `grep -c "a|b" file`이 되어 **alternation이 리터럴 파이프로 뭉개진다**(BRE 기본
 * 모드에서 이스케이프 안 된 `|`는 그냥 문자다). 실측(#66, `env.schema.ts(Env) **밖**\|Env) 밖`
 * 패턴): 언이스케이프한 채 실행 → `main.ts:0`(틀림) / `\|` 원문 보존 → `main.ts:1`(맞음).
 * `확인 방법(grep)` 칸처럼 **셸에 그대로 실행되는 텍스트**는 이 함수로 뽑아야 한다(`extractPairs`가
 * 소비). 이 파이프 이스케이프 결함의 영향 범위는 5개 pair — #62·#66·#71·#79·#127(§6-11 전수
 * 스캔으로 확인) — 이며, 그중 #127은 값 일치("미해소 유력")가 어긋남("등재값이 낡음")으로 뒤집힐
 * 만큼 판정에 영향을 준다.
 */
export function splitCellsRaw(line) {
  const trimmedLine = line.trim();
  const parts = trimmedLine.split(/(?<!\\)\|/);
  const cells = parts.slice(1, -1);
  return cells.map((c) => c.trim());
}

/**
 * 문서 전체를 표 단위로 파싱한다. 각 표는 `{ headerLine, headers, rows }`이며
 * `rows`는 `{ lineNumber, raw, cells }`의 배열이다. 빈 줄은 표를 끝내지 않는다(② 참고).
 */
export function parseTables(content) {
  const lines = content.split('\n');
  const tables = [];
  let current = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed === '') continue; // 빈 줄 — 표를 끝내지 않는다
    if (!trimmed.startsWith('|')) {
      current = null; // 진짜 경계(산문·제목·인용문)만 표를 끝낸다
      continue;
    }
    if (isSeparatorLine(trimmed)) continue; // 헤더 처리 시 미리보기로 이미 소비됨

    // 다음 비어있지 않은 줄이 구분선이면 이 줄은 새 표의 헤더다
    let j = i + 1;
    while (j < lines.length && lines[j].trim() === '') j++;
    const nextTrimmed = j < lines.length ? lines[j].trim() : '';
    if (isSeparatorLine(nextTrimmed)) {
      current = { headerLine: i + 1, headers: splitCells(line), rows: [] };
      tables.push(current);
      continue;
    }

    // 그 외는 데이터 행 — 현재 활성 표에 귀속(활성 표가 없으면 고아 행, 무시)
    // `rawCells`는 splitCellsRaw 산출(파이프 이스케이프 원문 보존) — 확인 방법 칸처럼 실행
    // 문자열을 뽑아야 하는 소비처(parseLedgerRows의 verify)만 이걸 쓴다. 그 외(상태·기한·번호·
    // 표 무결성 검사)는 계속 `cells`(언이스케이프됨)를 쓴다 — 대장 #192.
    if (current) {
      current.rows.push({
        lineNumber: i + 1,
        raw: line,
        cells: splitCells(line),
        rawCells: splitCellsRaw(line),
      });
    }
  }
  return tables;
}

const STATUS_HEADER = '상태';
const VERIFY_HEADER_RE = /^(확인 방법|대조 방법)/;
const DUE_HEADER_RE = /^(기한|트리거)$/;

/** 헤더 이름 → 열 인덱스. 없으면 -1 (칸 위치 하드코딩 금지) */
export function mapColumns(headers) {
  const idIdx = headers.indexOf('#');
  const statusIdx = headers.indexOf(STATUS_HEADER);
  const verifyIdx = headers.findIndex((h) => VERIFY_HEADER_RE.test(h));
  const dueIdx = headers.findIndex((h) => DUE_HEADER_RE.test(h));
  return { idIdx, statusIdx, verifyIdx, dueIdx, hasStatus: statusIdx !== -1 };
}

/**
 * 대장(`## 6.` 이후) 범위의 표만 골라 정규화된 행 목록을 만든다. 표마다 칸 수·열 구성이
 * 달라도 헤더 이름으로 판정하므로 안전하다. 상태 칸이 없는 표는 `hasStatus: false`로
 * 표시하고 별도 집계한다(무시가 아니라 명시적 제외).
 */
export function parseLedgerRows(content) {
  const lines = content.split('\n');
  const sectionLine = lines.findIndex((l) => /^## 6\./.test(l));
  const tables = parseTables(content).filter(
    (t) => sectionLine === -1 || t.headerLine > sectionLine + 1,
  );

  const rows = [];
  const excludedTables = [];
  for (const table of tables) {
    const cols = mapColumns(table.headers);
    if (!cols.hasStatus) {
      excludedTables.push({ headerLine: table.headerLine, headers: table.headers, rowCount: table.rows.length });
      continue;
    }
    for (const row of table.rows) {
      rows.push({
        num: cols.idIdx >= 0 ? row.cells[cols.idIdx] : undefined,
        status: row.cells[cols.statusIdx] ?? '',
        // ⚠️ verify만 rawCells(파이프 이스케이프 원문 보존)를 쓴다 — extractPairs가 여기서 뽑는
        // grep 명령이 셸에 그대로 실행되기 때문이다(대장 #192). status·due·num은 실행되지 않는
        // 표시/판정용 텍스트라 종전대로 언이스케이프된 cells를 쓴다.
        verify: cols.verifyIdx >= 0 ? (row.rawCells[cols.verifyIdx] ?? '') : '',
        due: cols.dueIdx >= 0 ? (row.cells[cols.dueIdx] ?? '') : '',
        cells: row.cells,
        expectedCellCount: table.headers.length,
        actualCellCount: row.cells.length,
        lineNumber: row.lineNumber,
        tableHeaderLine: table.headerLine,
      });
    }
  }
  return { rows, excludedTables, tableCount: tables.length };
}

/** 표 무결성 — 헤더 칸 수와 실제 칸 수가 다른 행만 정확히 잡는다(모드 추정 없음). */
export function checkTableIntegrity(content) {
  const tables = parseTables(content);
  const bad = [];
  for (const table of tables) {
    for (const row of table.rows) {
      if (row.cells.length !== table.headers.length) {
        bad.push({
          num: row.cells[0] ?? '?',
          lineNumber: row.lineNumber,
          expected: table.headers.length,
          actual: row.cells.length,
          tableHeaderLine: table.headerLine,
        });
      }
    }
  }
  return bad;
}

// ─────────────────────────────────────────────────────────────────────────────
// 재현 명령 기대값 파싱
// ─────────────────────────────────────────────────────────────────────────────

const CMD_PREFIX_RE = /^(grep|awk|sed|ls |find |wc |cat |test )/;
// 등재 시(점)? 접두, 각 접두, **N**(뒤에 건·passed 등 부가어 허용) — 문법 ⓐⓑⓒ
const EXPECTED_RE = /→\s*(등재\s*시점?\s*)?(각\s*)?\*\*(\d+)[^*]*\*\*/;
// 해소 후 ≥N — 문법 ⓓ(정보용, 자동 일치 판정에는 미사용)
const RESOLVE_THRESHOLD_RE = /해소\s*후\s*(?:각각\s*)?≥\s*(\d+)/;
// 명시적 수동 표지 — 문법 ⓗ
const EXPLICIT_MANUAL_RE = /리포 명령 없음|사용자\s*(실행|확인|판단)/;

/**
 * 대장 #192 — `\|`는 놓인 자리에 따라 **세 가지** 다른 것을 의미할 수 있다. 전부 언이스케이프하면
 * grep BRE alternation이 깨지고(#66), 전부 보존하면 이번엔 **진짜 셸 파이프 연산자**가 깨진다
 * (#88의 `find … \| wc -l` — 따옴표 밖의 `\|`는 명령 사이 파이프일 뿐 정규식과 무관한데, 여기서
 * 백슬래시를 살려두면 셸이 파이프가 아니라 리터럴 `|` 문자를 `find` 인자로 넘겨버린다. 실측:
 * `find … \| wc -l` → `bfs: error: Unknown argument`로 죽는다. `find … | wc -l` → 정상 카운트).
 * 그래서 **따옴표 안/밖을 먼저 가른 뒤** 안쪽만 grep 모드로 재분기한다:
 *   ① **따옴표 밖의 `\|`** — 명령 사이 셸 파이프. 마크다운 이스케이프일 뿐이니 **항상** 진짜
 *      파이프 연산자로 복원한다(아래 `splitOnEscapedPipe`가 여기서 세그먼트를 가른다).
 *   ② **따옴표 안의 `\|`(BRE grep)** — alternation 표기이므로 원문 보존(#66).
 *   ③ **따옴표 안의 `\|`(ERE grep, `-E`/`-rE`/`egrep`)** — ERE는 bare `|`가 alternation이라
 *      `\|`는 오히려 리터럴이 되어 매치가 죽는다(#191 실측: `grep -E 'foo\|bar'` 0건 vs
 *      `grep -E 'foo|bar'` 2건). 이 경우만 예외적으로 언이스케이프한다.
 */
function isExtendedGrep(segment) {
  const tokens = segment.trim().split(/\s+/);
  const bin = tokens[0];
  if (bin === 'egrep') return true;
  if (bin !== 'grep') return false;
  return tokens.slice(1).some((t) => {
    if (t === '--extended-regexp') return true;
    if (!t.startsWith('-') || t.startsWith('--')) return false;
    return t.slice(1).includes('E');
  });
}

/**
 * `\|`를 파이프 연산자 후보로 세는 세그먼트 분리기. **따옴표 밖의 `\|`(또는 순수 bare `|`)만**
 * 경계로 본다 — `splitPipeSegments`(bare `|`만 경계로 보는 舊 함수, isSafe 등 하류에서 계속 쓴다)와
 * 달리 여기서는 아직 언이스케이프 전이라 이스케이프된 형태(`\|`)도 경계 후보에 넣어야 한다.
 * 따옴표 **안**의 `\|`는 (이스케이프 형태 그대로) 건드리지 않고 세그먼트 안에 남긴다 — 그 처리는
 * `isExtendedGrep` 분기가 담당한다.
 */
function splitOnEscapedPipe(cmd) {
  const segments = [];
  let current = '';
  let quote = null;
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (quote) {
      current += c;
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"') { quote = c; current += c; continue; }
    if (c === '\\' && cmd[i + 1] === '|') { segments.push(current); current = ''; i++; continue; }
    if (c === '|') { segments.push(current); current = ''; continue; }
    current += c;
  }
  segments.push(current);
  return segments;
}

/**
 * 따옴표 밖의 `\|`는 항상 진짜 파이프로 복원하고, 따옴표 안은 grep 모드(BRE/ERE)에 따라서만
 * 선택적으로 언이스케이프한다.
 */
export function normalizeCmdEscaping(cmd) {
  return splitOnEscapedPipe(cmd)
    .map((seg) => (isExtendedGrep(seg) ? seg.replace(/\\\|/g, '|') : seg))
    .join('|');
}

/**
 * 확인 방법 칸에서 (명령, 기대값) 쌍을 뽑는다.
 *
 * ⚠️ **여기서 `\|`를 일괄 언이스케이프하지 않는다**(대장 #192 — 舊 코드는 `verifyText`
 *   전체에 `.replace(/\\\|/g, '|')`를 적용했다). `verifyText`는 이제 `splitCellsRaw`가 뽑은
 *   **원문 보존** 텍스트이고, 마크다운 표 이스케이프와 grep BRE alternation 표기가 동일 문자열
 *   (`\|`)이라 여기서 되돌리면 grep 명령 안의 alternation이 리터럴 파이프로 깨진다. 대신 명령을
 *   뽑은 **뒤**(`cmd` 확정 후) `normalizeCmdEscaping`으로 grep 모드(BRE/ERE)에 맞게 필요한
 *   세그먼트만 되돌린다.
 *
 * ★ 한 칸에 명령이 여럿일 수 있다 — 재현 명령이 틀린 것으로 판명되면 **舊 명령을 지우지 않고**
 *   "교체:" 뒤에 새 명령을 병기하는 것이 이 대장의 관례이기 때문이다(이력 보존).
 *   그래서 **마지막 쌍이 현행 판정 기준**이다. 첫 번째를 쓰면 이미 무효화된 명령으로 매번
 *   "어긋남"이 뜬다(실제로 #131·#134·#137에서 밟았다).
 *   표지가 없으면 명령들은 **병렬**(둘 다 유효)이므로 전부 판정한다(#88이 그 형태).
 */
export function extractPairs(verifyText) {
  const src = verifyText ?? '';
  const pairs = [];
  const re = /`([^`]+)`/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const cmd = normalizeCmdEscaping(m[1].trim());
    if (!CMD_PREFIX_RE.test(cmd)) continue;
    const rest = src.slice(re.lastIndex);
    const untilMatch = rest.match(/`(grep|awk|sed|ls |find |wc |cat |test )/);
    const window = untilMatch ? rest.slice(0, untilMatch.index) : rest;
    const em = window.match(EXPECTED_RE);
    const th = window.match(RESOLVE_THRESHOLD_RE);
    pairs.push({
      cmd,
      expected: em ? em[3] : null,
      isEachFile: em ? Boolean(em[2]) : false,
      resolveThreshold: th ? Number(th[1]) : null,
    });
  }
  return pairs;
}

// ─────────────────────────────────────────────────────────────────────────────
// 실행 안전
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 작은따옴표 **밖**의 `$(`만 명령 치환으로 간주한다. awk 필드 참조 `$(NF-1)`은 대장 관례상
 * 항상 작은따옴표로 감싼 awk 스크립트 안에 있으므로(셸이 확장하지 않는다) 통과한다.
 * 큰따옴표는 셸이 그 안에서도 명령 치환을 수행하므로 예외로 두지 않는다.
 */
export function hasUnsafeSubstitution(cmd) {
  let inSingle = false;
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (c === "'") { inSingle = !inSingle; continue; }
    if (!inSingle && c === '$' && cmd[i + 1] === '(') return true;
  }
  return false;
}

/**
 * `|`를 파이프 연산자로 셀 때는 **작은따옴표·큰따옴표 둘 다** 존중해야 한다(`hasUnsafeSubstitution`과
 * 규칙이 다르다 — 명령 치환은 큰따옴표 안에서도 일어나지만, 파이프 연산자 해석은 두 따옴표 다 막는다).
 * 대장 확인 명령에 `grep -rc "supportTel\|youtubeUrl" ...`(정규식 alternation을 큰따옴표로 감싼 패턴)가
 * 실제로 다수 존재한다 — 이걸 무시하고 문자 그대로 `cmd.split('|')`을 쓰면 패턴 안의 `|`에서 명령이
 * 두 조각으로 쪼개져 **멀쩡한 명령이 화이트리스트 밖으로 오분류**된다(舊 버전이 실제로 밟던 결함).
 */
export function splitPipeSegments(cmd) {
  const segments = [];
  let current = '';
  let quote = null;
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (quote) {
      current += c;
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"') { quote = c; current += c; continue; }
    if (c === '|') { segments.push(current); current = ''; continue; }
    current += c;
  }
  segments.push(current);
  return segments;
}

/**
 * 대장 #191(2026-09-01) — `ALLOWED` 화이트리스트 바이너리 자체가 **읽기 전용이 아닌 하위 기능**을
 * 갖는 경우가 있다. #182 수리 과정의 게이트② 검증에서 실측으로 드러났다(전부 `isSafe`가 `true`를
 * 반환하던 것들):
 *   - `sed -i "s/a/b/" file` → 파일을 **실제로 변조**한다(in-place 편집)
 *   - `find . -delete`       → 파일을 **실제로 지운다**(그 외 `-exec`/`-execdir`/`-ok`/`-okdir`/
 *                              `-fprintf`류도 임의 실행·파일 쓰기라 동급으로 막는다)
 *   - `awk 'BEGIN{system("id")}'` → awk의 `system()` 내장함수로 **임의 명령을 실행**한다
 * 셋 다 바이너리 이름만으로는 걸러지지 않고, `DENY_CHAR_PATTERN`(문자열 전체를 훑는 방식)도
 * 못 잡는다 — 위험이 플래그(`-i`)·서브커맨드 토큰(`-delete`)·스크립트 안의 함수 호출(`system(`)
 * 형태로만 드러나기 때문이다. 아래 3개 검사는 바이너리별로 세그먼트를 재파싱해 그 형태를 잡는다.
 */

/** `sed`의 in-place 편집 플래그(`-i`·`-i.bak`·결합형 `-ni`·`--in-place[=SUFFIX]`)를 차단한다. */
function hasSedWriteFlag(seg) {
  const tokens = seg.trim().split(/\s+/);
  if (tokens[0] !== 'sed') return false;
  return tokens.slice(1).some((t) => {
    if (t === '--in-place' || t.startsWith('--in-place=')) return true;
    if (!t.startsWith('-') || t.startsWith('--')) return false;
    const flagChars = (t.slice(1).match(/^[a-zA-Z]*/) ?? [''])[0];
    return flagChars.includes('i');
  });
}

/** `find`의 파일 변조·삭제·임의 실행 액션(`-delete`·`-exec*`·`-ok*`·`-fprintf`류)을 차단한다. */
const FIND_WRITE_ACTIONS = new Set([
  '-delete', '-exec', '-execdir', '-ok', '-okdir', '-fprintf', '-fprint', '-fprint0', '-fls',
]);
function hasDangerousFindAction(seg) {
  const tokens = seg.trim().split(/\s+/);
  if (tokens[0] !== 'find') return false;
  return tokens.some((t) => FIND_WRITE_ACTIONS.has(t));
}

/** `awk` 스크립트 안의 `system(...)` 호출(임의 명령 실행)을 차단한다. */
function hasAwkSystemCall(seg) {
  const tokens = seg.trim().split(/\s+/);
  if (tokens[0] !== 'awk') return false;
  return /\bsystem\s*\(/.test(seg);
}

export function isSafe(cmd) {
  if (DENY_CHAR_PATTERN.test(cmd)) return false;
  if (hasUnsafeSubstitution(cmd)) return false;
  return splitPipeSegments(cmd).every((seg) => {
    const bin = seg.trim().split(/\s+/)[0];
    if (!ALLOWED.has(bin)) return false;
    if (hasSedWriteFlag(seg)) return false;
    if (hasDangerousFindAction(seg)) return false;
    if (hasAwkSystemCall(seg)) return false;
    return true;
  });
}

/** 재귀 grep(`-r`을 포함하는 어떤 플래그 묶음이든)에 node_modules·dist 제외를 강제한다. */
function injectGrepExcludes(segment) {
  const tokens = segment.trim().split(/\s+/);
  if (tokens[0] !== 'grep') return segment;
  let i = 1;
  const flags = [];
  while (i < tokens.length && tokens[i].startsWith('-')) { flags.push(tokens[i]); i++; }
  if (!flags.some((f) => /[rR]/.test(f))) return segment;
  return ['grep', ...flags, '--exclude-dir=node_modules', '--exclude-dir=dist', ...tokens.slice(i)].join(' ');
}

/** `find <paths...> <expr>`의 경로 인자 뒤에 node_modules·dist 가지치기를 강제한다. */
function injectFindExcludes(segment) {
  const tokens = segment.trim().split(/\s+/);
  if (tokens[0] !== 'find') return segment;
  let i = 1;
  while (i < tokens.length && !tokens[i].startsWith('-')) i++;
  const paths = tokens.slice(1, i);
  const expr = tokens.slice(i);
  return ['find', ...paths, '-not', '-path', "'*/node_modules/*'", '-not', '-path', "'*/dist/*'", ...expr].join(' ');
}

/** 실행 직전에만 적용 — 표시되는 명령 텍스트(대장 원문)는 건드리지 않는다. */
export function applyExecSafetyExclusions(cmd) {
  return splitPipeSegments(cmd).map((seg) => injectFindExcludes(injectGrepExcludes(seg))).join('|');
}

// ─────────────────────────────────────────────────────────────────────────────
// 값 정규화 (실행 결과 → 비교 가능한 문자열)
// ─────────────────────────────────────────────────────────────────────────────

/** 파이프 없는 단독 `grep -l`/`-rl*` — 값은 매치 파일 "개수"(줄 수)로 판정한다. */
export function isListFilesCommand(cmd) {
  if (cmd.includes('|')) return false;
  const tokens = cmd.trim().split(/\s+/);
  if (tokens[0] !== 'grep') return false;
  let i = 1;
  let hasL = false;
  while (i < tokens.length && tokens[i].startsWith('-')) {
    if (/l/.test(tokens[i])) hasL = true;
    i++;
  }
  return hasL;
}

/**
 * 실행 결과(rawOutput)를 기대값과 비교 가능한 문자열로 정규화한다. 순수 함수 —
 * 실제 셸 실행과 분리해 테스트할 수 있다.
 */
export function normalizeValue(cmd, pair, rawOutput) {
  const trimmed = (rawOutput ?? '').trim();

  if (isListFilesCommand(cmd)) {
    const count = trimmed ? trimmed.split('\n').filter(Boolean).length : 0;
    return { actual: String(count), note: '파일 목록 → 매치 파일 개수로 판정(-l/-rl)' };
  }

  const nonEmptyLines = trimmed ? trimmed.split('\n').filter(Boolean) : [];
  const perFile = nonEmptyLines.map((l) => l.match(/^.+:(\d+)$/));
  const isPerFileCount = perFile.length > 0 && perFile.every(Boolean);

  if (isPerFileCount && perFile.length > 1) {
    const values = perFile.map((mm) => Number(mm[1]));
    if (pair?.isEachFile) {
      const allEqual = values.every((v) => v === values[0]);
      return {
        actual: allEqual ? String(values[0]) : `각 다름(${values.join(',')})`,
        note: `${perFile.length}개 파일 · 각 파일 동일값 요구(각 N)`,
      };
    }
    const sum = values.reduce((s, v) => s + v, 0);
    return { actual: String(sum), note: `${perFile.length}개 파일 합계` };
  }

  // 빈 출력 = 0(문법 ⓔ) — 카운트 의미로 쓰이는 명령이 대부분이라 "(빈 출력)"으로 두면
  // "0"과 영원히 불일치로 오판정된다.
  if (!trimmed) return { actual: '0', note: '' };
  return { actual: nonEmptyLines[0] ?? trimmed.split('\n')[0], note: '' };
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────────────────────

export function evaluateRows(rows) {
  const result = { matched: [], mismatched: [], errored: [], manual: [] };

  for (const row of rows) {
    const pairs = extractPairs(row.verify);
    if (pairs.length === 0) {
      const reason = EXPLICIT_MANUAL_RE.test(row.verify)
        ? '명시적 수동(자연어/사용자 실행 — 문법 ⓗ)'
        : row.verify.trim() === '' || row.verify.trim() === '—'
          ? '확인 방법 칸 비어있음(—)'
          : '실행 가능한 명령 없음(백틱은 있으나 인식 접두사 아님)';
      result.manual.push({ ...row, reason });
      continue;
    }
    const hasReplacement = /교체[:：]/.test(row.verify);
    const judged = hasReplacement ? [pairs[pairs.length - 1]] : pairs;
    const superseded = hasReplacement ? pairs.length - 1 : 0;

    for (const pair of judged) {
      const { cmd, expected: pairExpected } = pair;
      if (!isSafe(cmd)) {
        result.manual.push({ ...row, cmd, reason: '화이트리스트 밖(셸 부작용 가능)' });
        continue;
      }
      let rawOutput;
      let failed = false;
      try {
        rawOutput = execSync(applyExecSafetyExclusions(cmd), {
          cwd: REPO,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch (e) {
        // grep은 미검출 시 exit 1 — 실패가 아니라 "0건"이다. status > 1이면 진짜 오류.
        rawOutput = e.stdout ?? '';
        failed = (rawOutput ?? '').trim() === '' && (e.status ?? 1) > 1;
      }
      const { actual, note: normNote } = normalizeValue(cmd, pair, rawOutput);
      const notes = [];
      if (normNote) notes.push(normNote);
      if (superseded > 0) notes.push(`舊 명령 ${superseded}건은 무효화됨 — 마지막 명령으로 판정`);
      if (pair.resolveThreshold != null) notes.push(`해소 판정 임계값 ≥${pair.resolveThreshold}(참고용, 자동판정 미사용)`);

      const entry = { num: row.num, cmd, expected: pairExpected, actual, note: notes.join(' · ') };
      if (failed) result.errored.push(entry);
      else if (pairExpected === null) result.manual.push({ ...row, cmd, reason: '기대값 미기재 — 값 해석 필요', actual });
      else if (actual.replace(/\s/g, '') === pairExpected) result.matched.push(entry);
      else result.mismatched.push(entry);
    }
  }
  return result;
}

function main() {
  const args = process.argv.slice(2);
  const ALL = args.includes('--all');
  const onlyIdx = args.indexOf('--only');
  const ONLY = onlyIdx >= 0 ? new Set(args[onlyIdx + 1].split(',').map((s) => s.trim())) : null;

  const content = readFileSync(LEDGER, 'utf8');
  const { rows: allRows, excludedTables } = parseLedgerRows(content);
  const rows = allRows.filter((r) => (ONLY ? ONLY.has(r.num) : ALL || isPendingStatus(r.status)));

  const result = evaluateRows(rows);

  const b = (s) => `\x1b[1m${s}\x1b[0m`;
  console.log(b(`\n대장 재현 — 대상 ${rows.length}행 (${ALL ? '전건' : ONLY ? '지정' : '대기분'}, 상태 칸 보유 표 전건 ${allRows.length}행 중)\n`));

  if (excludedTables.length) {
    console.log(b(`■ 판정 대상 제외 표 ${excludedTables.length}개(상태 칸 없음) — 합계 ${excludedTables.reduce((s, t) => s + t.rowCount, 0)}행`));
    for (const t of excludedTables) console.log(`  L${t.headerLine}: [${t.headers.join(' | ')}] (${t.rowCount}행)`);
    console.log('');
  }

  const badCells = checkTableIntegrity(content);
  console.log(b(`■ 표 무결성 ${badCells.length}행 — 헤더 칸 수와 실제 칸 수가 다르다(원인은 단정하지 않는다)`));
  for (const e of badCells) console.log(`  L${e.lineNumber} #${e.num}  실제 ${e.actual}칸 / 헤더 ${e.expected}칸(표 L${e.tableHeaderLine})`);
  console.log('');

  console.log(b(`■ 어긋남 ${result.mismatched.length}건 — 대장 기재값과 현재값이 다르다 (최우선 판정 대상)`));
  for (const e of result.mismatched) {
    console.log(`  #${e.num}  기재 ${e.expected} → 실측 ${e.actual}${e.note ? ` (${e.note})` : ''}`);
    console.log(`        ${e.cmd}`);
  }

  console.log(b(`\n■ 수동 판정 ${result.manual.length}건`));
  for (const e of result.manual) {
    console.log(`  #${e.num}  ${e.reason}${e.actual ? ` (실측: ${e.actual})` : ''}`);
  }

  console.log(b(`\n■ 실행 오류 ${result.errored.length}건 — 명령 자체가 성립하지 않는다 (대장 수정 대상)`));
  for (const e of result.errored) console.log(`  #${e.num}  ${e.cmd}`);

  console.log(b(`\n■ 일치 ${result.matched.length}건 — 등재 당시 값 그대로 (미해소 유력)`));
  console.log(`  ${result.matched.map((e) => `#${e.num}`).join(', ')}`);

  console.log(
    b(`\n요약: 일치 ${result.matched.length} · 어긋남 ${result.mismatched.length} · ` +
      `수동 ${result.manual.length} · 오류 ${result.errored.length} · 대상행 ${rows.length}\n`),
  );
  console.log('⚠️ 값 일치가 곧 미해소는 아니고, 어긋남이 곧 해소도 아니다 — 대장 #114는 명령이 검출했으나');
  console.log('   결함 자체가 없었다. 이 출력은 "어디를 사람이 봐야 하는가"의 목록이다.\n');
}

const isMainModule = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  main();
}
