#!/usr/bin/env node
/**
 * infra/scripts/verify-deployed-sha.mjs
 *
 * 배포 후 SHA 대조(대장 #186) — "배포된 것이 어느 커밋인가"를 CI 안에서 fail-closed로 확인한다.
 * `.github/workflows/deploy-web.yml`의 `deploy` 잡 마지막 스텝이 이 스크립트를 호출한다.
 *
 * ── 대상(kind) ──────────────────────────────────────────────────────────────
 *   web: 본문에서 `<meta name="build-sha" content="...">`를 파싱(infra/docker/inject-build-sha.mjs가 주입).
 *   api: 본문을 JSON으로 파싱해 `.sha` 필드를 읽는다(services/api `GET /health/version`).
 *
 * ── 사용법 ──────────────────────────────────────────────────────────────────
 *   node verify-deployed-sha.mjs --kind web --expect <SHA> --url https://example.com/
 *   node verify-deployed-sha.mjs --kind api --expect <SHA> --url https://api.example.com/health/version
 *   node verify-deployed-sha.mjs --kind web --expect <SHA> --body-file ./web-entry.html
 *   node verify-deployed-sha.mjs --kind api --expect <SHA> --body-file ./version.json
 *
 * `--url`(fetch로 직접 조회) · `--body-file`(이미 받아둔 본문을 읽음) 중 하나가 필요하다.
 * CI(deploy-web.yml)는 러너에서 제온 web 포트로 직접 HTTP가 가는지 미확인이므로, SSH로 이미 받아온
 * 본문을 파일에 적어 `--body-file`로 넘기는 경로를 쓴다.
 *
 * ── fail-closed ─────────────────────────────────────────────────────────────
 * 불일치·미검출·파싱 실패·요청 실패 → 전부 exit 1. 성공만 exit 0. "조용한 통과"를 만들지 않는다.
 */
import { readFileSync } from 'node:fs';

/**
 * 본문에서 SHA를 뽑아내는 순수 함수. 실패(미검출·파싱 실패)는 `null`을 반환한다 — 예외를 던지지
 * 않는다(호출자가 fail-closed 메시지를 통일해서 낼 수 있도록).
 *
 * @param {'web'|'api'} kind
 * @param {string} body
 * @returns {string|null}
 */
export function extractSha(kind, body) {
  if (typeof body !== 'string') return null;

  if (kind === 'web') {
    // `<meta name="build-sha" content="...">` — 속성 순서·대소문자·따옴표 종류에 관계없이 매칭한다
    // (inject-build-sha.mjs가 항상 `name` 먼저 쓰지만, 이 스크립트는 그 순서에 기대지 않는다).
    const metaTags = body.match(/<meta\b[^>]*>/gi) ?? [];
    for (const tag of metaTags) {
      const nameMatch = tag.match(/\bname\s*=\s*(["'])build-sha\1/i);
      if (!nameMatch) continue;
      const contentMatch = tag.match(/\bcontent\s*=\s*(["'])(.*?)\1/i);
      if (!contentMatch) return null; // name은 있는데 content 속성이 없음 — 미검출로 취급
      return contentMatch[2];
    }
    return null; // build-sha meta 자체가 없음
  }

  if (kind === 'api') {
    let json;
    try {
      json = JSON.parse(body);
    } catch {
      return null;
    }
    if (json === null || typeof json !== 'object' || Array.isArray(json)) return null;
    if (typeof json.sha !== 'string') return null; // sha 필드 부재(또는 문자열이 아님)
    return json.sha;
  }

  throw new Error(`알 수 없는 --kind: ${kind} (web|api만 지원)`);
}

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--kind':
        opts.kind = argv[++i];
        break;
      case '--expect':
        opts.expect = argv[++i];
        break;
      case '--url':
        opts.url = argv[++i];
        break;
      case '--body-file':
        opts.bodyFile = argv[++i];
        break;
      default:
        throw new Error(`알 수 없는 인자: ${arg}`);
    }
  }
  return opts;
}

async function loadBody(opts) {
  if (opts.bodyFile) {
    return readFileSync(opts.bodyFile, 'utf8'); // 실패 시 예외 — 호출부에서 fail-closed 처리
  }
  const res = await fetch(opts.url);
  if (!res.ok) {
    throw new Error(`요청 실패: ${opts.url} → HTTP ${res.status}`);
  }
  return res.text();
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
    return;
  }

  if (opts.kind !== 'web' && opts.kind !== 'api') {
    console.error('필수 인자 누락/오류: --kind web|api');
    process.exitCode = 1;
    return;
  }
  if (!opts.expect) {
    console.error('필수 인자 누락: --expect <SHA>');
    process.exitCode = 1;
    return;
  }
  if (!opts.url && !opts.bodyFile) {
    console.error('필수 인자 누락: --url 또는 --body-file 중 하나');
    process.exitCode = 1;
    return;
  }

  let body;
  try {
    body = await loadBody(opts);
  } catch (err) {
    console.error(`본문 로드 실패(kind=${opts.kind}): ${err.message}`);
    process.exitCode = 1;
    return;
  }

  let actual;
  try {
    actual = extractSha(opts.kind, body);
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
    return;
  }

  if (actual === null || actual === undefined || actual === '') {
    console.error(`SHA 미검출(kind=${opts.kind}) — 파싱 실패 또는 필드 부재. 기대값: ${opts.expect}`);
    process.exitCode = 1;
    return;
  }

  if (actual !== opts.expect) {
    console.error(`SHA 불일치(kind=${opts.kind}): 기대=${opts.expect} 실제=${actual}`);
    process.exitCode = 1;
    return;
  }

  console.log(`SHA 일치 확인(kind=${opts.kind}): ${actual}`);
}

const isMainModule = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  main();
}
