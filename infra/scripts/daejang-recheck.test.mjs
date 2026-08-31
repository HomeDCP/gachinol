// infra/scripts/daejang-recheck.test.mjs
// 루트 `package.json`의 `test:scripts`가 `node --test infra/scripts/verify-deployed-sha.test.mjs`와
// `node --test infra/scripts/daejang-recheck.test.mjs`를 **개별 호출로 `&&` 연결**한다(글롭도, 한
// `--test` 호출에 여러 파일을 나열하는 것도 아니다).
//
// ⚠️ **"명시 나열이면 fail-closed"는 거짓이었다** — 2026-09-01 게이트② 검증에서 실측으로 반증됐다:
//   `node --test infra/scripts/daejang-recheck.test.mjs infra/scripts/does-not-exist.test.mjs`
//   → **exit 0**(있는 파일의 테스트만 조용히 돌고 없는 파일은 경고 0건으로 무시된다. 앞뒤 순서
//   바꿔도 동일 — 3회 재현). `node --test`는 인자가 **1개뿐일 때만** 없는 파일에서 즉시 죽는다
//   (`Could not find '...'`, exit 1) — 인자가 여러 개면 존재하는 파일만 골라 돌리고 나머지는
//   묵살한다. 舊 주석("명시 나열이면 MODULE_NOT_FOUND로 즉시 죽어 fail-closed")은 이 인자-개수
//   전제가 1일 때만 참이었는데, 파일이 2개로 늘며 그 전제가 깨진 채로 방치돼 있었다.
// → **지금 fail-closed의 실제 근거는 두 가지다**:
//   ① `test:scripts`가 파일마다 `node --test <파일 1개>`를 **개별 호출**하고 `&&`로 연결한다.
//      인자가 항상 1개이므로, 없는 파일이면 그 호출 자체가 `Could not find`로 exit 1 → 셸의
//      단락평가로 체인 전체가 실패한다. (한 `--test` 호출에 여러 인자를 나열하는 형태로
//      되돌리면 이 보장이 다시 깨진다 — 위 반증이 바로 그 형태였다.)
//   ② 아래 "test:scripts 등재 self-check"가 **반대 방향**(새 `*.test.mjs`를 만들고 `test:scripts`에
//      등재하는 걸 잊는 경우)을 잡는다. ①은 "등재된 파일이 사라지는 것"만 막을 뿐 이 반대 방향은
//      여전히 조용히 통과하기 때문에 ①만으로는 부족하다.
// → **테스트 파일을 추가/리네임할 때는 루트 `package.json`의 `test:scripts`도 함께 고쳐야 한다**
//   (잊어도 ②가 레드로 잡는다 — 자기 자신도 검사 대상에 포함된다).
//
// 이 스위트의 존재 이유(대장 #182): #182의 해소 판정이 "수동 판정 건수 감소"라는 **상대 지표
// 하나뿐**이다. 파서를 느슨하게 만들어도(예: 칸 이탈을 무시하거나, 기대값 정규식을 헐겁게 해
// 아무 숫자나 매칭시키거나) 그 지표는 똑같이 달성된다 — 그래서 아래 테스트 각각은 **파서가
// 느슨해지면 반드시 레드가 나도록** 설계했다(각 테스트 앞에 "무엇을 느슨화하면 이 테스트가
// 잡는가"를 주석으로 명시).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  splitCells,
  splitCellsRaw,
  parseTables,
  mapColumns,
  parseLedgerRows,
  checkTableIntegrity,
  extractPairs,
  normalizeCmdEscaping,
  isPendingStatus,
  hasUnsafeSubstitution,
  splitPipeSegments,
  isSafe,
  applyExecSafetyExclusions,
  isListFilesCommand,
  normalizeValue,
  evaluateRows,
  ALLOWED,
} from './daejang-recheck.mjs';

// ── 픽스처 ───────────────────────────────────────────────────────────────────

const NORMAL_TABLE = [
  '## 6-X. 정상 표',
  '',
  '| # | 발주처 | 수신처 | 확인 방법(grep) | 기한 | 상태 | 미수신 시 조치 |',
  '|---|---|---|---|---|---|---|',
  '| 1 | A | B | `grep -c "foo" bar.ts` → 등재 시 **0** | 즉시 | **미수신(등재)** | — |',
  '| 2 | C | D | `grep -c "baz" qux.ts` → **1** | — | **수신 완료** | — |',
].join('\n');

// D-형 비숫자 ID(§6-1 D-1~D-18 동형) — `^\| \d+ \|` 정규식으로는 영구 비가시였다.
const D_ID_TABLE = [
  '## 6-D. D-ID 표',
  '',
  '| # | 발주처 | 수신처 | 확인 방법(grep) | 기한 | 상태 | 미수신 시 조치 |',
  '|---|---|---|---|---|---|---|',
  '| D-1 | A | B | `grep -c "foo" bar.ts` → **1** | — | **수신 완료** | — |',
].join('\n');

