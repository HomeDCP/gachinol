#!/usr/bin/env node
/**
 * infra/scripts/bundle-budget.mjs
 *
 * 웹앱 "첫 로드" 번들 예산 측정·게이트 (T-W1-11c, 원천: docs/plan/02-web-architecture.md §C 성능 예산).
 * `.github/workflows/deploy-web.yml`의 2번째 스텝(번들 예산 게이트)이 이 스크립트를 호출한다.
 *
 * ── 이 파일이 예산 수치의 단일 원천이다 ──────────────────────────────────────────
 * 아래 `BUDGETS` 상수 외 어디에도 숫자를 박지 않는다(D7-1 박제 금지). 정본 02 §C 표와
 * 워크플로 YAML은 이 값을 **인용만** 하며, 대조는 재현 명령으로 한다:
 *
 *     node infra/scripts/bundle-budget.mjs --print-budget
 *
 * ── 측정 정의 (재현 가능성이 이 스크립트의 존재 이유다) ──────────────────────────
 * 1) 분자 = **엔트리 문서(`<dist>/index.html`)가 참조하는 초기 JS 청크만**의 gzip 합계.
 *    - `<script src="/...">`로 실제 첫 화면에 로드되는 것만 센다. 지연 로드 청크·다른 라우트의
 *      HTML이 참조하는 것·이미지·폰트는 분자에 넣지 않는다.
 *    - **CSS는 분자에 넣지 않는다** — 정본 §C 행 이름이 "구독자 웹 첫 로드(JS 번들, gzip)"이다.
 *      다만 눈에 보이도록 **참고 측정**해 함께 출력한다(무시가 아니라 분리다).
 * 2) 압축 = **`gzip -9`** (GNU/BSD `gzip` 바이너리). 레벨을 적지 않으면 환경마다 값이 달라진다:
 *    실측(2026-08-16, subscriber entry) `-9`=512,706 / `-6`=514,729.
 *    ⚠️ **Node `zlib.gzipSync(buf,{level:9})`는 같은 파일에 513,887을 낸다**(deflate 구현이 달라
 *    1,181 바이트 차이). 그래서 이 스크립트는 일부러 `gzip -9` **바이너리로 파이프**한다 —
 *    zlib으로 바꾸면 조율자 실측치와 어긋나고 재현이 깨진다.
 * 3) 게이트 대상 = `BUDGETS`에서 `gate: 'block'`인 앱만. 나머지는 측정·출력만 하고 실패시키지 않는다.
 *
 * ── 사용법 ────────────────────────────────────────────────────────────────────
 *   node infra/scripts/bundle-budget.mjs                          # 리포 로컬 dist 3종 자동 탐색
 *   node infra/scripts/bundle-budget.mjs --dist subscriber=web-dist/watch ...   # 경로 지정(CI)
 *   node infra/scripts/bundle-budget.mjs --print-budget           # 예산 수치만 출력(정본 대조용)
 *   node infra/scripts/bundle-budget.mjs --json                   # 기계 판독 출력 추가
 *   node infra/scripts/bundle-budget.mjs --hard-bytes 400000      # ⚠️ 비정본 what-if(경고 배너 출력)
 *
 * 종료 코드: 0=통과 / 1=차단선 초과(게이트 실패) / 2=측정 불가(엔트리 문서·자산 부재 등)
 *
 * ── URL 형태 검증 (대장 #189, `--check-urls`) ──────────────────────────────────
 * "설정됨"과 "올바름"을 구분하는 별도 모드. `EXPO_PUBLIC_*_URL` 형태의 env 키를 **패턴으로**
 * 수집해(하드코딩 목록 아님 — 새 키가 생겨도 자동으로 걸린다) 각각을 판정한다:
 *   - 빈 값·미설정 = 통과(의도된 설계 — Dockerfile.web 헤더 주석: "가짜 기본값을 넣으면 죽은
 *     버튼이 생긴다", #127 선례).
 *   - `<` 또는 `>` 포함 = 실패. `new URL()`은 이 문자가 host 위치에 있으면 스스로도 던지지만
 *     path 위치(예: `https://example.com/<TOKEN>`)에서는 퍼센트인코딩해 **통과시킨다** — 그래서
 *     이 검사는 `new URL()`과 별개로 문자열 자체를 본다.
 *   - `new URL()` 파싱 실패 = 실패.
 *   - 프로토콜이 `http:`/`https:`가 아니면 = 실패.
 * `--check-urls`는 번들 예산 측정과 **완전히 분리된 모드**다 — 켜지면 URL 검증만 하고 종료하며
 * (dist 탐색·gzip 측정 등 기존 로직은 실행되지 않는다), 기존 예산 게이트의 종료 코드 의미(위 문단)를
 * 가리지 않는다. 사용법: `node infra/scripts/bundle-budget.mjs --check-urls` (env에서 직접 읽음).
 * 종료 코드: 0=전건 통과 / 1=1건 이상 실패.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, appendFileSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// ── URL 형태 검증 — 순수 함수(부수효과 없음, 테스트가 이 함수들을 직접 import한다) ─────────

/**
 * `env` 객체에서 `EXPO_PUBLIC_`으로 시작하고 `_URL`로 끝나는 키만 패턴으로 골라낸다.
 * 하드코딩 목록이 아니다 — 새 `EXPO_PUBLIC_XXX_URL` 키가 생겨도 자동으로 검사 대상이 된다
 * (대장 #146 "한쪽만 추가하면 조용히 빈 값" 함정과 동형의 실수를 이 층에서 막는다).
 */
