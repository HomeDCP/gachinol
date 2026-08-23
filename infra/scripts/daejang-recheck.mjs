#!/usr/bin/env node
/**
 * 대장(PIVOT-PLAN §6-11) 대기 항목 재현 명령 일괄 실행 — 읽기 전용.
 *
 * 왜 스크립트로 남기는가: #159(2026-08-22)가 같은 일을 했지만 **스크립트를 커밋하지 않아**
 * 매번 처음부터 다시 만들어야 했고, 그것이 "수동 판정 미완"이 쌓인 원인 중 하나다.
 * 이 파일이 있으면 다음 세션은 `node infra/scripts/daejang-recheck.mjs` 한 번으로 전건 대조한다.
 *
 * 안전: 화이트리스트에 있는 읽기 전용 커맨드만 실행한다. 리다이렉션·쓰기·네트워크는 거부한다.
 * 거부된 명령은 실패가 아니라 **수동 판정 대상**으로 분류해 출력한다(조용히 건너뛰지 않는다).
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

// 대기 상태 문자열은 소스에 직접 쓰지 않는다 — 이 파일 자신이 대장 grep에 걸리는 것을 막기 위해서가
// 아니라(여긴 대장이 아니다), #159 ②가 보인 것처럼 **카운트 대상 문자열을 본문에 쓰면 오카운트**가
// 반복되기 때문이다. 같은 규율을 도구에도 적용한다.
const PENDING = ['미', '수', '신'].join('');

/** 읽기 전용 화이트리스트. 여기 없는 실행 파일이 하나라도 섞이면 그 명령은 수동 분류한다. */
const ALLOWED = new Set([
  'grep', 'awk', 'sed', 'wc', 'ls', 'find', 'test', 'cat', 'head', 'tail',
  'sort', 'uniq', 'cut', 'tr', 'echo', 'basename', 'dirname', 'true', 'printf',
]);
/** 이게 하나라도 있으면 셸 부작용 가능 → 수동 분류 */
const DENY_PATTERN = /[>;&]|\$\(|`|\brm\b|\bmv\b|\bcp\b|\bchmod\b|\bcurl\b|\bdocker\b|\bgit\b|\bnode\b|\bpnpm\b/;

const args = process.argv.slice(2);
const ALL = args.includes('--all');
const onlyIdx = args.indexOf('--only');
const ONLY = onlyIdx >= 0 ? new Set(args[onlyIdx + 1].split(',').map((s) => s.trim())) : null;

/** 대장 행 → {num, verify, status} — 7칸 행만 '확인 방법' 칸을 가진다(4칸 행은 요약형) */
function parseLedger() {
  const out = [];
  for (const line of readFileSync(LEDGER, 'utf8').split('\n')) {
    if (!/^\| \d+ \|/.test(line)) continue;
    const f = line.split(' | ');
    if (f.length < 3) continue;
    const num = f[0].replace(/\D/g, '');
    const status = f[f.length - 2];
    const verify = f.length >= 7 ? f[3] : '';
    out.push({ num, status, verify, cells: f.length });
  }
  return out;
}

/**
 * 확인 방법 칸에서 (명령, 기대값) 쌍을 뽑는다. 대장은 파이프를 `\|`로 이스케이프한다 → 되돌린다.
 *
 * ★ 한 칸에 명령이 여럿일 수 있다 — 재현 명령이 틀린 것으로 판명되면 **舊 명령을 지우지 않고**
 *   "교체:" 뒤에 새 명령을 병기하는 것이 이 대장의 관례이기 때문이다(이력 보존).
 *   그래서 **마지막 쌍이 현행 판정 기준**이다. 첫 번째를 쓰면 이미 무효화된 명령으로 매번
 *   "어긋남"이 뜬다(실제로 #131·#134·#137에서 밟았다).
 *   각 명령의 기대값은 **그 명령 뒤에 처음 나오는** `→ **N**`으로 짝짓는다.
 */
function extractPairs(verify) {
  const src = verify.replace(/\\\|/g, '|');
  const pairs = [];
  const re = /`([^`]+)`/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const cmd = m[1].trim();
    if (!/^(grep|awk|sed|ls |find |wc |cat |test )/.test(cmd)) continue;
    const rest = src.slice(re.lastIndex);
    // 다음 명령 전까지의 구간에서만 기대값을 찾는다(뒤 명령의 기대값을 훔쳐오지 않도록)
    const until = rest.search(/`(grep|awk|sed|ls |find |wc |cat |test )/);
    const window = until >= 0 ? rest.slice(0, until) : rest;
    const em = window.match(/→\s*\*\*(\d+)\*\*/);
    pairs.push({ cmd, expected: em ? em[1] : null });
  }
  return pairs;
}

function isSafe(cmd) {
  if (DENY_PATTERN.test(cmd)) return false;
  return cmd.split('|').every((seg) => {
    const bin = seg.trim().split(/\s+/)[0];
    return ALLOWED.has(bin);
  });
}

const rows = parseLedger().filter((r) => {
  if (ONLY) return ONLY.has(r.num);
  return ALL || r.status.includes(PENDING);
});

const result = { matched: [], mismatched: [], errored: [], manual: [] };

for (const row of rows) {
  const pairs = extractPairs(row.verify);
  if (pairs.length === 0) {
    result.manual.push({ ...row, reason: row.cells < 7 ? '요약형 행(확인 방법 칸 없음)' : '실행 가능한 명령 없음' });
    continue;
  }
  // ★ "교체:"가 명시된 칸만 마지막 쌍이 현행이고 앞은 무효화된 이력이다.
  //   표지가 없으면 명령들은 **병렬**(둘 다 유효)이므로 전부 판정해야 한다 — 마지막만 보면
  //   앞 명령의 어긋남이 가려진다(#88이 그 형태: `A → 12 / B → 12`로 두 지표를 나란히 잰다).
  const hasReplacement = /교체[:：]/.test(row.verify);
  const judged = hasReplacement ? [pairs[pairs.length - 1]] : pairs;
  const superseded = hasReplacement ? pairs.length - 1 : 0;
  for (const { cmd, expected: pairExpected } of judged) {
    if (!isSafe(cmd)) {
      result.manual.push({ ...row, cmd, reason: '화이트리스트 밖(셸 부작용 가능)' });
      continue;
    }
    let value, failed = false;
    try {
      value = execSync(cmd, { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    } catch (e) {
      // grep은 미검출 시 exit 1 — 실패가 아니라 "0건"이다. 출력이 있으면 그걸 값으로 본다.
      value = (e.stdout ?? '').trim();
      failed = value === '' && (e.status ?? 1) > 1;
    }
    const expected = pairExpected;
    // `grep -c` 를 **여러 파일**에 걸면 출력이 `파일:값` 여러 줄이 된다 — 첫 줄만 보면 `package.json:0`
    // 같은 문자열이 되어 기대값 `0`과 다르다고 오판한다(실제로 #141에서 밟았다). 합계로 환산한다.
    const perFile = value.split('\n').filter(Boolean).map((l) => l.match(/^.+:(\d+)$/));
    const isCountPerFile = perFile.length > 0 && perFile.every(Boolean);
    const normalized = isCountPerFile
      ? String(perFile.reduce((s, m) => s + Number(m[1]), 0))
      : value.split('\n')[0] || '(빈 출력)';
    const notes = [];
    if (isCountPerFile && perFile.length > 1) notes.push(`${perFile.length}개 파일 합계`);
    if (superseded > 0) notes.push(`舊 명령 ${superseded}건은 무효화됨 — 마지막 명령으로 판정`);
    const entry = {
      num: row.num, cmd, expected,
      actual: normalized,
      note: notes.join(' · '),
      lines: value ? value.split('\n').length : 0,
    };
    if (failed) result.errored.push(entry);
    else if (expected === null) result.manual.push({ ...row, cmd, reason: '기대값 미기재 — 값 해석 필요', actual: entry.actual });
    else if (entry.actual.replace(/\s/g, '') === expected) result.matched.push(entry);
    else result.mismatched.push(entry);
  }
}

const b = (s) => `\x1b[1m${s}\x1b[0m`;
console.log(b(`\n대장 재현 — 대상 ${rows.length}행 (${ALL ? '전건' : ONLY ? '지정' : '대기분'})\n`));

/**
 * ★ 표 무결성 — 총계보다 먼저 본다.
 * 셀 안에 **이스케이프되지 않은 파이프**가 있으면 그 행의 칸이 밀리고, 상태 칸을 뒤에서 두 번째로
 * 읽는 총계 명령이 **엉뚱한 칸을 상태로 읽는다**. #159가 "총계 명령이 취약하다"며 명령을 고쳤지만,
 * 명령이 옳아도 **데이터가 깨져 있으면** 여전히 틀린다 — 그 층은 그때 점검되지 않았다.
 * (실측 2026-08-23: 비표준 칸수 4행이 선존했고, 마침 전부 대기 항이 아니라 총계는 우연히 맞았다.
 *  §6-1~§6-10에 대기 항이 하나라도 생기면 그 순간 틀린다.)
 */
{
  // 대장은 §6-1~§6-11의 **여러 표**로 나뉘고 표마다 칸 수가 다르다(초기 표는 5칸, §6-11은 7칸).
  // 그래서 절대 칸수로 판정하면 오탐한다 — **같은 표 안에서 최빈 칸수와 다른 행**만 잡는다.
  const tables = [];
  let cur = null;
  for (const line of readFileSync(LEDGER, 'utf8').split('\n')) {
    if (/^\|\s*-+/.test(line)) { cur = []; tables.push(cur); continue; }  // 구분선 = 새 표 시작
    if (!/^\| /.test(line)) { cur = null; continue; }                     // 표 밖 → 블록 종료
    if (cur && /^\| \d+ \|/.test(line)) {
      cur.push({ num: line.match(/^\| (\d+)/)[1], n: line.split(/(?<!\\)\|/).length });
    }
  }
  const bad = [];
  for (const t of tables) {
    if (t.length < 2) continue;
    const freq = {};
    for (const r of t) freq[r.n] = (freq[r.n] ?? 0) + 1;
    const mode = Number(Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0]);
    for (const r of t) if (r.n !== mode) bad.push(`#${r.num}(${r.n}칸, 이 표 기준 ${mode})`);
  }
  if (bad.length) {
    console.log(b(`■ ⚠️ 표 무결성 ${bad.length}행 — 셀 안 파이프가 이스케이프(\\|)되지 않아 칸이 밀렸다`));
    console.log(`  ${bad.join(', ')}`);
    console.log(`  → 상태 칸이 뒤에서 두 번째가 아니게 되면 총계가 조용히 틀린다. 대기 항이면 즉시 고칠 것.\n`);
  }
}

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
    `수동 ${result.manual.length} · 오류 ${result.errored.length}\n`),
);
console.log('⚠️ 값 일치가 곧 미해소는 아니고, 어긋남이 곧 해소도 아니다 — 대장 #114는 명령이 검출했으나');
console.log('   결함 자체가 없었다. 이 출력은 "어디를 사람이 봐야 하는가"의 목록이다.\n');