// 칸 이탈 표 — #85 동형(수신처 칸이 통째로 없어 6칸)
const RAGGED_TABLE = [
  '## 6-Y. 칸 이탈 표',
  '',
  '| # | 발주처 | 수신처 | 확인 방법(grep) | 기한 | 상태 | 미수신 시 조치 |',
  '|---|---|---|---|---|---|---|',
  '| 1 | A | 단독 `grep -c "x" y.ts` → **0** | 기한값 | **미수신** | 비고 |',
].join('\n');

// 빈 줄 분절 표 — §6-11 동형(표 안에 진짜 빈 줄이 끼어 있어도 하나의 표여야 한다)
const BLANK_SPLIT_TABLE = [
  '## 6-Z. 빈 줄 분절 표',
  '',
  '| # | 발주처 | 수신처 | 확인 방법(grep) | 기한 | 상태 | 미수신 시 조치 |',
  '|---|---|---|---|---|---|---|',
  '| 1 | A | B | `grep -c "foo" bar.ts` → **0** | — | **미수신** | — |',
  '',
  '',
  '| 2 | C | D | `grep -c "baz" qux.ts` → **1** | — | **미수신** | — |',
].join('\n');

// 상태 칸 없는 표 — §6-5 동형(5칸, 상태 개념 자체가 없다)
const NO_STATUS_TABLE = [
  '## 6-W. 상태 없는 표',
  '',
  '| # | 원천(문서 §섹션 · 값 요약) | 인용처 목록(문서 §섹션) | 대조 방법(grep) | 갱신 규칙 |',
  '|---|---|---|---|---|',
  '| 1 | 원천값 | 인용처 | `grep -n "foo" bar.ts` | 값 변경 시 갱신 |',
].join('\n');

// 표기 혼재 표 — 문법 ⓐⓑⓒⓓ가 한 칸에 섞여 있다
const MIXED_NOTATION_ROW = [
  '`grep -c "a" a.ts` → **1**,',
  '`grep -c "b" b.ts` → 등재 시 **2**,',
  '`grep -c "c" c.ts` → 등재 시점 **3건**,',
  '`grep -c "d" d.ts d2.ts` → 각 **4**, 해소 후 ≥5',
].join(' ');

// 두 진짜 표 사이에 산문(경계)이 끼어 있을 때 — 절대 하나로 합쳐지면 안 된다
const TWO_REAL_TABLES = [
  '## 6-P. 첫 표',
  '',
  '| # | 발주처 | 수신처 | 확인 방법(grep) | 기한 | 상태 | 미수신 시 조치 |',
  '|---|---|---|---|---|---|---|',
  '| 1 | A | B | `grep -c "foo" bar.ts` → **0** | — | **미수신** | — |',
  '',
  '### 6-Q. 둘째 표',
  '',
  '| # | 발주처 | 수신처 | 대조 방법(grep) | 트리거 | 상태 | 트리거 도달 시 조치 |',
  '|---|---|---|---|---|---|---|',
  '| 1 | E | F | `grep -c "baz" qux.ts` → **0** | — | **미수신** | — |',
].join('\n');

// ── splitCells / parseTables ────────────────────────────────────────────────

test('splitCells: 이스케이프된 파이프를 칸 경계로 잘못 세지 않는다', () => {
  const line = '| 1 | 값 \\| 안의 파이프 | 다음 칸 |';
  assert.deepEqual(splitCells(line), ['1', '값 | 안의 파이프', '다음 칸']);
});

// ── splitCellsRaw — 대장 #192(파이프 이스케이프 실행 문자열 보존) ──────────────
// splitCells와 셀 **경계** 판정은 동일해야 하지만(이스케이프된 `\|`는 여전히 경계가 아니다),
// 셀 **내용**은 언이스케이프하지 않아야 한다 — grep BRE의 alternation 표기도 `\|`라서, 여기서
// 되돌리면 확인 방법 칸의 grep 명령이 셸에 실행될 때 alternation을 잃는다(#66 실측).
test('splitCellsRaw: 칸 경계는 splitCells와 동일하게 가르되(이스케이프된 파이프=비경계), 내용은 언이스케이프하지 않는다(대장 #192)', () => {
  const line = '| 1 | grep -c "a\\|b" file | 다음 칸 |';
  assert.deepEqual(splitCellsRaw(line), ['1', 'grep -c "a\\|b" file', '다음 칸'], '경계는 3칸으로 정확히 갈리되 백슬래시는 살아있어야 한다');
  // 대칭 확인: 같은 줄에서 splitCells(언이스케이프)는 계속 종전 동작을 유지해야 한다(다른 소비처가 의존).
  assert.deepEqual(splitCells(line), ['1', 'grep -c "a|b" file', '다음 칸']);
});

test('parseTables: 헤더+구분선으로 표를 식별하고 데이터 행을 귀속시킨다', () => {
  const tables = parseTables(NORMAL_TABLE);
  assert.equal(tables.length, 1);
  assert.deepEqual(tables[0].headers, ['#', '발주처', '수신처', '확인 방법(grep)', '기한', '상태', '미수신 시 조치']);
  assert.equal(tables[0].rows.length, 2);
});

