// infra/scripts/media-reachability.test.mjs
// 공개 미디어 URL 도달성 검사(대장 #169) 단위 테스트.
//
// ⭐ 핵심은 "사설 호스트·http 스킴 URL을 실제로 판정에 넣으면 FAIL이 나오는가"다 — 대장 #169의
// 실물 재현(`http://192.168.0.101:9000/...`)을 픽스처로 그대로 쓴다.
//
// ⚠️ 실제 네트워크를 치지 않는다 — 모든 async 테스트는 `fetchImpl`을 주입한다(deploy-smoke.mjs·
// monitor-freshness.mjs의 기존 관례와 동형).
// ⚠️ 루트 `package.json`의 `test:scripts`에 이 파일을 등재해야 한다 — 잊으면
// `daejang-recheck.test.mjs`의 self-check(test:scripts 등재 검사)가 레드로 잡는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  classifyHostFailures,
  classifyReachabilityFailure,
  judgeMediaTarget,
  probeMediaTargets,
  extractFeedMediaTargets,
  extractPlaybackMediaTargets,
  collectMediaTargets,
  judgeMediaReachability,
  checkMediaReachability,
  formatMediaVerdictLines,
  FAILURE_LABELS,
} from './media-reachability.mjs';

const SCRIPT_PATH = fileURLToPath(new URL('./media-reachability.mjs', import.meta.url));

// ═══════════════════════════════════════════════════════════════════════════════════
// classifyHostFailures — ① 호스트 판정(네트워크 없이, 즉시)
// ═══════════════════════════════════════════════════════════════════════════════════

test('classifyHostFailures: 공인 https 호스트는 통과(빈 배열)', () => {
  assert.deepEqual(classifyHostFailures('https://media.bapfull.com/g1/thumbnail.jpg'), []);
});

// ── 사설 IP 5종 ──────────────────────────────────────────────────────────────────────
for (const host of ['10.0.0.1', '10.255.255.255', '172.16.0.1', '172.31.255.255', '192.168.0.101']) {
  test(`classifyHostFailures: 사설 IP(${host}, https)는 private-host`, () => {
    assert.deepEqual(classifyHostFailures(`https://${host}/x.jpg`), ['private-host']);
  });
}

// ── 루프백 ──────────────────────────────────────────────────────────────────────────
for (const host of ['127.0.0.1', 'localhost', '[::1]']) {
  test(`classifyHostFailures: 루프백(${host})은 loopback-host`, () => {
    assert.deepEqual(classifyHostFailures(`https://${host}/x.jpg`), ['loopback-host']);
  });
}

// ── 내부 TLD ────────────────────────────────────────────────────────────────────────
for (const host of ['myhost.local', 'minio.internal']) {
  test(`classifyHostFailures: 내부 TLD(${host})는 internal-host`, () => {
    assert.deepEqual(classifyHostFailures(`https://${host}/x.jpg`), ['internal-host']);
  });
}

// ── http 스킴 ───────────────────────────────────────────────────────────────────────
test('classifyHostFailures: http 스킴(공인 호스트)은 insecure-scheme', () => {
  assert.deepEqual(classifyHostFailures('http://media.bapfull.com/x.jpg'), ['insecure-scheme']);
});

// ── ⭐ CGNAT 경계값 4점(위임문 A① — 100.64.0.0/10은 100.* 전체가 아니다) ─────────────────
test('⭐ classifyHostFailures: 100.63.255.255(둘째 옥텟 63)는 공인 — CGNAT 하한 바로 아래', () => {
  assert.deepEqual(classifyHostFailures('https://100.63.255.255/x.jpg'), []);
});
test('⭐ classifyHostFailures: 100.64.0.0(둘째 옥텟 64)는 사설 — CGNAT 하한', () => {
  assert.deepEqual(classifyHostFailures('https://100.64.0.0/x.jpg'), ['private-host']);
});
test('⭐ classifyHostFailures: 100.127.255.255(둘째 옥텟 127)는 사설 — CGNAT 상한', () => {
  assert.deepEqual(classifyHostFailures('https://100.127.255.255/x.jpg'), ['private-host']);
});
test('⭐ classifyHostFailures: 100.128.0.0(둘째 옥텟 128)는 공인 — CGNAT 상한 바로 위', () => {
  assert.deepEqual(classifyHostFailures('https://100.128.0.0/x.jpg'), []);
});

