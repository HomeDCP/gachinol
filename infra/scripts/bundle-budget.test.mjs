// infra/scripts/bundle-budget.test.mjs
// URL 형태 검증(대장 #189) 단위 테스트 — "설정됨"과 "올바름"을 구분하는 층이 실제로 동작하는지
// 확인한다. `infra/scripts/bundle-budget.mjs`는 `--check-urls` 모드로 EXPO_PUBLIC_*_URL 패턴의
// env 키를 자동 수집·판정한다(하드코딩 목록 아님 — 대장 #146과 같은 함정 방지).
//
// ⚠️ 이 파일은 `bundle-budget.mjs`를 import한다 — 그 모듈이 `isMainModule` 가드로 main()을
// 감싸고 있어야(daejang-recheck.mjs·verify-deployed-sha.mjs 선례와 동형) import 시점에 dist 탐색·
// gzip 측정 같은 부수효과가 실행되지 않는다. 이 테스트는 순수 함수(`collectExpoPublicUrlKeys`·
// `validateUrlValue`·`checkUrls`)만 직접 호출하며, 기존 번들 예산 로직(BUDGETS·측정)은 건드리지도
// 실행하지도 않는다.
//
// ⚠️ 루트 `package.json`의 `test:scripts`에 이 파일을 등재해야 한다 — 잊으면
// `daejang-recheck.test.mjs`의 self-check(test:scripts 등재 검사)가 레드로 잡는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { collectExpoPublicUrlKeys, validateUrlValue, checkUrls } from './bundle-budget.mjs';

const SCRIPT_PATH = fileURLToPath(new URL('./bundle-budget.mjs', import.meta.url));

// ── collectExpoPublicUrlKeys — 패턴 수집(하드코딩 목록 아님) ────────────────────

test('collectExpoPublicUrlKeys: EXPO_PUBLIC_*_URL 패턴만 골라내고 그 외는 제외한다', () => {
  const env = {
    EXPO_PUBLIC_API_URL: 'https://a.example.com',
    EXPO_PUBLIC_SUPPORT_TEL: '010-0000-0000', // _URL로 안 끝남 — 제외
    EXPO_PUBLIC_SUBSCRIBER_WEB_URL: 'https://b.example.com',
    NOT_EXPO_PUBLIC_URL: 'https://c.example.com', // EXPO_PUBLIC_로 안 시작 — 제외
    OTHER_VAR: 'x',
  };
  assert.deepEqual(collectExpoPublicUrlKeys(env), [
    'EXPO_PUBLIC_API_URL',
    'EXPO_PUBLIC_SUBSCRIBER_WEB_URL',
  ]);
});

// 느슨화 감시: 하드코딩 목록으로 되돌리면(예: 8개 키만 나열) 이 테스트가 레드가 된다 —
// 새 키를 넣었는데도 목록에 없으면 대장 #146과 같은 "한쪽만 추가하면 조용히 빈 값" 함정이 재발한다.
test('collectExpoPublicUrlKeys: 목록에 없던 새 EXPO_PUBLIC_XXX_URL 키도 자동으로 잡힌다', () => {
  const env = { EXPO_PUBLIC_BRAND_NEW_FEATURE_URL: 'https://new.example.com' };
  assert.deepEqual(collectExpoPublicUrlKeys(env), ['EXPO_PUBLIC_BRAND_NEW_FEATURE_URL']);
});

// ── validateUrlValue — 판정 규칙 ─────────────────────────────────────────────

test('validateUrlValue: 정상 http(s) URL은 통과한다', () => {
  const r1 = validateUrlValue('EXPO_PUBLIC_API_URL', 'https://api.example.com');
  assert.equal(r1.ok, true);
  const r2 = validateUrlValue('EXPO_PUBLIC_API_URL', 'http://localhost:4000');
  assert.equal(r2.ok, true);
});

test('validateUrlValue: 빈 값은 통과한다(의도된 설계 — Dockerfile.web #127 선례)', () => {
  const r = validateUrlValue('EXPO_PUBLIC_API_URL', '');
  assert.equal(r.ok, true);
});

test('validateUrlValue: undefined(미설정)는 통과한다', () => {
  const r = validateUrlValue('EXPO_PUBLIC_API_URL', undefined);
  assert.equal(r.ok, true);
});

// 실측(2026-09-01): `new URL("https://<host>")`는 host 위치의 `<`/`>`를 스스로 거부해 Invalid URL을
// 던진다 — 이 케이스는 new URL() 단독으로도 잡힌다. 대장 원문의 실제 사례로 확인.
test('validateUrlValue: host 위치 플레이스홀더(대장 실제 사례)는 red다', () => {
  const r = validateUrlValue(
    'EXPO_PUBLIC_SUBSCRIBER_WEB_URL',
    'https://<구독자-Tailscale-오리진>',
  );
  assert.equal(r.ok, false);
  assert.match(r.reason, /<|>/);
});