// 느슨화 감시: `^\| \d+ \|`류 숫자 전용 정규식으로 되돌리면 D-1 행이 통째로 사라진다.
test('parseTables: 비숫자 ID(D-1)도 표 행으로 인식한다', () => {
  const tables = parseTables(D_ID_TABLE);
  assert.equal(tables[0].rows.length, 1);
  assert.equal(tables[0].rows[0].cells[0], 'D-1');
});

// 느슨화 감시: 빈 줄에서 `cur = null`로 되돌리면(舊 결함) 2번 행이 별도 미확인 조각으로 빠지거나
// 아예 사라진다 — 이 표는 반드시 "표 1개·행 2개"여야 한다.
test('parseTables: 표 내부의 빈 줄은 표를 쪼개지 않는다', () => {
  const tables = parseTables(BLANK_SPLIT_TABLE);
  assert.equal(tables.length, 1, '빈 줄로 표가 2개로 쪼개지면 안 된다');
  assert.equal(tables[0].rows.length, 2);
  assert.equal(tables[0].rows[1].cells[0], '2');
});

// 대칭 검증: 진짜 경계(산문·제목)가 끼면 반드시 별개 표로 남아야 한다 — "빈 줄만 무시"가
// "아무거나 이어붙인다"로 과잉 일반화되지 않았는지 확인.
test('parseTables: 산문·제목으로 갈린 두 표는 병합되지 않는다', () => {
  const tables = parseTables(TWO_REAL_TABLES);
  assert.equal(tables.length, 2);
  assert.equal(tables[0].rows.length, 1);
  assert.equal(tables[1].rows.length, 1);
  assert.equal(tables[1].headers[3], '대조 방법(grep)');
});

// ── mapColumns / parseLedgerRows ────────────────────────────────────────────

test('mapColumns: "확인 방법"·"대조 방법" 두 표기를 동일하게 확인 방법 칸으로 판정한다', () => {
  const a = mapColumns(['#', '발주처', '수신처', '확인 방법(grep)', '기한', '상태', '미수신 시 조치']);
  const b = mapColumns(['#', '발주처', '수신처', '대조 방법(grep)', '트리거', '상태', '트리거 도달 시 조치']);
  assert.equal(a.verifyIdx, 3);
  assert.equal(b.verifyIdx, 3);
  assert.equal(b.dueIdx, 4); // "트리거"도 기한 칸으로 판정
});

// 느슨화 감시: 상태 칸 유무를 무시하고 무조건 "뒤에서 두 번째 칸=상태"로 되돌리면 이 표의
// "갱신 규칙" 칸이 상태로 오판정된다.
test('mapColumns: 상태 칸이 없는 표는 hasStatus=false다', () => {
  const cols = mapColumns(['#', '원천', '인용처 목록', '대조 방법(grep)', '갱신 규칙']);
  assert.equal(cols.hasStatus, false);
  assert.equal(cols.statusIdx, -1);
});

test('parseLedgerRows: 상태 없는 표는 rows에서 제외되고 excludedTables로 별도 집계된다', () => {
  const { rows, excludedTables } = parseLedgerRows(`## 6. 발주\n\n${NO_STATUS_TABLE}`);
  assert.equal(rows.length, 0);
  assert.equal(excludedTables.length, 1);
  assert.equal(excludedTables[0].rowCount, 1);
});

test('parseLedgerRows: "## 6." 이전 표는 대장 범위 밖이라 제외된다', () => {
  const doc = `## 1. 앞 절\n\n${NORMAL_TABLE.replace('## 6-X. 정상 표', '### 1-1. 무관한 표')}\n\n## 6. 발주\n\n${D_ID_TABLE}`;
  const { rows } = parseLedgerRows(doc);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].num, 'D-1');
});

// ── checkTableIntegrity — #85 동형 칸 이탈 감지 ─────────────────────────────

// 느슨화 감시: 데이터 행들의 최빈 칸수(mode)로 판정하는 舊 방식으로 되돌리면, 이탈 행이 다수가
// 되는 순간(§6-11 조각 2처럼) 오히려 "정상" 쪽이 소수로 몰려 뒤집힐 수 있다. 헤더 칸수 기준은
// 그런 역전에 흔들리지 않는다.
test('checkTableIntegrity: 헤더보다 칸이 적은 행(#85 동형)을 정확히 잡는다', () => {
  const bad = checkTableIntegrity(RAGGED_TABLE);
  assert.equal(bad.length, 1);
  assert.equal(bad[0].expected, 7);
  assert.equal(bad[0].actual, 6);
});

test('checkTableIntegrity: 정상 표는 0건이다', () => {
  assert.equal(checkTableIntegrity(NORMAL_TABLE).length, 0);
});

// ── extractPairs — 기대값 문법 ⓐⓑⓒⓓ ─────────────────────────────────────