export function collectExpoPublicUrlKeys(env) {
  return Object.keys(env)
    .filter((k) => k.startsWith('EXPO_PUBLIC_') && k.endsWith('_URL'))
    .sort();
}

/**
 * 값 하나를 판정한다. 예외를 던지지 않는다 — 항상 `{ key, value, ok, reason }`을 반환한다.
 * @param {string} key
 * @param {string|undefined} rawValue
 */
export function validateUrlValue(key, rawValue) {
  if (rawValue === undefined || rawValue === null || rawValue === '') {
    return { key, value: rawValue ?? '', ok: true, reason: '빈 값·미설정 — 통과(의도된 설계)' };
  }
  // new URL()이 host 위치의 `<`/`>`는 스스로 거부하지만 path 위치에서는 퍼센트인코딩해 통과시킨다
  // (실측: `https://<host>` → Invalid URL / `https://x.com/<t>` → 통과) — 그래서 파싱과 별개로 먼저 본다.
  if (rawValue.includes('<') || rawValue.includes('>')) {
    return {
      key,
      value: rawValue,
      ok: false,
      reason: `플레이스홀더로 의심되는 '<'/'>' 문자 포함 (값: ${rawValue})`,
    };
  }
  let parsed;
  try {
    parsed = new URL(rawValue);
  } catch (err) {
    return { key, value: rawValue, ok: false, reason: `URL 파싱 실패: ${err.message} (값: ${rawValue})` };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      key,
      value: rawValue,
      ok: false,
      reason: `허용되지 않는 프로토콜 '${parsed.protocol}' (값: ${rawValue})`,
    };
  }
  return { key, value: rawValue, ok: true, reason: `정상 URL (${parsed.href})` };
}

/** `env` 전체를 대상으로 패턴 수집 + 값 판정을 한 번에 수행한다. */
export function checkUrls(env) {
  const keys = collectExpoPublicUrlKeys(env);
  const results = keys.map((k) => validateUrlValue(k, env[k]));
  const failed = results.filter((r) => !r.ok);
  return { ok: failed.length === 0, keys, results, failed };
}