// ── ⭐ 대장 #169 실물: 한 URL이 두 조건에 동시에 걸린다 ─────────────────────────────────
test('⭐ classifyHostFailures: http://192.168.0.101:9000/...(대장 #169 실물)는 private-host이자 insecure-scheme — 둘 다 보고한다', () => {
  const failures = classifyHostFailures(
    'http://192.168.0.101:9000/gachinol-media/contents/abc/g1/thumbnail.jpg?X-Amz-Signature=xyz',
  );
  assert.deepEqual(failures, ['private-host', 'insecure-scheme']);
});

// ── invalid-url ─────────────────────────────────────────────────────────────────────
test('classifyHostFailures: URL로 파싱 안 되는 문자열은 invalid-url', () => {
  assert.deepEqual(classifyHostFailures('not a url'), ['invalid-url']);
});
test('classifyHostFailures: 빈 문자열도 invalid-url', () => {
  assert.deepEqual(classifyHostFailures(''), ['invalid-url']);
});

// ═══════════════════════════════════════════════════════════════════════════════════
// classifyReachabilityFailure — ② 도달 판정(순수 분류)
// ═══════════════════════════════════════════════════════════════════════════════════

test('classifyReachabilityFailure: attempted=false면 null(호스트 판정에서 이미 걸림)', () => {
  assert.equal(classifyReachabilityFailure({ attempted: false, error: null, status: null }), null);
});
test('classifyReachabilityFailure: timedOut=true면 timeout', () => {
  assert.equal(
    classifyReachabilityFailure({ attempted: true, timedOut: true, error: 'aborted', status: null }),
    'timeout',
  );
});
test('classifyReachabilityFailure: timedOut 아닌 네트워크 오류는 request_failed', () => {
  assert.equal(
    classifyReachabilityFailure({ attempted: true, timedOut: false, error: 'ECONNREFUSED', status: null }),
    'request_failed',
  );
});
test('classifyReachabilityFailure: 404는 not_found', () => {
  assert.equal(classifyReachabilityFailure({ attempted: true, error: null, status: 404 }), 'not_found');
});
test('⭐ classifyReachabilityFailure: 403은 forbidden(MinIO AccessDenied 전형)', () => {
  assert.equal(classifyReachabilityFailure({ attempted: true, error: null, status: 403 }), 'forbidden');
});
test('classifyReachabilityFailure: 500/503은 server_error', () => {
  assert.equal(classifyReachabilityFailure({ attempted: true, error: null, status: 500 }), 'server_error');
  assert.equal(classifyReachabilityFailure({ attempted: true, error: null, status: 503 }), 'server_error');
});
test('classifyReachabilityFailure: 200/404/403/5xx가 아닌 상태코드는 unexpected_status', () => {
  assert.equal(classifyReachabilityFailure({ attempted: true, error: null, status: 301 }), 'unexpected_status');
});
test('classifyReachabilityFailure: 200인데 기대 content-type과 다르면 content_type_mismatch', () => {
  assert.equal(
    classifyReachabilityFailure({
      attempted: true,
      error: null,
      status: 200,
      contentType: 'text/html; charset=utf-8',
      expectedContentTypePrefix: 'video/',
    }),
    'content_type_mismatch',
  );
});
test('classifyReachabilityFailure: 200 + 기대 content-type 일치면 null(통과)', () => {
  assert.equal(
    classifyReachabilityFailure({
      attempted: true,
      error: null,
      status: 200,
      contentType: 'video/mp4',
      expectedContentTypePrefix: 'video/',
    }),
    null,
  );
});
test('classifyReachabilityFailure: 기대 content-type 필드가 없으면 그 판정은 생략(200이면 통과)', () => {
  assert.equal(
    classifyReachabilityFailure({ attempted: true, error: null, status: 200, contentType: 'application/octet-stream' }),
    null,
  );
});

// ═══════════════════════════════════════════════════════════════════════════════════
// judgeMediaTarget — 호스트+도달 판정 합성
// ═══════════════════════════════════════════════════════════════════════════════════