test('extractPairs: 문법 ⓐ(bare → **N**)를 인식한다', () => {
  const [p] = extractPairs('`grep -c "a" a.ts` → **1**');
  assert.equal(p.expected, '1');
  assert.equal(p.isEachFile, false);
});

test('extractPairs: 문법 ⓑ(등재 시 **N**)를 인식한다', () => {
  const [p] = extractPairs('`grep -c "a" a.ts` → 등재 시 **0**(실측)');
  assert.equal(p.expected, '0');
});

test('extractPairs: 문법 ⓒ(등재 시점 **N건**·각 **N**)를 인식한다', () => {
  const [p1] = extractPairs('`grep -c "a" a.ts` → 등재 시점 **0건**');
  assert.equal(p1.expected, '0');
  const [p2] = extractPairs('`grep -c "a" a.ts b.ts` → 각 **2**');
  assert.equal(p2.expected, '2');
  assert.equal(p2.isEachFile, true);
});

test('extractPairs: 문법 ⓓ(해소 후 ≥N)는 참고용 임계값으로만 붙는다(기대값 아님)', () => {
  const [p] = extractPairs('`grep -c "a" a.ts` → 등재 시 **0**, 해소 후 ≥1');
  assert.equal(p.expected, '0');
  assert.equal(p.resolveThreshold, 1);
});

test('extractPairs: 한 칸에 섞인 4가지 표기를 전부 판정한다(표기 혼재)', () => {
  const pairs = extractPairs(MIXED_NOTATION_ROW);
  assert.equal(pairs.length, 4);
  assert.deepEqual(pairs.map((p) => p.expected), ['1', '2', '3', '4']);
  assert.equal(pairs[3].isEachFile, true);
});

// "교체:" 표지가 있어도 extractPairs 자신은 **둘 다** 뽑는다(이력 보존) — "마지막만 판정"은
// evaluateRows의 몫이다. 그래서 이 테스트는 evaluateRows로 확인한다(#131·#134·#137 동형).
test('evaluateRows: "교체:" 표지가 있으면 舊 명령은 실행하지 않고 마지막 명령만 판정한다', () => {
  const text = '`wc -l /no/such/path/at/all` → **9** 교체: `grep -c "nope" /dev/null` → **0**';
  const pairs = extractPairs(text);
  assert.equal(pairs.length, 2, '추출 자체는 이력 보존을 위해 둘 다 반환해야 한다');

  const rows = [{ num: '1', verify: text, status: '**미수신**' }];
  const result = evaluateRows(rows);
  const total = result.matched.length + result.mismatched.length + result.manual.length + result.errored.length;
  assert.equal(total, 1, '舊 명령이 함께 판정되면 안 된다(병렬 2건이면 total=2)');
  assert.equal(result.matched.length, 1);
  assert.match(result.matched[0].cmd, /"nope"/);
});

test('extractPairs: 표지가 없으면 병렬 판정(둘 다 반환)한다(#88 동형)', () => {
  const text = '`grep -c "a" a.ts` → **1** / `grep -c "b" b.ts` → **2**';
  const pairs = extractPairs(text);
  assert.equal(pairs.length, 2);
});

test('extractPairs: 인식 접두사가 아닌 명령(pnpm 등)은 뽑지 않는다', () => {
  assert.equal(extractPairs('`pnpm test` → **1**').length, 0);
});

// ── extractPairs / normalizeCmdEscaping — 파이프 이스케이프 결함 수리(대장 #192) ────
// 舊 코드는 verifyText 전체에 `.replace(/\\\|/g, '|')`를 걸어 **모든** `\|`를 언이스케이프했다.
// 이 절은 grep 모드(BRE/ERE)·따옴표 안팎에 따라 `\|`의 의미가 갈리는 3계열을 각각 검사한다.
// 영향 범위: #62·#66·#71·#79·#127(BRE, 이 슬라이스에서 수리) / #191(ERE, 건드리지 않음, 회귀 방지).

test('extractPairs: BRE grep(기본, -E 없음) 안의 `\\|`(alternation)는 원문 보존한다(대장 #192, #66 동형)', () => {
  const verify = '`grep -c "a\\|b" file.ts` → **1**';
  const [p] = extractPairs(verify);
  assert.equal(p.cmd, 'grep -c "a\\|b" file.ts', 'BRE는 백슬래시가 없으면 alternation을 잃는다');
});

// ⚠️ `egrep`은 여기 넣지 않는다 — `CMD_PREFIX_RE`(기대값 문법, 이 슬라이스 수정 금지 대상)가
// "grep"으로 **시작**하는 명령만 인식해 "egrep"은 애초에 extractPairs를 통과하지 못한다
// (대장 실사용 명령도 전부 `grep -E`류이지 `egrep` 자체는 없다). `egrep` 판정은 아래
// `normalizeCmdEscaping` 직접 단위 테스트로 확인한다(그 함수는 CMD_PREFIX_RE 게이트 밖).
test('extractPairs: ERE grep(-E류) 안의 `\\|`는 bare `|`로 되돌린다(대장 #192, #191 동형)', () => {
  const [pEc] = extractPairs('`grep -Ec "a\\|b" file.ts` → **1**');
  assert.equal(pEc.cmd, 'grep -Ec "a|b" file.ts');
  const [pE] = extractPairs('`grep -rE "a\\|b" dir` → **1**');
  assert.equal(pE.cmd, 'grep -rE "a|b" dir');
});