/** `env`를 판정하고 사람이 읽을 로그를 출력한 뒤 종료 코드(0|1)를 반환한다. */
function runUrlCheck(env) {
  const { ok, keys, results, failed } = checkUrls(env);
  console.log('── URL 형태 검증 (EXPO_PUBLIC_*_URL, 대장 #189) ──');
  if (keys.length === 0) {
    console.log('검사 대상 EXPO_PUBLIC_*_URL 키 0건 — env에 매칭되는 변수가 없다.');
  }
  for (const r of results) {
    console.log(`  [${r.ok ? '✓' : '✗'}] ${r.key} — ${r.reason}`);
  }
  console.log('');
  if (!ok) {
    console.log(`✗✗✗ URL 형태 검증 실패 — ${failed.length}건. 위 사유를 보고 값을 고칠 것.`);
    console.log('    (GitHub Variables에 손으로 입력한 값에 오타·플레이스홀더 잔존이 없는지 확인)');
  } else {
    console.log('✓ URL 형태 검증 통과 — 전건 정상.');
  }
  return ok ? 0 : 1;
}

/**
 * 예산의 단일 원천.
 *
 * - hardBytes(차단선, HARD): 초과하면 **실패**. "지금보다 나빠지는 것을 막는" 회귀 차단선이며
 *   목표 달성 여부와 무관하다. 2026-08-16 실측(subscriber 512,706 B) 대비 약 +5.3% 여유.
 * - targetBytes(목표치, SOFT): 정본 02 §C가 정한 350 KiB(= 358,400 B, expo-router 라우트 분할 전제).
 *   초과해도 실패시키지 않되 **매 실행 로그에 초과분을 보여** 목표를 잊지 않게 한다.
 *
 * 두 값을 분리한 이유(사용자 결정 2026-08-16): 현실(1청크·512 KB)이 정본 예산의 143%라
 * 정본 값을 그대로 차단선으로 쓰면 게이트가 첫날부터 상시 red가 되어 아무도 보지 않게 되고,
 * 반대로 정본 값을 실측치로 올려 쓰면 목표를 조용히 포기하게 된다.
 *
 * 예산을 바꿀 때: 이 상수만 고치고 정본 02 §C 표의 재현 명령 출력으로 대조한다.
 */
const BUDGETS = {
  subscriber: {
    label: '구독자(watch.)',
    hardBytes: 540_000,
    targetBytes: 358_400,
    gate: 'block',
    // 정본 §C가 예산을 명시한 유일한 앱. 카톡 유입 1순위·고령층 회선·TWA 스토어 심사 대상.
    note: '정본 02 §C 예산 행의 대상',
  },
  reporter: {
    label: '기자(reporter.)',
    gate: 'measure',
    // 내부 사용자(지사 기자) 전용 PWA — 정본 §C는 이 앱에 번들 예산을 두지 않았고,
    // 같은 문서의 Lighthouse 게이트 각주도 기자·관제를 "측정하되 비차단 참고치"로 확정했다.
    // 그 판정과 동형으로 측정만 한다(빼지 않는 이유: 비대화를 눈에 보이게 두기 위해).
    note: '비차단 참고 측정(정본 §C Lighthouse 각주와 동형)',
  },
  'control-center': {
    label: '관제(center.)',
    gate: 'measure',
    note: '비차단 참고 측정(정본 §C Lighthouse 각주와 동형)',
  },
};

/** 지정이 없을 때 쓰는 리포 로컬 export 산출물 경로. */
const DEFAULT_DISTS = {
  subscriber: 'apps/subscriber/dist',
  reporter: 'apps/reporter/dist',
  'control-center': 'apps/control-center/dist',
};

function fatal(msg) {
  console.error(`bundle-budget: ${msg}`);
  process.exit(2);
}

const fmt = (n) => n.toLocaleString('en-US');
const kib = (n) => `${(n / 1024).toFixed(1)} KiB`;
const pct = (n, of) => `${((n / of) * 100).toFixed(1)}%`;