test('judgeMediaTarget: hostFailures가 있으면 reachabilityFailure는 null이고 failureKinds=hostFailures', () => {
  const judged = judgeMediaTarget({
    source: 'feed.thumbnailUrl',
    url: 'http://192.168.0.101:9000/x.jpg',
    hostFailures: ['private-host', 'insecure-scheme'],
    attempted: false,
    status: null,
    error: null,
    contentType: null,
  });
  assert.equal(judged.ok, false);
  assert.deepEqual(judged.failureKinds, ['private-host', 'insecure-scheme']);
  assert.equal(judged.reachabilityFailure, null);
});

test('judgeMediaTarget: 호스트 통과 + 200/올바른 content-type이면 ok', () => {
  const judged = judgeMediaTarget({
    source: 'playback.hlsUrl',
    url: 'https://media.bapfull.com/g1/720p.mp4',
    hostFailures: [],
    attempted: true,
    status: 200,
    error: null,
    contentType: 'video/mp4',
    expectedContentTypePrefix: 'video/',
  });
  assert.equal(judged.ok, true);
  assert.deepEqual(judged.failureKinds, []);
});

// ═══════════════════════════════════════════════════════════════════════════════════
// probeMediaTargets — fetchImpl 주입(네트워크 없음)
// ═══════════════════════════════════════════════════════════════════════════════════

test('probeMediaTargets: 호스트 판정에서 걸린 타깃은 fetchImpl을 아예 호출하지 않는다', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    return { status: 200, headers: { get: () => 'video/mp4' } };
  };
  const results = await probeMediaTargets(
    [{ source: 'feed.thumbnailUrl', url: 'http://192.168.0.101:9000/x.jpg', expectedContentTypePrefix: 'image/' }],
    { fetchImpl },
  );
  assert.equal(calls, 0);
  assert.equal(results[0].attempted, false);
  assert.deepEqual(results[0].hostFailures, ['private-host', 'insecure-scheme']);
});

test('probeMediaTargets: 호스트 통과 타깃은 fetchImpl로 상태·content-type을 수집한다', async () => {
  const fetchImpl = async () => ({ status: 200, headers: { get: (h) => (h === 'content-type' ? 'image/jpeg' : null) } });
  const results = await probeMediaTargets(
    [{ source: 'feed.thumbnailUrl', url: 'https://media.bapfull.com/x.jpg', expectedContentTypePrefix: 'image/' }],
    { fetchImpl },
  );
  assert.equal(results[0].attempted, true);
  assert.equal(results[0].status, 200);
  assert.equal(results[0].contentType, 'image/jpeg');
});

test('probeMediaTargets: fetchImpl이 던지면 error 필드에 담기고 timedOut=false(예외 전파 안 함)', async () => {
  const fetchImpl = async () => {
    throw new Error('network down');
  };
  const results = await probeMediaTargets(
    [{ source: 'playback.hlsUrl', url: 'https://media.bapfull.com/x.mp4' }],
    { fetchImpl },
  );
  assert.equal(results[0].status, null);
  assert.match(results[0].error, /network down/);
  assert.equal(results[0].timedOut, false);
});

test('⭐ probeMediaTargets: 타임아웃(AbortError)은 timedOut=true로 구분된다', async () => {
  const fetchImpl = (url, { signal }) =>
    new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => {
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        reject(err);
      });
    });
  const results = await probeMediaTargets(
    [{ source: 'playback.hlsUrl', url: 'https://media.bapfull.com/x.mp4' }],
    { fetchImpl, timeoutMs: 20 },
  );
  assert.equal(results[0].timedOut, true);
  assert.equal(classifyReachabilityFailure(results[0]), 'timeout');
});

// ═══════════════════════════════════════════════════════════════════════════════════
// extractFeedMediaTargets / extractPlaybackMediaTargets — 순수 추출(실제 응답 스키마)
// ═══════════════════════════════════════════════════════════════════════════════════

test('extractFeedMediaTargets: thumbnailUrl이 있으면 타깃 1건 + contentId', () => {
  const result = extractFeedMediaTargets({
    items: [{ contentId: 'c1', thumbnailUrl: 'https://media.bapfull.com/c1/thumb.jpg' }],
  });
  assert.equal(result.contentId, 'c1');
  assert.deepEqual(result.targets, [
    { source: 'feed.thumbnailUrl', url: 'https://media.bapfull.com/c1/thumb.jpg', expectedContentTypePrefix: 'image/' },
  ]);
  assert.equal(result.emptyFeed, false);
});