// 대칭 검증: ERE 칸에 대장이 이미 bare `|`로 적어뒀다면(이스케이프할 필요가 없다고 판단한 경우) 손대지 않아야 한다.
test('extractPairs: ERE grep에 이미 bare `|`가 있으면 그대로 통과한다(대장 #192, #191 오탐 방지)', () => {
  const [p] = extractPairs('`grep -Ec "a|b" file.ts` → **1**');
  assert.equal(p.cmd, 'grep -Ec "a|b" file.ts');
});

test('extractPairs: 따옴표 밖의 `\\|`(명령 사이 셸 파이프)는 grep 모드와 무관하게 항상 복원한다(대장 #192, #88 동형)', () => {
  const [p] = extractPairs('`find . -type f \\| wc -l` → **1**');
  assert.equal(p.cmd, 'find . -type f | wc -l', '이스케이프된 셸 파이프를 복원하지 않으면 find가 리터럴 `|`를 인자로 받아 깨진다');
});

test('normalizeCmdEscaping: BRE 보존·ERE 언이스케이프·셸 파이프 복원 3계열을 한 함수로 확인(대장 #192)', () => {
  assert.equal(normalizeCmdEscaping('grep -c "a\\|b" file.ts'), 'grep -c "a\\|b" file.ts');
  assert.equal(normalizeCmdEscaping('grep -Ec "a\\|b" file.ts'), 'grep -Ec "a|b" file.ts');
  assert.equal(normalizeCmdEscaping('egrep "a\\|b" file.ts'), 'egrep "a|b" file.ts', 'egrep은 CMD_PREFIX_RE 게이트 밖이라 여기서 직접 확인한다');
  assert.equal(normalizeCmdEscaping('find . -type f \\| wc -l'), 'find . -type f | wc -l');
});

test('parseLedgerRows: verify 칸은 rawCells(파이프 이스케이프 원문 보존)를 쓴다(대장 #192)', () => {
  const table = [
    '## 6-R. 파이프 보존 표',
    '',
    '| # | 발주처 | 수신처 | 확인 방법(grep) | 기한 | 상태 | 미수신 시 조치 |',
    '|---|---|---|---|---|---|---|',
    '| 1 | A | B | `grep -c "a\\|b" file.ts` → **1** | — | **미수신** | — |',
  ].join('\n');
  const { rows } = parseLedgerRows(`## 6. 발주\n\n${table}`);
  assert.ok(rows[0].verify.includes('a\\|b'), 'verify 칸은 splitCellsRaw로 원문(백슬래시 보존)을 써야 한다');
});

// ── 느슨화 감시: evaluateRows 실 실행으로 3계열 각각 레드/그린을 검증(대장 #192) ────
// 아래 3건은 **실제 grep/find를 실행**한다 — 언이스케이프 정책을 어느 방향으로든 잘못 되돌리면
// (① 전부 언이스케이프 ② 전부 보존 ③ 따옴표 밖 셸 파이프까지 보존) 반드시 레드가 나도록 설계했다.