// ── main — 실행 시(모듈 로드만으로는 실행되지 않는다) 진입점. 아래 isMainModule 가드 참조. ──
function main() {
  // ── 인자 파싱 ────────────────────────────────────────────────────────────────
  const argv = process.argv.slice(2);
  const dists = {};
  let printBudgetOnly = false;
  let asJson = false;
  let hardOverride = null;
  let checkUrlsMode = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--check-urls') checkUrlsMode = true;
    else if (arg === '--print-budget') printBudgetOnly = true;
    else if (arg === '--json') asJson = true;
    else if (arg === '--hard-bytes') hardOverride = Number(argv[(i += 1)]);
    else if (arg.startsWith('--hard-bytes=')) hardOverride = Number(arg.split('=')[1]);
    else if (arg === '--dist' || arg.startsWith('--dist=')) {
      const pair = arg.startsWith('--dist=') ? arg.slice('--dist='.length) : argv[(i += 1)];
      const eq = pair.indexOf('=');
      if (eq < 0) fatal(`--dist 인자는 <앱>=<경로> 형식이어야 한다: ${pair}`);
      const app = pair.slice(0, eq);
      if (!BUDGETS[app])
        fatal(`알 수 없는 앱 이름: ${app} (허용: ${Object.keys(BUDGETS).join(', ')})`);
      dists[app] = pair.slice(eq + 1);
    } else fatal(`알 수 없는 인자: ${arg}`);
  }

  // `--check-urls`는 번들 예산 로직과 완전히 분리된 모드다 — 여기서 판정하고 즉시 종료한다.
  // (dist 탐색·gzip 측정 등 아래 로직은 실행되지 않는다. "둘을 섞으면 하나가 다른 하나를 가린다".)
  if (checkUrlsMode) {
    process.exit(runUrlCheck(process.env));
    return;
  }

  if (printBudgetOnly) {
    // 정본 02 §C 표가 인용하는 재현 명령의 출력. 형식을 바꾸면 그 인용도 함께 갱신할 것.
    for (const [app, b] of Object.entries(BUDGETS)) {
      if (b.gate !== 'block') {
        console.log(`${app}: gate=measure (차단선 없음 — ${b.note})`);
        continue;
      }
      console.log(
        `${app}: gate=block  차단선(HARD)=${fmt(b.hardBytes)} bytes  목표치(SOFT)=${fmt(b.targetBytes)} bytes  측정=gzip -9, 엔트리 초기 JS 청크만`,
      );
    }
    process.exit(0);
  }

  if (Object.keys(dists).length === 0) Object.assign(dists, DEFAULT_DISTS);

  // ── 측정 ─────────────────────────────────────────────────────────────────────

  /** gzip -9 바이너리로 압축한 바이트 수. (Node zlib과 값이 다르다 — 헤더 주석 2) 참조) */
  function gzip9Size(file) {
    const out = execFileSync('gzip', ['-9', '-c', file], { maxBuffer: 512 * 1024 * 1024 });
    return out.length;
  }

  /** 엔트리 문서가 참조하는 로컬 자산 경로 추출(외부 URL·data: 는 제외). */
  function refsFrom(html, attrRe) {
    const found = [];
    for (const m of html.matchAll(attrRe)) {
      const href = m[1];
      if (/^(?:[a-z]+:)?\/\//i.test(href) || href.startsWith('data:')) continue;
      found.push(href.split('?')[0].split('#')[0]);
    }
    return found;
  }

  function measure(app, distDir) {
    const abs = resolve(REPO_ROOT, distDir);
    // dist 자체가 없는 경우만 "미빌드"로 구분한다. 디렉터리는 있는데 엔트리·자산이 깨진 경우는
    // 항상 치명(exit 2) — 깨진 export가 조용히 통과하는 경로를 만들지 않기 위해서다.
    if (!existsSync(abs))
      return { app, distDir, error: `dist 디렉터리 없음: ${distDir}`, notBuilt: true };
    const entry = join(abs, 'index.html');
    if (!existsSync(entry))
      return { app, distDir, error: `엔트리 문서 없음: ${join(distDir, 'index.html')}` };

    const html = readFileSync(entry, 'utf8');
    const jsRefs = refsFrom(html, /<script[^>]+src="([^"]+)"/gi);
    const cssRefs = [...new Set(refsFrom(html, /<link[^>]+rel="stylesheet"[^>]*href="([^"]+)"/gi))];

    if (jsRefs.length === 0)
      return {
        app,
        distDir,
        error: `index.html이 참조하는 초기 JS가 0건 — export 산출물이 깨졌을 가능성`,
      };

    const resolveAsset = (ref) => join(abs, ref.replace(/^\//, ''));
    const jsFiles = [];
    for (const ref of jsRefs) {
      const file = resolveAsset(ref);
      if (!existsSync(file))
        return { app, distDir, error: `엔트리가 참조하는 JS가 실재하지 않음: ${ref}` };
      jsFiles.push({ ref, raw: statSync(file).size, gzip: gzip9Size(file) });
    }
    const cssFiles = [];
    for (const ref of cssRefs) {
      const file = resolveAsset(ref);
      if (!existsSync(file)) continue; // CSS는 게이트 밖 참고치 — 부재로 실패시키지 않는다
      cssFiles.push({ ref, raw: statSync(file).size, gzip: gzip9Size(file) });
    }

    const jsGzip = jsFiles.reduce((a, f) => a + f.gzip, 0);
    const jsRaw = jsFiles.reduce((a, f) => a + f.raw, 0);
    const cssGzip = cssFiles.reduce((a, f) => a + f.gzip, 0);
    return { app, distDir, jsFiles, cssFiles, jsGzip, jsRaw, cssGzip };
  }

  // ── 실행 ─────────────────────────────────────────────────────────────────────
  const lines = [];
  const say = (s = '') => {
    lines.push(s);
    console.log(s);
  };

  say('── 번들 예산 (T-W1-11c · 정본 docs/plan/02-web-architecture.md §C) ──');
  say(
    '측정: 엔트리 문서 index.html이 참조하는 초기 JS 청크만, `gzip -9` 바이너리 기준 (CSS는 분자 제외·참고 출력)',
  );
  if (hardOverride !== null) {
    say('');
    say('⚠️⚠️ 차단선이 명령행 인자로 재정의됐다 — 이 실행은 정본 예산이 아니다(what-if).');
    say(
      `⚠️⚠️ 정본 차단선은 infra/scripts/bundle-budget.mjs의 BUDGETS 상수이며, CI는 이 인자를 넘기지 않는다.`,
    );
  }
  say('');

  const results = [];
  let failed = false;
  let measureError = false;

  for (const [app, distDir] of Object.entries(dists)) {
    const budget = BUDGETS[app];
    const r = measure(app, distDir);
    results.push(r);

    // 리포 안이면 상대 경로로, 밖이면(CI가 이미지에서 꺼낸 임시 경로 등) 절대 경로로 그대로 보여준다.
    const absDist = resolve(REPO_ROOT, distDir);
    const relDist = relative(REPO_ROOT, absDist);
    say(`[${app}] ${budget.label}  dist=${relDist.startsWith('..') ? absDist : relDist || distDir}`);
    if (r.error) {
      // 게이트 대상 앱은 어떤 사유든 측정 불가 = 실패(깨진 export의 조용한 통과 금지).
      // 참고 측정 앱은 "아직 빌드 안 함"만 경고로 넘긴다(로컬에서 한 앱만 빌드한 경우).
      const tolerable = budget.gate !== 'block' && r.notBuilt;
      say(`  ${tolerable ? '⚠ 건너뜀' : '✗ 측정 불가'} — ${r.error}`);
      say('');
      if (!tolerable) measureError = true;
      continue;
    }

    say(`  초기 JS 청크 ${r.jsFiles.length}개`);
    for (const f of r.jsFiles)
      say(`    - ${f.ref}  raw ${fmt(f.raw)} B  →  gzip -9 ${fmt(f.gzip)} B`);
    say(`  첫 로드 JS(gzip -9 합계) = ${fmt(r.jsGzip)} bytes (${kib(r.jsGzip)})`);
    say(
      `  [참고·게이트 분자 아님] 초기 CSS ${r.cssFiles.length}개 gzip -9 합계 = ${fmt(r.cssGzip)} bytes`,
    );

    if (budget.gate !== 'block') {
      say(`  → 게이트 없음(측정만): ${budget.note}`);
      say('');
      continue;
    }

    const hard = hardOverride !== null ? hardOverride : budget.hardBytes;
    const target = budget.targetBytes;
    say(`  차단선(HARD) ${fmt(hard)} B / 목표치(SOFT) ${fmt(target)} B — ${budget.note}`);

    if (r.jsGzip > hard) {
      failed = true;
      say('');
      say('  ✗✗✗ 번들 예산 게이트 실패 — 차단선 초과 ✗✗✗');
      say(`      현재값   ${fmt(r.jsGzip)} bytes (${kib(r.jsGzip)})`);
      say(`      차단선   ${fmt(hard)} bytes (${kib(hard)})`);
      say(`      초과분   +${fmt(r.jsGzip - hard)} bytes (차단선의 ${pct(r.jsGzip, hard)})`);
      say(`      목표치   ${fmt(target)} bytes (${kib(target)})  ← 정본 02 §C, 참고`);
      say('');
      say('      차단선은 "지금보다 나빠지는 것"을 막는 회귀 방어선이다. 이 실패는 이번 변경이');
      say('      첫 로드 JS를 늘렸다는 뜻이다 — 신규 의존성 추가 / 라우트 분할 붕괴 / 정적 import');
      say('      승격을 먼저 의심하라. 위 "초기 JS 청크" 목록과 직전 그린 실행의 값을 비교할 것.');
      say('      예산 자체를 바꿔야 한다면 infra/scripts/bundle-budget.mjs의 BUDGETS를 고치고');
      say('      정본 02 §C 표를 동반 갱신한다(테크리드 승인 — 정본 §C "미달 시 조치" 열).');
    } else {
      const headroom = hard - r.jsGzip;
      say(`  ✓ 차단선 통과 — 여유 ${fmt(headroom)} bytes (차단선 대비 ${pct(r.jsGzip, hard)} 사용)`);
      if (r.jsGzip > target) {
        say(
          `  △ 목표치(SOFT) 미달 — 목표 대비 +${fmt(r.jsGzip - target)} bytes (${pct(r.jsGzip, target)}). ` +
            '실패시키지 않되 계속 보이게 둔다(정본 §C 350 KiB는 살아 있는 목표다).',
        );
      } else {
        say('  ★ 목표치(SOFT)까지 충족 — 정본 02 §C 예산 달성.');
      }
    }
    say('');
  }

  if (asJson) {
    console.log(
      JSON.stringify(
        {
          budgets: BUDGETS,
          hardOverride,
          results: results.map((r) => ({
            app: r.app,
            dist: r.distDir,
            error: r.error ?? null,
            chunks: r.jsFiles?.length ?? null,
            jsGzipBytes: r.jsGzip ?? null,
            cssGzipBytes: r.cssGzip ?? null,
          })),
        },
        null,
        2,
      ),
    );
  }

  // GitHub Actions 잡 요약에도 같은 내용을 남긴다(실패 원인을 로그 뒤지지 않고 보게).
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `### 번들 예산 게이트\n\n\`\`\`\n${lines.join('\n')}\n\`\`\`\n`,
    );
  }

  if (measureError) process.exit(2);
  process.exit(failed ? 1 : 0);
}

const isMainModule = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  main();
}