test('extractFeedMediaTargets: thumbnailUrl 없는 항목(선택 필드)은 타깃 0건이어도 contentId는 살아있다', () => {
  const result = extractFeedMediaTargets({ items: [{ contentId: 'c1' }] });
  assert.equal(result.contentId, 'c1');
  assert.deepEqual(result.targets, []);
});

test('extractFeedMediaTargets: items가 빈 배열이면 emptyFeed=true', () => {
  const result = extractFeedMediaTargets({ items: [] });
  assert.equal(result.emptyFeed, true);
  assert.equal(result.malformed, false);
});

test('extractFeedMediaTargets: items 필드 자체가 없으면 malformed=true(스키마 드리프트 — 빈 피드와 다른 사고)', () => {
  const result = extractFeedMediaTargets({ nope: true });
  assert.equal(result.malformed, true);
  assert.equal(result.emptyFeed, false);
});

test('extractPlaybackMediaTargets: hlsUrl+posterUrl 둘 다 있으면 타깃 2건', () => {
  const result = extractPlaybackMediaTargets({
    hlsUrl: 'https://media.bapfull.com/c1/720p.mp4',
    posterUrl: 'https://media.bapfull.com/c1/thumb.jpg',
  });
  assert.equal(result.malformed, false);
  assert.deepEqual(result.targets, [
    { source: 'playback.hlsUrl', url: 'https://media.bapfull.com/c1/720p.mp4', expectedContentTypePrefix: 'video/' },
    { source: 'playback.posterUrl', url: 'https://media.bapfull.com/c1/thumb.jpg', expectedContentTypePrefix: 'image/' },
  ]);
});

test('extractPlaybackMediaTargets: hlsUrl만 있어도 정상(posterUrl은 선택)', () => {
  const result = extractPlaybackMediaTargets({ hlsUrl: 'https://media.bapfull.com/c1/720p.mp4' });
  assert.equal(result.malformed, false);
  assert.equal(result.targets.length, 1);
});

test('⭐ extractPlaybackMediaTargets: hlsUrl(필수 필드)이 없으면 malformed=true', () => {
  const result = extractPlaybackMediaTargets({ posterUrl: 'https://media.bapfull.com/c1/thumb.jpg' });
  assert.equal(result.malformed, true);
});

test('extractPlaybackMediaTargets: 본문이 객체가 아니면 malformed=true', () => {
  assert.equal(extractPlaybackMediaTargets(null).malformed, true);
  assert.equal(extractPlaybackMediaTargets('oops').malformed, true);
});

// ═══════════════════════════════════════════════════════════════════════════════════
// collectMediaTargets — feed→playback 2단계 수집(fetchImpl 주입, 네트워크 없음)
// ═══════════════════════════════════════════════════════════════════════════════════

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body, headers: { get: () => null } };
}

function makeRouterFetch(routes) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    for (const [matcher, responder] of routes) {
      const matched = typeof matcher === 'string' ? url === matcher : matcher.test(url);
      if (matched) return responder(url);
    }
    throw new Error(`no mock route for ${url}`);
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

test('collectMediaTargets: 정상 경로 — feed(썸네일) + playback(hls+poster) 합쳐 3건', async () => {
  const fetchImpl = makeRouterFetch([
    [/\/v1\/feed\?limit=1$/, () => jsonResponse(200, { items: [{ contentId: 'c1', thumbnailUrl: 'https://media.bapfull.com/c1/thumb.jpg' }] })],
    [/\/v1\/feed\/c1\/playback$/, () => jsonResponse(200, { hlsUrl: 'https://media.bapfull.com/c1/720p.mp4', posterUrl: 'https://media.bapfull.com/c1/thumb.jpg' })],
  ]);
  const result = await collectMediaTargets({ apiBaseUrl: 'https://api.bapfull.com', fetchImpl });
  assert.equal(result.feedFetchFailed, false);
  assert.equal(result.playbackFetchFailed, false);
  assert.equal(result.emptyFeed, false);
  assert.equal(result.targets.length, 3);
  assert.equal(fetchImpl.calls.length, 2);
});