// ⚠️ 핵심 케이스 — `new URL()`이 이 값을 **파싱 성공**시킨다(퍼센트인코딩). `<`/`>` 별도 검사가
// 없으면 이 테스트가 놓친다. 느슨화 감시: `<`/`>` 직접 검사를 지우고 new URL() 성패에만 기대면
// 이 테스트가 레드가 된다(=검증이 이 유형의 플레이스홀더를 통과시킨다는 뜻).
test('validateUrlValue: path 위치 플레이스홀더는 new URL()이 파싱에 성공해도 red다(별도 검사 필수)', () => {
  const raw = 'https://example.com/<TOKEN>';
  // new URL()은 이 값을 실제로 통과시킨다는 것을 여기서도 재확인한다(전제 실증).
  assert.doesNotThrow(() => new URL(raw));
  const r = validateUrlValue('EXPO_PUBLIC_API_URL', raw);
  assert.equal(r.ok, false, 'new URL()이 파싱에 성공해도 <>를 담은 값은 red여야 한다');
});

test('validateUrlValue: new URL() 파싱 자체가 실패하면 red다', () => {
  const r = validateUrlValue('EXPO_PUBLIC_API_URL', 'not-a-url');
  assert.equal(r.ok, false);
  assert.match(r.reason, /파싱 실패/);
});

test('validateUrlValue: http(s)가 아닌 프로토콜은 red다(javascript:·file: 등)', () => {
  const r1 = validateUrlValue('EXPO_PUBLIC_API_URL', 'javascript:alert(1)');
  assert.equal(r1.ok, false);
  assert.match(r1.reason, /프로토콜/);
  const r2 = validateUrlValue('EXPO_PUBLIC_API_URL', 'file:///etc/passwd');
  assert.equal(r2.ok, false);
});

// ── checkUrls — 통합(수집 + 판정 한 번에) ────────────────────────────────────

test('checkUrls: 전건 정상이면 ok=true, failed=[]다', () => {
  const result = checkUrls({
    EXPO_PUBLIC_API_URL: 'https://api.example.com',
    EXPO_PUBLIC_SUBSCRIBER_WEB_URL: '',
    EXPO_PUBLIC_SUPPORT_TEL: '010-0000-0000',
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.failed, []);
  assert.equal(result.keys.length, 2); // _URL 접미 2건만(SUPPORT_TEL 제외)
});

test('checkUrls: 1건이라도 실패하면 ok=false이고 failed에 담긴다', () => {
  const result = checkUrls({
    EXPO_PUBLIC_API_URL: 'https://api.example.com',
    EXPO_PUBLIC_SUBSCRIBER_WEB_URL: 'https://<broken>',
  });
  assert.equal(result.ok, false);
  assert.equal(result.failed.length, 1);
  assert.equal(result.failed[0].key, 'EXPO_PUBLIC_SUBSCRIBER_WEB_URL');
});

test('checkUrls: 매칭 키가 0건이면 ok=true다(검사 대상이 없으니 통과)', () => {
  const result = checkUrls({ SOME_OTHER_VAR: 'x' });
  assert.equal(result.ok, true);
  assert.deepEqual(result.keys, []);
});

// ── CLI 통합 — 실제로 서브프로세스를 실행해 종료 코드까지 확인한다 ────────────
// (daejang-recheck.test.mjs가 실 grep/find를 실행해 배선을 검증하는 것과 동형 — 순수 함수 단위
// 테스트만으로는 main()의 배선(runUrlCheck 반환값 → process.exit)이 맞는지 보장되지 않는다.)

function runCli(env) {
  try {
    const stdout = execFileSync('node', [SCRIPT_PATH, '--check-urls'], {
      env: { ...process.env, ...env },
      encoding: 'utf8',
    });
    return { code: 0, stdout };
  } catch (err) {
    return { code: err.status, stdout: err.stdout };
  }
}

test('CLI: --check-urls 모드에서 정상 값은 exit 0을 낸다', () => {
  const { code, stdout } = runCli({ EXPO_PUBLIC_API_URL: 'https://api.example.com' });
  assert.equal(code, 0);
  assert.match(stdout, /URL 형태 검증 통과/);
});

test('CLI: --check-urls 모드에서 대장 실제 플레이스홀더 값은 exit≠0을 낸다', () => {
  const { code, stdout } = runCli({
    EXPO_PUBLIC_SUBSCRIBER_WEB_URL: 'https://<구독자-Tailscale-오리진>',
  });
  assert.notEqual(code, 0);
  assert.match(stdout, /URL 형태 검증 실패/);
});

// 느슨화 감시(회귀 방지): --check-urls 모드가 기존 번들 예산 측정을 침범하지 않는지 — 이 모드에서는
// dist 탐색 로그("번들 예산") 자체가 출력되면 안 된다(모드가 섞이면 하나가 다른 하나를 가린다).
test('CLI: --check-urls 모드는 번들 예산 측정 출력과 섞이지 않는다', () => {
  const { stdout } = runCli({ EXPO_PUBLIC_API_URL: 'https://api.example.com' });
  assert.doesNotMatch(stdout, /번들 예산/);
});