test('evaluateRows: BRE alternation이 실 파일에서 정확히 매치한다(대장 #192, #66 동형 — 언이스케이프하면 이 테스트가 레드가 된다)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'daejang-recheck-'));
  try {
    const f = join(dir, 'a.txt');
    writeFileSync(f, 'apple\ncherry\ngrape\n', 'utf8');
    // "apple\|cherry" alternation = 2줄(apple·cherry) 매치. 언이스케이프해 리터럴
    // "apple|cherry"가 되면 이 파일 어디에도 없는 문자열이라 매치 0 → 레드.
    const rows = [{ num: '192a', verify: `\`grep -c "apple\\|cherry" ${f}\` → **2**`, status: '**미수신**' }];
    const result = evaluateRows(rows);
    assert.equal(result.matched.length, 1, JSON.stringify(result));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('evaluateRows: ERE grep은 언이스케이프해야 alternation이 산다(대장 #192, #191 동형 — 원문을 보존하면 이 테스트가 레드가 된다)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'daejang-recheck-'));
  try {
    const f = join(dir, 'a.txt');
    writeFileSync(f, 'apple\ncherry\ngrape\n', 'utf8');
    const rows = [{ num: '192b', verify: `\`grep -Ec "apple\\|cherry" ${f}\` → **2**`, status: '**미수신**' }];
    const result = evaluateRows(rows);
    assert.equal(result.matched.length, 1, JSON.stringify(result));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('evaluateRows: 따옴표 밖 셸 파이프가 대장 이스케이프를 거쳐도 실제로 동작한다(대장 #192, #88 동형 — 항상 원문 보존하면 이 테스트가 레드가 된다)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'daejang-recheck-'));
  try {
    writeFileSync(join(dir, 'a.ts'), 'x', 'utf8');
    writeFileSync(join(dir, 'b.ts'), 'y', 'utf8');
    const rows = [{ num: '192c', verify: `\`find ${dir} -type f \\| wc -l\` → **2**`, status: '**미수신**' }];
    const result = evaluateRows(rows);
    assert.equal(result.matched.length, 1, JSON.stringify(result));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── isPendingStatus — D-5 동형 오탐 방지 ────────────────────────────────────

// 느슨화 감시: `.includes(PENDING)`로 되돌리면 이 테스트가 즉시 레드가 된다(D-5 실사례).
test('isPendingStatus: 상태 칸이 "미수신"으로 시작해야 대기로 본다', () => {
  assert.equal(isPendingStatus('**미수신(2026-08-15 등재)**'), true);
});

test('isPendingStatus: 이력 서술 괄호 안의 "미수신"은 대기로 보지 않는다(D-5 실사례)', () => {
  const status = '**수신 완료**(舊 "미수신" 오기재를 07 §6이 자체 정정)';
  assert.equal(isPendingStatus(status), false);
});

// ── isSafe / hasUnsafeSubstitution / splitPipeSegments ──────────────────────

// 느슨화 감시: `DENY_PATTERN`에 `\$\(`를 위치 무관하게 되돌리면 이 테스트가 레드가 된다
// (대장 #182가 지적한 바로 그 오탐).
test('isSafe: 작은따옴표 안의 awk 필드 참조 $(NF-1)은 안전하다', () => {
  assert.equal(isSafe("awk -F'|' '{print $(NF-1)}' file.txt"), true);
});

// 대칭 검증: 진짜 명령 치환은 여전히 차단해야 한다 — 위 테스트가 통과하려고 검사 자체를
// 없애버리는 과잉 완화를 잡는다.
test('isSafe: 따옴표 밖의 진짜 명령 치환은 차단한다', () => {
  assert.equal(isSafe('grep -c foo $(bar)'), false);
  assert.equal(hasUnsafeSubstitution('grep -c foo $(bar)'), true);
});

test('isSafe: 세미콜론·rm 등 셸 부작용 문자열은 차단한다', () => {
  assert.equal(isSafe('grep -c foo bar.ts; rm -rf /'), false);
});

test('isSafe: 화이트리스트 밖 바이너리(pnpm)는 차단한다', () => {
  assert.equal(isSafe('pnpm test'), false);
});

// 느슨화 감시: `cmd.split('|')`로 되돌리면 이 테스트가 레드가 된다 — 대장에 실재하는
// `grep -rc "supportTel\|youtubeUrl" ...` 형태의 큰따옴표 안 파이프가 오분류된다.
test('isSafe: 큰따옴표 안의 파이프(정규식 alternation)는 파이프 연산자로 안 센다', () => {
  assert.equal(isSafe('grep -rc "supportTel|youtubeUrl" packages/shared/src'), true);
  assert.deepEqual(splitPipeSegments('grep -rc "supportTel|youtubeUrl" packages/shared/src').length, 1);
});

test('splitPipeSegments: 따옴표 밖의 파이프는 정상적으로 명령을 분리한다', () => {
  const segs = splitPipeSegments('grep -rl "x" dir | wc -l');
  assert.equal(segs.length, 2);
});

// ── applyExecSafetyExclusions — node_modules·dist 제외(#103·#173) ──────────

test('applyExecSafetyExclusions: 재귀 grep에 node_modules·dist 제외를 강제한다', () => {
  const out = applyExecSafetyExclusions('grep -rl "GIT_SHA" services/api/Dockerfile infra/docker');
  assert.match(out, /--exclude-dir=node_modules/);
  assert.match(out, /--exclude-dir=dist/);
});

test('applyExecSafetyExclusions: 비재귀 grep은 건드리지 않는다', () => {
  const out = applyExecSafetyExclusions('grep -c "foo" bar.ts');
  assert.equal(out, 'grep -c "foo" bar.ts');
});

test('applyExecSafetyExclusions: find에도 node_modules·dist 가지치기를 강제한다', () => {
  const out = applyExecSafetyExclusions('find services/api/src -type f');
  assert.match(out, /-not -path '\*\/node_modules\/\*'/);
  assert.match(out, /-not -path '\*\/dist\/\*'/);
});

// ── isListFilesCommand / normalizeValue ──────────────────────────────────────

test('isListFilesCommand: 파이프 없는 단독 grep -rl은 목록 판정 대상이다', () => {
  assert.equal(isListFilesCommand('grep -rl "x" dir'), true);
  assert.equal(isListFilesCommand('grep -c "x" dir'), false);
  assert.equal(isListFilesCommand('grep -rl "x" dir | wc -l'), false); // 파이프 있으면 그대로 둔다
});

// 느슨화 감시: -l/-rl 특수 판정을 빼면 첫 줄(파일 경로 문자열)이 그대로 "값"이 되어
// 어떤 숫자 기대값과도 영원히 불일치가 난다.
test('normalizeValue: -rl 출력은 매치된 파일 "개수"로 정규화한다', () => {
  const r = normalizeValue('grep -rl "x" dir', {}, 'a/b.ts\nc/d.ts\n');
  assert.equal(r.actual, '2');
});

test('normalizeValue: 빈 출력은 0으로 정규화한다(문법 ⓔ)', () => {
  const r = normalizeValue('grep -c "x" a.ts', {}, '');
  assert.equal(r.actual, '0');
});

// 느슨화 감시: 다중 파일 "각" 판정을 빼고 항상 합산하면 #161류("각 2")가 합계(4)로 오판정된다.
test('normalizeValue: isEachFile=true면 다중 파일 값이 전부 같을 때만 그 값으로 판정한다', () => {
  const equal = normalizeValue('grep -c "x" a.ts b.ts', { isEachFile: true }, 'a.ts:2\nb.ts:2\n');
  assert.equal(equal.actual, '2');
  const unequal = normalizeValue('grep -c "x" a.ts b.ts', { isEachFile: true }, 'a.ts:2\nb.ts:3\n');
  assert.notEqual(unequal.actual, '2');
  assert.notEqual(unequal.actual, '3');
});

test('normalizeValue: isEachFile이 없으면(기본) 다중 파일 값을 합산한다', () => {
  const r = normalizeValue('grep -c "x" a.ts b.ts', {}, 'a.ts:2\nb.ts:3\n');
  assert.equal(r.actual, '5');
});

// ── evaluateRows — 통합(파일시스템 의존 없이 결정적인 명령만 사용) ─────────

test('evaluateRows: 화이트리스트 밖 명령은 수동 판정으로 빠지고 실행되지 않는다', () => {
  const rows = [{ num: '1', verify: '`pnpm test` → **1**', status: '**미수신**' }];
  const result = evaluateRows(rows);
  assert.equal(result.manual.length, 1);
  assert.equal(result.matched.length, 0);
});

// `grep -c "패턴" /dev/null`을 쓴다(`wc -l /dev/null` 아님) — 단일 파일 `wc -l`은 macOS/GNU 공용
// 관례상 "N 파일명"을 출력해(예: "0 /dev/null") 이 자체가 별도의 정규화 대상이다. 대장 실제 관례는
// `wc`를 항상 파이프 뒤(`| wc -l`, 필명 없음)에서만 쓴다 — 이 테스트는 그 관례를 따른다.
test('evaluateRows: 안전한 결정적 커맨드로 일치 판정을 실증한다', () => {
  const rows = [{ num: '1', verify: '`grep -c "존재하지-않는-토큰-xyz" /dev/null` → **0**', status: '**미수신**' }];
  const result = evaluateRows(rows);
  assert.equal(result.matched.length, 1);
  assert.equal(result.mismatched.length, 0);
});

test('evaluateRows: 기대값과 실측이 다르면 어긋남으로 분류한다', () => {
  const rows = [{ num: '1', verify: '`grep -c "존재하지-않는-토큰-xyz" /dev/null` → **5**', status: '**미수신**' }];
  const result = evaluateRows(rows);
  assert.equal(result.mismatched.length, 1);
  assert.equal(result.mismatched[0].actual, '0');
});

test('evaluateRows: 확인 방법 칸이 "—"면 수동 판정("확인 방법 칸 비어있음")으로 분류한다(#159 동형)', () => {
  const rows = [{ num: '159', verify: '—', status: '**미수신**' }];
  const result = evaluateRows(rows);
  assert.equal(result.manual.length, 1);
  assert.match(result.manual[0].reason, /비어있음/);
});

// ── 임시 파일 기반 통합 테스트 — 실 저장소 상태에 의존하지 않는다 ───────────

test('evaluateRows: 다중 파일 "각 N" 문법이 실제 파일에서도 합산되지 않는다(#161 동형)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'daejang-recheck-'));
  try {
    const f1 = join(dir, 'a.txt');
    const f2 = join(dir, 'b.txt');
    writeFileSync(f1, 'x\nx\n', 'utf8'); // "x" 2회
    writeFileSync(f2, 'x\nx\n', 'utf8'); // "x" 2회
    const rows = [{ num: '161', verify: `\`grep -c "x" ${f1} ${f2}\` → 각 **2**`, status: '**해소**' }];
    const result = evaluateRows(rows);
    assert.equal(result.matched.length, 1, JSON.stringify(result));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('evaluateRows: node_modules 하위 매치는 재귀 grep 실행 시 제외된다(#103 동형)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'daejang-recheck-'));
  try {
    mkdirSync(join(dir, 'node_modules'), { recursive: true });
    writeFileSync(join(dir, 'node_modules', 'noise.ts'), 'TARGET_TOKEN\n', 'utf8');
    writeFileSync(join(dir, 'real.ts'), 'TARGET_TOKEN\n', 'utf8');
    const rows = [{ num: '103', verify: `\`grep -rl "TARGET_TOKEN" ${dir}\` → **1**`, status: '**미수신**' }];
    const result = evaluateRows(rows);
    assert.equal(result.matched.length, 1, JSON.stringify(result));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── ALLOWED 화이트리스트 자체 회귀 방지 ──────────────────────────────────────

test('ALLOWED: 읽기 전용 바이너리만 포함한다(쓰기·네트워크 계열 부재)', () => {
  for (const dangerous of ['rm', 'mv', 'cp', 'curl', 'docker', 'git', 'node', 'pnpm']) {
    assert.equal(ALLOWED.has(dangerous), false, `${dangerous}가 화이트리스트에 있으면 안 된다`);
  }
});

// ── isSafe — 실행 안전 구멍 3종 (대장 #191) ─────────────────────────────────
// #182 수리의 게이트② 검증에서 발견: `ALLOWED`에 있는 바이너리라도 특정 플래그/함수 호출로
// 파일 변조·삭제·임의 명령 실행이 가능한데 기존 검사(바이너리 이름 + `DENY_CHAR_PATTERN`)로는
// 안 잡혔다. 아래는 그 3종이 차단되는지 + **정상 명령이 과차단되지 않는지** 양방향으로 확인한다.

test('isSafe: sed -i(in-place 편집=파일 변조)를 차단한다(#191)', () => {
  assert.equal(isSafe('sed -i "s/a/b/" file'), false);
  assert.equal(isSafe("sed -i.bak 's/a/b/' file"), false, '-i.bak 결합형도 차단해야 한다');
  assert.equal(isSafe("sed --in-place 's/a/b/' file"), false, '롱옵션도 차단해야 한다');
});

test('isSafe: sed는 -i가 없으면(표준출력만) 안전하다(과차단 방지, #191)', () => {
  assert.equal(isSafe("sed -n '1,40p' file.md"), true);
  assert.equal(isSafe("sed -e 's/a/b/' file.md"), true);
});

test('isSafe: find -delete(파일 삭제)를 차단한다(#191)', () => {
  assert.equal(isSafe('find . -delete'), false);
  assert.equal(isSafe('find . -name "*.tmp" -exec rm {} \\;'), false, '-exec도 임의 실행이라 차단');
});

test('isSafe: find는 삭제·실행 액션이 없으면 안전하다(과차단 방지, #191)', () => {
  assert.equal(isSafe('find services/api/src -type f'), true);
  assert.equal(isSafe('find . -name "*.tmp"'), true);
});

test('isSafe: awk의 system() 호출(임의 명령 실행)을 차단한다(#191)', () => {
  assert.equal(isSafe('awk \'BEGIN{system("id")}\''), false);
});

test('isSafe: awk는 system() 호출이 없으면 안전하다(과차단 방지 — $(NF-1) 필드 참조 동형, #191)', () => {
  assert.equal(isSafe("awk -F'|' '{print $(NF-1)}' file.txt"), true);
  assert.equal(isSafe("awk -F' | ' '{print $(NF-1)}' file.txt"), true);
});

// ── test:scripts 등재 self-check (대장 #191 — 계약-구동 게이트 사상 동형) ───
// 위 fail-closed 근거 ①(`&&` 개별 호출)은 "등재된 파일이 사라지는 것"만 막는다. 이 테스트는
// **반대 방향**(`infra/scripts/`에 새 `*.test.mjs`를 만들고 `test:scripts`에 등재하는 걸 잊는
// 경우)을 잡는다. ⚠️ 이 테스트 자신도 `infra/scripts/*.test.mjs` 스캔 대상에 포함된다(스캔에서
// 자기 파일명을 하드코딩으로 제외하지 않는다 — 자기충족 회피, 규율 6).
test('test:scripts: infra/scripts/*.test.mjs 전부가 루트 package.json에 등재돼 있다', () => {
  const scriptsDir = fileURLToPath(new URL('.', import.meta.url));
  const testFiles = readdirSync(scriptsDir)
    .filter((f) => f.endsWith('.test.mjs'))
    .sort();
  assert.ok(testFiles.length > 0, '스캔 대상 자체가 0건이면 이 테스트가 무의미해진다');
  assert.ok(
    testFiles.includes('daejang-recheck.test.mjs'),
    '이 테스트 파일 자신이 스캔 대상에서 빠지면 안 된다(자기충족 회피)',
  );

  const pkgPath = fileURLToPath(new URL('../../package.json', import.meta.url));
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  const scriptStr = pkg.scripts?.['test:scripts'] ?? '';

  const missing = testFiles.filter((f) => !scriptStr.includes(`infra/scripts/${f}`));
  assert.deepEqual(missing, [], `package.json test:scripts에 누락된 파일: ${missing.join(', ')}`);
});