test('collectMediaTargets: feed 호출 네트워크 실패면 feedFetchFailed=true', async () => {
  const fetchImpl = async () => {
    throw new Error('DNS 실패');
  };
  const result = await collectMediaTargets({ apiBaseUrl: 'https://api.bapfull.com', fetchImpl });
  assert.equal(result.feedFetchFailed, true);
  assert.match(result.feedFetchError, /DNS 실패/);
});

test('collectMediaTargets: feed가 non-2xx면 feedFetchFailed=true', async () => {
  const fetchImpl = async () => jsonResponse(500, {});
  const result = await collectMediaTargets({ apiBaseUrl: 'https://api.bapfull.com', fetchImpl });
  assert.equal(result.feedFetchFailed, true);
  assert.match(result.feedFetchError, /500/);
});

test('collectMediaTargets: 피드가 비어 있으면 emptyFeed=true이고 playback은 호출조차 안 한다', async () => {
  const fetchImpl = makeRouterFetch([[/\/v1\/feed\?limit=1$/, () => jsonResponse(200, { items: [] })]]);
  const result = await collectMediaTargets({ apiBaseUrl: 'https://api.bapfull.com', fetchImpl });
  assert.equal(result.emptyFeed, true);
  assert.equal(result.targets.length, 0);
  assert.equal(fetchImpl.calls.length, 1);
});

test('collectMediaTargets: items[0]에 contentId가 없으면 playbackFetchFailed=true(호출 자체를 못 함)', async () => {
  const fetchImpl = makeRouterFetch([[/\/v1\/feed\?limit=1$/, () => jsonResponse(200, { items: [{ thumbnailUrl: 'https://media.bapfull.com/thumb.jpg' }] })]]);
  const result = await collectMediaTargets({ apiBaseUrl: 'https://api.bapfull.com', fetchImpl });
  assert.equal(result.playbackFetchFailed, true);
  assert.equal(result.targets.length, 1); // 썸네일은 이미 얻음
  assert.equal(fetchImpl.calls.length, 1); // playback은 호출 안 됨
});

test('collectMediaTargets: playback 호출이 실패하면 playbackFetchFailed=true, 이미 얻은 feed 타깃은 유지', async () => {
  const fetchImpl = makeRouterFetch([
    [/\/v1\/feed\?limit=1$/, () => jsonResponse(200, { items: [{ contentId: 'c1', thumbnailUrl: 'https://media.bapfull.com/thumb.jpg' }] })],
    [/\/v1\/feed\/c1\/playback$/, () => jsonResponse(404, {})],
  ]);
  const result = await collectMediaTargets({ apiBaseUrl: 'https://api.bapfull.com', fetchImpl });
  assert.equal(result.playbackFetchFailed, true);
  assert.match(result.playbackFetchError, /404/);
  assert.equal(result.targets.length, 1);
});

// ═══════════════════════════════════════════════════════════════════════════════════
// judgeMediaReachability — 최종 판정(순수)
// ═══════════════════════════════════════════════════════════════════════════════════

test('judgeMediaReachability: 전부 통과하면 ok', () => {
  const verdict = judgeMediaReachability({
    targets: [
      { source: 'playback.hlsUrl', url: 'https://media.bapfull.com/c1/720p.mp4', hostFailures: [], attempted: true, status: 200, error: null, contentType: 'video/mp4', expectedContentTypePrefix: 'video/' },
    ],
  });
  assert.equal(verdict.ok, true);
  assert.equal(verdict.status, 'PASS');
  assert.equal(verdict.warnings.length, 0);
});

test('⭐ judgeMediaReachability: 대장 #169 재현 — private-host+insecure-scheme가 reason에 둘 다 나온다', () => {
  const verdict = judgeMediaReachability({
    targets: [
      {
        source: 'feed.thumbnailUrl',
        url: 'http://192.168.0.101:9000/g1/thumbnail.jpg',
        hostFailures: ['private-host', 'insecure-scheme'],
        attempted: false,
        status: null,
        error: null,
        contentType: null,
      },
    ],
  });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.status, 'FAIL');
  assert.match(verdict.reason, /private-host/);
  assert.match(verdict.reason, /insecure-scheme/);
});

test('judgeMediaReachability: feedFetchFailed면 즉시 FAIL(feed-fetch-failed)', () => {
  const verdict = judgeMediaReachability({ targets: [], feedFetchFailed: true, feedFetchError: 'timeout' });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.primaryCode, 'feed-fetch-failed');
});

test('⭐ judgeMediaReachability: 피드 0건이면 ok=true이지만 warnings에 empty-feed가 항상 남는다(규율 21 — PASS 위장 금지)', () => {
  const verdict = judgeMediaReachability({ targets: [], emptyFeed: true });
  assert.equal(verdict.ok, true);
  assert.equal(verdict.status, 'PASS');
  assert.equal(verdict.warnings.length, 1);
  assert.equal(verdict.warnings[0].code, 'empty-feed');
  assert.match(verdict.reason, /empty-feed|검사할 미디어 URL이 없어/);
});

test('judgeMediaReachability: playbackFetchFailed면 FAIL(playback-fetch-failed), 나머지 타깃도 함께 판정된다', () => {
  const verdict = judgeMediaReachability({
    targets: [
      { source: 'feed.thumbnailUrl', url: 'https://media.bapfull.com/thumb.jpg', hostFailures: [], attempted: true, status: 200, error: null, contentType: 'image/jpeg', expectedContentTypePrefix: 'image/' },
    ],
    playbackFetchFailed: true,
    playbackFetchError: 'HTTP 404',
  });
  assert.equal(verdict.ok, false);
  assert.ok(verdict.failures.some((f) => f.code === 'playback-fetch-failed'));
  // thumbnail은 그 자체로는 통과이므로 별도 failure가 없어야 한다
  assert.equal(verdict.failures.length, 1);
});

test('judgeMediaReachability: 타깃이 하나도 없는데 emptyFeed도 playbackFetchFailed도 아니면 no-media-targets 경고', () => {
  const verdict = judgeMediaReachability({ targets: [] });
  assert.equal(verdict.ok, true);
  assert.equal(verdict.warnings[0].code, 'no-media-targets');
});

// ═══════════════════════════════════════════════════════════════════════════════════
// checkMediaReachability — 전체 조립(수집→프로브→판정), fetchImpl 주입
// ═══════════════════════════════════════════════════════════════════════════════════

test('⭐ checkMediaReachability: 대장 #169 전체 재현 — 사설 호스트 URL은 미디어 GET을 아예 시도하지 않고 FAIL', async () => {
  const fetchImpl = makeRouterFetch([
    [/\/v1\/feed\?limit=1$/, () => jsonResponse(200, { items: [{ contentId: 'c1', thumbnailUrl: 'http://192.168.0.101:9000/c1/thumb.jpg' }] })],
    [/\/v1\/feed\/c1\/playback$/, () => jsonResponse(200, { hlsUrl: 'http://192.168.0.101:9000/c1/720p.mp4', posterUrl: 'http://192.168.0.101:9000/c1/thumb.jpg' })],
    // 미디어 GET 자체가 호출되면 테스트가 실패하도록 일부러 등록하지 않는다(라우트 미매치 → throw).
  ]);
  const verdict = await checkMediaReachability({ apiBaseUrl: 'https://api.bapfull.com', fetchImpl });
  assert.equal(verdict.ok, false);
  assert.equal(fetchImpl.calls.length, 2); // feed + playback만 — 미디어 3건은 호스트 판정에서 차단돼 미호출
  assert.match(verdict.reason, /private-host/);
  assert.match(verdict.reason, /insecure-scheme/);
  assert.equal(verdict.targets.length, 3);
  assert.ok(verdict.targets.every((t) => !t.ok));
});

test('checkMediaReachability: 공개 https 호스트 + 올바른 content-type이면 PASS', async () => {
  const fetchImpl = makeRouterFetch([
    [/\/v1\/feed\?limit=1$/, () => jsonResponse(200, { items: [{ contentId: 'c1', thumbnailUrl: 'https://media.bapfull.com/c1/thumb.jpg' }] })],
    [/\/v1\/feed\/c1\/playback$/, () => jsonResponse(200, { hlsUrl: 'https://media.bapfull.com/c1/720p.mp4', posterUrl: 'https://media.bapfull.com/c1/thumb.jpg' })],
    [/media\.bapfull\.com\/c1\/thumb\.jpg$/, () => ({ status: 200, headers: { get: (h) => (h === 'content-type' ? 'image/jpeg' : null) } })],
    [/media\.bapfull\.com\/c1\/720p\.mp4$/, () => ({ status: 200, headers: { get: (h) => (h === 'content-type' ? 'video/mp4' : null) } })],
  ]);
  const verdict = await checkMediaReachability({ apiBaseUrl: 'https://api.bapfull.com', fetchImpl });
  assert.equal(verdict.ok, true);
  assert.equal(verdict.status, 'PASS');
  // feed(1) + playback(1) + 미디어 3타깃(thumbnailUrl·hlsUrl·posterUrl) = 5.
  // thumbnailUrl과 posterUrl이 같은 URL 문자열이어도 타깃마다 독립적으로 프로브한다(캐시 없음 — 서명
  // URL은 만료가 있어 재사용하면 안 된다는 설계를 그대로 반영: 같은 URL이라도 두 번 진짜로 쏜다).
  assert.equal(fetchImpl.calls.length, 5);
});

test('checkMediaReachability: 공개 https이지만 403(서명 거부)이면 FAIL(forbidden)', async () => {
  const fetchImpl = makeRouterFetch([
    [/\/v1\/feed\?limit=1$/, () => jsonResponse(200, { items: [{ contentId: 'c1' }] })],
    [/\/v1\/feed\/c1\/playback$/, () => jsonResponse(200, { hlsUrl: 'https://media.bapfull.com/c1/720p.mp4' })],
    [/media\.bapfull\.com\/c1\/720p\.mp4$/, () => ({ status: 403, headers: { get: () => 'application/xml' } })],
  ]);
  const verdict = await checkMediaReachability({ apiBaseUrl: 'https://api.bapfull.com', fetchImpl });
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /forbidden/);
});

// ═══════════════════════════════════════════════════════════════════════════════════
// formatMediaVerdictLines
// ═══════════════════════════════════════════════════════════════════════════════════

test('formatMediaVerdictLines: FAIL 타깃은 ✘와 원본 코드 토큰을 함께 찍는다', () => {
  const verdict = judgeMediaReachability({
    targets: [
      { source: 'feed.thumbnailUrl', url: 'http://192.168.0.101:9000/x.jpg', hostFailures: ['private-host', 'insecure-scheme'], attempted: false, status: null, error: null, contentType: null },
    ],
  });
  const lines = formatMediaVerdictLines(verdict).join('\n');
  assert.match(lines, /✘/);
  assert.match(lines, /private-host/);
  assert.match(lines, /insecure-scheme/);
  assert.match(lines, /판정: FAIL/);
});

test('formatMediaVerdictLines: PASS 타깃은 ✔로 표기된다', () => {
  const verdict = judgeMediaReachability({
    targets: [
      { source: 'playback.hlsUrl', url: 'https://media.bapfull.com/x.mp4', hostFailures: [], attempted: true, status: 200, error: null, contentType: 'video/mp4', expectedContentTypePrefix: 'video/' },
    ],
  });
  const lines = formatMediaVerdictLines(verdict).join('\n');
  assert.match(lines, /✔/);
  assert.match(lines, /판정: PASS/);
});

test('FAILURE_LABELS: 코드 5종(호스트) + 7종(도달) 전부 라벨이 있다(누락 시 CLI 출력에 코드가 그대로 노출)', () => {
  const codes = [
    'invalid-url', 'loopback-host', 'private-host', 'internal-host', 'insecure-scheme',
    'timeout', 'request_failed', 'not_found', 'forbidden', 'server_error', 'unexpected_status', 'content_type_mismatch',
  ];
  for (const code of codes) {
    assert.equal(typeof FAILURE_LABELS[code], 'string', `${code} 라벨 누락`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════════
// CLI — 인자 검증(로컬, 네트워크 없음)
// ═══════════════════════════════════════════════════════════════════════════════════

function runCli(args) {
  try {
    const stdout = execFileSync('node', [SCRIPT_PATH, ...args], { encoding: 'utf8' });
    return { code: 0, stdout };
  } catch (err) {
    return { code: err.status ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

test('CLI: --api-url 누락이면 exit 1', () => {
  const { code, stderr } = runCli([]);
  assert.equal(code, 1);
  assert.match(stderr, /--api-url/);
});

test('CLI: 알 수 없는 인자는 exit 1', () => {
  const { code, stderr } = runCli(['--bogus']);
  assert.equal(code, 1);
  assert.match(stderr, /알 수 없는 인자/);
});

test('CLI: 잘못된 --timeout-ms는 exit 1', () => {
  const { code, stderr } = runCli(['--api-url', 'https://api.bapfull.com', '--timeout-ms', 'nope']);
  assert.equal(code, 1);
  assert.match(stderr, /timeout-ms/);
});

// ═══════════════════════════════════════════════════════════════════════════════════
// CLI --json-out (대장 #243 태스크① — deploy-rollback.mjs가 이 파일을 그대로 축 입력으로 소비)
// ⚠️ 판정 로직은 건드리지 않았다 — 이 테스트는 "이미 계산된 verdict가 그대로 파일에 적히는가"만 본다.
// ═══════════════════════════════════════════════════════════════════════════════════

// ⚠️ 함정(deploy-smoke.test.mjs와 동일 — 그 파일 300행 주석 참조): `execFileSync`(동기)로 CLI를
// 실행하면 이 테스트 프로세스의 이벤트 루프가 멈춘다 — 그런데 그 CLI 자식 프로세스가 접속하려는
// http 서버가 **같은 프로세스**(이 테스트 러너)에서 떠 있으므로, 이벤트 루프 정지 때문에 서버
// 핸들러가 전혀 실행되지 못해 자식이 타임아웃까지 응답을 못 받고 무한 대기한다(실측: 120초
// 하드타임아웃까지 걸려서야 강제 종료됐다). 비동기 `execFile`을 `await`해야 서버가 응답한다.
const execFileAsync = promisify(execFile);

async function runCliAsync(args) {
  try {
    const { stdout } = await execFileAsync('node', [SCRIPT_PATH, ...args]);
    return { code: 0, stdout };
  } catch (err) {
    return { code: err.code ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

function listenAsync(server) {
  return new Promise((resolvePromise) => {
    server.listen(0, '127.0.0.1', () => resolvePromise(server.address().port));
  });
}

function closeAsync(server) {
  return new Promise((resolvePromise) => server.close(() => resolvePromise()));
}

test('⭐ CLI --json-out: 이미 계산된 verdict를 그대로 파일에 적는다(판정 로직 무변경 확인)', async () => {
  const server = createServer((req, res) => {
    if (req.url === '/v1/feed?limit=1') {
      res.writeHead(200, { 'content-type': 'application/json' });
      // 대장 #169 실물 재현 패턴 그대로: 사설/http URL → 호스트 판정에서 즉시 FAIL(네트워크 미시도).
      res.end(JSON.stringify({ items: [{ contentId: 'c1', thumbnailUrl: 'http://127.0.0.1:1/thumb.jpg' }] }));
    } else if (req.url === '/v1/feed/c1/playback') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ hlsUrl: 'http://127.0.0.1:1/video.mp4' }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  const port = await listenAsync(server);
  const dir = mkdtempSync(join(tmpdir(), 'media-reachability-jsonout-'));
  const outPath = join(dir, 'verdict.json');
  try {
    const { code, stdout } = await runCliAsync(['--api-url', `http://127.0.0.1:${port}`, '--json-out', outPath]);
    assert.equal(code, 1, stdout); // 사설 호스트 → FAIL이 정상(이 테스트의 전제)
    const written = JSON.parse(readFileSync(outPath, 'utf8'));
    assert.equal(written.ok, false);
    assert.equal(written.status, 'FAIL');
    assert.ok(written.targets.length >= 2, 'thumbnail+hls 2타깃 이상이 기록돼야 함');
    assert.ok(
      written.failures.some((f) => (f.failureKinds ?? []).includes('loopback-host')),
      'loopback-host 실패가 기록 JSON에 그대로 남아야 함(재분류는 소비자인 deploy-rollback.mjs 몫)',
    );
  } finally {
    await closeAsync(server);
    rmSync(dir, { recursive: true, force: true });
  }
});
