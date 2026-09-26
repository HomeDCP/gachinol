#!/usr/bin/env node
/**
 * infra/scripts/deploy-rollback.mjs
 *
 * 배포 자동 롤백 코어(대장 #243 태스크①) — "배포 후 검증이 실패했을 때, 나쁜 이미지가 서빙
 * 중인 채로 사람을 기다리지 않는다"를 fail-closed로 구현한다.
 *
 * ⚠️ 이 파일은 **순수 판정 + 명령 생성기**다. `.github/workflows/**`를 이 파일에서 호출하는
 * 배선은 별도 태스크(②)이며, 이 파일 자체는 SSH도 docker도 실행하지 않는다(실행은 원격에서
 * 이 파일이 만든 명령 문자열을 그대로 실행하는 것으로 끝난다 — YAML이 명령을 조립하지 않는다,
 * 아래 "plan" 절 참조).
 *
 * ── 왜 있는가 ────────────────────────────────────────────────────────────────────
 * GitHub Environment의 `required_reviewers`를 없애기로 했다(본인이 본인을 승인하는 구조라 검토가
 * 구조적으로 생기지 않는다). 자동 롤백이 그 제거의 선행 조건이다.
 *
 * ⭐ **2026-09-12 사고(대장 #215)를 구조적으로 막는다**: 수동 롤백 때 `IMAGE_TAG`를 빠뜨려
 * `${IMAGE_TAG:-latest}` 폴백이 10일 전 코드를 프로덕션에 서빙했다. `generateRollbackPlan`이
 * 만드는 명령은 **항상** `export IMAGE_TAG=...`를 포함하고, `pull`을 포함하지 않으며(`rollback-*`
 * 태그는 GHCR에 없다), `--no-deps`를 포함한다(web·cloudflared가 api에 의존).
 *
 * ── ⭐ 설계의 중심 제약: 배포는 DB 마이그레이션을 적용한다 ─────────────────────────
 * `infra/docker/docker-compose.prod.yml`의 `RUN_MIGRATIONS:-true` → `services/api/docker-entrypoint.sh`가
 * 부팅 **전** `prisma migrate deploy`를 실행한다. `migrate deploy`는 **forward-only**라 이미지를
 * 되돌려도 스키마는 되돌아가지 않는다 — 그래서 **마이그레이션이 포함된 배포에서 검증이 실패하면
 * 자동 롤백하지 않는다**(옛 코드가 새 스키마 위에 서면 더 위험하다). 대신 `escalate='schema-drift'`로
 * 사람에게 넘긴다(`decideRollback`의 최우선 규칙).
 *
 * ── 판정 축 6개 ──────────────────────────────────────────────────────────────────
 *   1. api SHA 대조 실패                                            → 롤백
 *   2. 라우트 404·5xx·음성대조 실패(readiness 포함, deploy-smoke.mjs 판정)  → 롤백
 *   3. readiness ≠200                                               → 롤백(DB 장애와 구분 불가 →
 *      known-good 복원으로 fail-safe. deploy-smoke.mjs의 judgeResults가 이미 이 축을 라우트 판정에
 *      접어 넣으므로 이 파일에서는 별도 입력을 받지 않는다 — 규칙 사본 방지)
 *   4. 워커(media-worker·ai-worker) SHA 대조 실패                    → 롤백
 *   5. 미디어 **호스트 계열**(invalid-url·loopback-host·private-host·internal-host·insecure-scheme)
 *      → 롤백(네트워크 0회 판정이라 외부 요인 개입 불가 — 결정적 오설정)
 *   6. 미디어 **도달 계열**(timeout·request_failed·server_error·forbidden·not_found·
 *      unexpected_status·content_type_mismatch·feed-fetch-failed·playback-fetch-failed)
 *      → 롤백 안 함, 경보만(일시적 블립일 수 있다 — monitor-freshness.mjs의 15분 주기가 후속 확인)
 *   (`empty-feed`는 media-reachability.mjs 계약대로 `ok:true`이며 이 파일도 실패로 보지 않는다.)
 *
 * ⚠️ **미디어 실패 코드가 위 5·6 어느 목록에도 없으면(미지) 롤백도 경보만도 아니다** — 조율자
 * 결정(2026-09-26)으로 `escalate='media-unknown-code'`(rollback=false, 잡 red)로 사람에게
 * 넘긴다. 근거·우선순위는 `classifyMediaVerdictForRollback`·`decideRollback` 주석 참조.
 *
 * ── 서브커맨드 4개 ───────────────────────────────────────────────────────────────
 *   capture  원격에서 수집한 raw 텍스트(서비스별 ref·imageId·gitSha)를 구조화 JSON으로
 *            검증·출력한다(fail-closed — 복구 지점 없는 무인 배포는 금지가 의도).
 *   decide   capture + 마이그레이션 변경 여부 + 6축 결과를 받아 rollback/escalate/reasons/plan을
 *            순수 판정한다. **CLI 자체의 exit code는 실행 성공/실패만 뜻한다** — 판정 내용의
 *            게이트 권한은 `verdict`에 있다(아래).
 *   plan     capture(+runId)에서 원격 실행용 명령 문자열을 생성한다(decide 내부에서도 이 함수를
 *            그대로 재사용 — 사본 없음).
 *   verdict  decide 결과(+선택 재검증 결과)를 받아 **CI를 실제로 막는** 최종 판정을 낸다.
 *            축 실패·롤백 수행·escalate·재검증 실패 중 하나라도 있으면 exit 1(롤백 성공을
 *            초록으로 덮지 않는다). 항상 수동 복구 런북을 함께 출력한다(대장 #215가 요구한 것 —
 *            `IMAGE_TAG` export가 포함된 완전한 수동 명령).
 *
 * ── raw 텍스트 입력 형식(capture) ─────────────────────────────────────────────────
 * 한 줄에 서비스 1개: `<service>|<ref>|<imageId>|<gitSha>` (파이프 구분, 앞뒤 공백 무시,
 * `#`으로 시작하는 줄과 빈 줄은 무시). 예:
 *   api|ghcr.io/homedcp/gachinol-api:latest|sha256:abc123...|1a2b3c4d5e6f...
 *   media-worker|ghcr.io/homedcp/gachinol-media-worker:latest|sha256:def456...|1a2b3c4d5e6f...
 *   ai-worker|ghcr.io/homedcp/gachinol-ai-worker:latest|sha256:789abc...|1a2b3c4d5e6f...
 * `ref`=`docker inspect <cid> --format '{{.Config.Image}}'`, `imageId`=`{{.Image}}`(sha256 다이제스트),
 * `gitSha`=api는 `GET /health/version`의 `.sha`, 워커는 `docker exec <cid> printenv GIT_SHA`
 * (Dockerfile 주석·build-images.yml 기존 SHA 대조 스텝과 동일 수집 경로 — 이 파일은 그 결과를
 * raw 텍스트로 모아 받을 뿐 새 수집 경로를 발명하지 않는다).
 *
 * ── 마이그레이션 변경 목록 파일 형식 ────────────────────────────────────────────────
 * 한 줄에 변경된 마이그레이션 관련 경로 1개(예: `git diff --name-only <base>..<head> --
 * services/api/prisma/migrations` 출력을 그대로 리다이렉트). 빈 줄·`#` 시작 줄은 무시.
 * **파일 자체가 없으면 판정 불능으로 fail-closed**(exit 1) — "git diff 스텝이 안 돌았다"와
 * "변경 없음"을 구분하지 못하면 스키마 드리프트 감지가 조용히 새는 지점이 된다. 빈 파일(또는
 * 무시되는 줄만 있는 파일)은 정상적으로 "변경 없음"으로 판정한다(그 git diff 명령은 항상
 * 파일을 만든다 — 매치 0건이어도).
 *
 * ── mode 승격 절차 ───────────────────────────────────────────────────────────────
 * 기본값은 `report`다. `enforce`(실제 원격 실행 대상)로 승격하려면 `DEFAULT_ROLLBACK_MODE`
 * 상수 1줄을 바꾸는 **PR**로 한다 — env var로 두지 않는다(승격 이력이 git에 남게 하기 위함,
 * 대장 #243 위임 규율).
 *
 * ── 이 파일이 실행하지 않는 것 ───────────────────────────────────────────────────
 * SSH·docker 명령 실행 0건. `plan`이 만든 명령 문자열은 이 파일 밖(원격, 사람 또는 미래의
 * 워크플로 스텝)에서 그대로 실행된다.
 */
import { readFileSync, writeFileSync } from 'node:fs';

// ═══════════════════════════════════════════════════════════════════════════════════
// 상수
// ═══════════════════════════════════════════════════════════════════════════════════

/** 항상 이 순서 — Dockerfile 3종·build-images.yml 기존 SHA 대조 스텝과 동일 순서(api → 워커 2개). */
export const REQUIRED_SERVICES = ['api', 'media-worker', 'ai-worker'];

/**
 * 기본 모드. `report`=판정·계획 생성까지만(실행 지시 없음). `enforce`로 승격하려면 이 상수를
 * 바꾸는 PR을 낸다(env var 금지 — 승격 이력을 git에 남긴다).
 */
export const DEFAULT_ROLLBACK_MODE = 'report';

export const ROLLBACK_MODES = ['report', 'plan', 'enforce'];

/** `docker compose ... up -d --no-build --no-deps <이 서비스들>` — pull 없음(rollback-* 태그는 GHCR에 없다). */
export const COMPOSE_UP_ARGS = ['api', 'media-worker', 'ai-worker'];

const COMPOSE_FILES_ARGS = ['-f', 'docker-compose.prod.yml', '-f', 'docker-compose.xeon.yml'];

// ═══════════════════════════════════════════════════════════════════════════════════
// capture — raw 텍스트 파싱 + 검증(순수)
// ═══════════════════════════════════════════════════════════════════════════════════

const GIT_SHA_RE = /^[0-9a-f]{7,40}$/i;
const IMAGE_ID_RE = /^sha256:[0-9a-f]{12,64}$/i;
/** digest 고정 참조 — `repo@sha256:<64hex>` 형태는 재태그용 `repo:tag` 파생이 불가하다. */
const DIGEST_PINNED_RE = /@sha256:[0-9a-f]{64}/i;

/**
 * raw 텍스트(`<service>|<ref>|<imageId>|<gitSha>` 줄 목록)를 파싱한다(순수, 네트워크·fs 0회).
 * @param {string} rawText
 * @returns {{raw:string, service?:string, ref?:string, imageId?:string, gitSha?:string, parseError:string|null}[]}
 */
export function parseCaptureRawText(rawText) {
  const lines = String(rawText ?? '').split('\n');
  const entries = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split('|').map((p) => p.trim());
    if (parts.length !== 4) {
      entries.push({ raw: line, parseError: `필드 4개(service|ref|imageId|gitSha) 형식이 아님: "${line}"` });
      continue;
    }
    const [service, ref, imageId, gitSha] = parts;
    entries.push({ raw: line, service, ref, imageId, gitSha, parseError: null });
  }
  return entries;
}

/**
 * 파싱된 항목들을 검증한다(순수). 3서비스(api·media-worker·ai-worker) 결손, gitSha 공백/형식
 * 이상("unknown" 포함 — Dockerfile ARG 기본값이라 빌드 스탬프 미주입 신호), digest 고정 ref,
 * imageId 형식 이상 중 하나라도 있으면 거부한다.
 * @param {ReturnType<typeof parseCaptureRawText>} entries
 * @returns {{ok:boolean, rejections:string[], services:Record<string,{ref:string,imageId:string,gitSha:string}>}}
 */
export function validateCaptureEntries(entries) {
  const rejections = [];
  const byService = new Map();

  for (const e of entries ?? []) {
    if (e.parseError) {
      rejections.push(e.parseError);
      continue;
    }
    if (!REQUIRED_SERVICES.includes(e.service)) {
      rejections.push(`알 수 없는 서비스명: "${e.service}"(허용: ${REQUIRED_SERVICES.join(', ')})`);
      continue;
    }
    if (byService.has(e.service)) {
      rejections.push(`서비스 중복: ${e.service}`);
      continue;
    }
    byService.set(e.service, e);
  }

  for (const svc of REQUIRED_SERVICES) {
    const e = byService.get(svc);
    if (!e) {
      rejections.push(`서비스 결손: ${svc}`);
      continue;
    }
    if (!e.ref) {
      rejections.push(`${svc}: ref(Config.Image)가 비었음`);
    } else if (DIGEST_PINNED_RE.test(e.ref)) {
      rejections.push(`${svc}: ref가 digest 고정 참조("${e.ref}") — 재태그용 repo:tag 파생 불가`);
    }
    if (!e.imageId || !IMAGE_ID_RE.test(e.imageId)) {
      rejections.push(`${svc}: imageId(.Image)가 비었거나 sha256 형식이 아님("${e.imageId ?? ''}")`);
    }
    if (e.gitSha && e.gitSha.toLowerCase() === 'unknown') {
      rejections.push(`${svc}: gitSha가 "unknown"(빌드 스탬프 미주입 — Dockerfile ARG 기본값)`);
    } else if (!e.gitSha || !GIT_SHA_RE.test(e.gitSha)) {
      rejections.push(`${svc}: gitSha가 비었거나 형식 이상("${e.gitSha ?? ''}")`);
    }
  }

  const services = {};
  for (const svc of REQUIRED_SERVICES) {
    const e = byService.get(svc);
    if (e) services[svc] = { ref: e.ref, imageId: e.imageId, gitSha: e.gitSha };
  }

  return { ok: rejections.length === 0, rejections, services };
}

/**
 * capture 진입점(순수) — raw 텍스트 → 구조화 JSON. `capturedAt`은 호출자가 결정적 값을 주입할 수
 * 있게 옵션으로 뺐다(테스트).
 * @param {string} rawText
 * @param {{capturedAt?:string, runId?:string|null}} [opts]
 */
export function buildCapture(rawText, { capturedAt = new Date().toISOString(), runId = null } = {}) {
  const entries = parseCaptureRawText(rawText);
  const { ok, rejections, services } = validateCaptureEntries(entries);
  return { ok, rejections, services, capturedAt, runId };
}

// ═══════════════════════════════════════════════════════════════════════════════════
// plan — 원격 명령 생성(순수) — ⭐ YAML이 명령을 조립하지 않는다, 이 함수만이 만든다
// ═══════════════════════════════════════════════════════════════════════════════════

/**
 * 이미지 참조에서 "repo부" = **마지막 `:` 앞부분**을 뽑는다(레지스트리 호스트에 포트가 있어도
 * 정확하다 — 도커 태그는 `:`를 포함하지 않으므로 가장 오른쪽 `:`가 항상 태그 구분자다).
 * `REGISTRY`를 하드코딩하지 않는다(원격 설정과 어긋날 수 있다) — 캡처한 실제 ref에서 파생한다.
 * @param {string} ref
 * @returns {string}
 */
export function deriveRepoPart(ref) {
  const idx = String(ref ?? '').lastIndexOf(':');
  if (idx === -1) return ref;
  return ref.slice(0, idx);
}

/**
 * capture(+runId)로부터 원격 실행용 명령 목록·한 줄 명령을 생성한다(순수).
 * ⭐ 2026-09-12 사고(대장 #215) 방지의 핵심: `export IMAGE_TAG=`를 반드시 포함하고, `pull`은
 * 포함하지 않으며(`rollback-*` 태그는 GHCR에 없다), `--no-deps`를 포함한다(web·cloudflared가
 * api에 의존 — 없으면 그 서비스들까지 재기동돼 불필요한 범위 확장이 생긴다).
 * @param {{ capture: ReturnType<typeof buildCapture>, runId: string }} args
 */
export function generateRollbackPlan({ capture, runId }) {
  if (!runId) {
    throw new Error('runId가 필요하다(태그 충돌 방지 — 실행 단위 식별자, 예: GitHub Actions run_id)');
  }
  if (!capture || capture.ok !== true) {
    throw new Error('capture가 유효하지 않음(ok!==true) — 복구 지점 없이는 plan을 생성할 수 없다');
  }

  const tagSuffix = `rollback-${runId}`;
  const tagCommands = REQUIRED_SERVICES.map((svc) => {
    const s = capture.services[svc];
    const repoPart = deriveRepoPart(s.ref);
    return `docker tag ${s.imageId} ${repoPart}:${tagSuffix}`;
  });
  const exportCmd = `export IMAGE_TAG=${tagSuffix}`;
  const composeCmd = `docker compose ${COMPOSE_FILES_ARGS.join(' ')} up -d --no-build --no-deps ${COMPOSE_UP_ARGS.join(' ')}`;

  const commands = [...tagCommands, exportCmd, composeCmd];
  return { runId, tagSuffix, commands, remoteCommand: commands.join(' && ') };
}

// ═══════════════════════════════════════════════════════════════════════════════════
// 마이그레이션 변경 목록 — 파싱(순수)
// ═══════════════════════════════════════════════════════════════════════════════════

/**
 * `git diff --name-only ... -- services/api/prisma/migrations` 출력 형태(한 줄 1경로,
 * 빈 줄·`#` 시작 줄 무시)를 파싱한다.
 * @param {string} content
 * @returns {string[]}
 */
export function parseMigrationsChangedFile(content) {
  return String(content ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));
}

/**
 * @param {string} content 빈 문자열(빈 파일)이면 "변경 없음"(false)이다 — **파일 자체가 없는 경우**는
 * 이 함수의 관심사가 아니다(CLI의 `readOrDie`가 그 경우를 fail-closed로 먼저 막는다, 헤더 주석
 * "마이그레이션 변경 목록 파일 형식" 절 참조). 즉 "부재"와 "빈 파일"은 서로 다른 계층에서 갈린다:
 * 부재 = CLI 실행 자체가 실패(exit 1), 빈 파일 = 이 함수가 정상적으로 false를 반환.
 */
export function hasMigrationsChanged(content) {
  return parseMigrationsChangedFile(content).length > 0;
}

// ═══════════════════════════════════════════════════════════════════════════════════
// 미디어 축 분류(순수) — media-reachability.mjs의 judgeMediaReachability() 출력을 소비한다
// (판정 로직 사본 아님 — media-reachability.mjs가 이미 계산한 failureKinds 코드만 재분류)
// ═══════════════════════════════════════════════════════════════════════════════════

/** 호스트 계열(네트워크 0회 판정) — 결정적 오설정이라 롤백 트리거. */
export const MEDIA_HOST_FAILURE_CODES = [
  'invalid-url',
  'loopback-host',
  'private-host',
  'internal-host',
  'insecure-scheme',
];

/** 도달 계열(실제 GET 결과) — 일시적 블립일 수 있어 경보만(롤백 트리거 아님). */
export const MEDIA_REACHABILITY_FAILURE_CODES = [
  'timeout',
  'request_failed',
  'not_found',
  'forbidden',
  'server_error',
  'unexpected_status',
  'content_type_mismatch',
  'feed-fetch-failed',
  'playback-fetch-failed',
];

const MEDIA_HOST_SET = new Set(MEDIA_HOST_FAILURE_CODES);
const MEDIA_REACHABILITY_SET = new Set(MEDIA_REACHABILITY_FAILURE_CODES);

/**
 * media-reachability.mjs `judgeMediaReachability()`(또는 그 CLI `--json-out`) 결과를
 * 호스트 계열/도달 계열/미지 계열로 재분류한다(순수). `null`(미검사)·`ok:true`(empty-feed 포함)는
 * 실패 없음으로 취급한다.
 *
 * ⚠️ **미지의 코드는 호스트도 도달도 아닌 별도 계열(`unknownCodes`)로만 남긴다 — 어느 쪽에도
 * 편입하지 않는다.** 조율자 결정(대장 #243, 2026-09-26)으로 방향을 명시적으로 반전했다:
 *
 * - **호스트 집합은 구조적으로 닫혀 있다** — `classifyHostFailures`는 URL·스킴 **모양**만 보고
 *   네트워크를 0회 쓴다(loopback·private·internal·insecure-scheme 5종이 전부이고, 새 코드가
 *   여기서 나올 여지가 구조적으로 작다).
 * - **도달 집합은 열려 있다** — 실제 HTTP 상태·네트워크 오류를 반영하므로 새 실패 모드(예: 새로운
 *   HTTP 상태코드 분류, 리다이렉트 루프 등)가 자연스럽게 여기서 늘어난다.
 *   → 이 비대칭 때문에 **미지 코드는 도달 계열에서 나올 확률이 압도적으로 높다**(러너→Cloudflare→
 *   MinIO 경로의 외부 요인이 지배). 그런데도 호스트 계열(롤백)로 fail-safe 처리하면, 무해할
 *   가능성이 높은 신호로 프로덕션을 되돌리는 **자동화가 스스로 사고를 만드는 형태**가 된다 —
 *   이 리포가 무인 배포로 가는 중이라 이 위험은 실질적이다.
 * - **그래서 미지 코드는 롤백도 경보도 아니라 `decideRollback`에서 `escalate='media-unknown-code'`로
 *   사람에게 넘긴다**(이 함수 자체는 `hasHostFailure`/`hasReachabilityFailure`에 영향을 주지 않고
 *   `unknownCodes`만 채운다 — 최종 판단은 호출자 몫). escalate가 잡을 red로 만들면 사람이 그 코드를
 *   호스트/도달 어느 집합에 넣을지 **분류**하게 되고, 그 순간 "미지" 상태가 사라진다(조용히
 *   롤백하거나 조용히 경보만 내면 분류가 영영 안 일어난다 — "무해하다"는 뜻이 아니라 "자동으로
 *   처방을 정할 수 없다"는 뜻이다).
 * @param {{ok:boolean, failures?:{code:string,failureKinds?:string[]}[]}|null|undefined} media
 */
export function classifyMediaVerdictForRollback(media) {
  if (!media || media.ok) {
    return { hasHostFailure: false, hasReachabilityFailure: false, hostCodes: [], reachabilityCodes: [], unknownCodes: [] };
  }
  const hostCodes = new Set();
  const reachCodes = new Set();
  const unknownCodes = new Set();
  for (const f of media.failures ?? []) {
    const codes = Array.isArray(f.failureKinds) && f.failureKinds.length > 0 ? f.failureKinds : [f.code];
    for (const c of codes) {
      if (MEDIA_HOST_SET.has(c)) hostCodes.add(c);
      else if (MEDIA_REACHABILITY_SET.has(c)) reachCodes.add(c);
      else unknownCodes.add(c); // 호스트/도달 어느 집합에도 없음 — decideRollback이 escalate로 넘긴다
    }
  }
  return {
    hasHostFailure: hostCodes.size > 0,
    hasReachabilityFailure: reachCodes.size > 0,
    hostCodes: [...hostCodes],
    reachabilityCodes: [...reachCodes],
    unknownCodes: [...unknownCodes],
  };
}

// ═══════════════════════════════════════════════════════════════════════════════════
// decide — 순수 판정
// ═══════════════════════════════════════════════════════════════════════════════════

/**
 * @typedef {{ok:boolean, reason?:string|null}} AxisOutcome
 * @typedef {{name:string, ok:boolean, reason?:string|null}} WorkerOutcome
 */

/**
 * 6축 + 마이그레이션 변경 여부를 받아 rollback/escalate/reasons/plan을 판정한다(순수).
 *
 * **우선 규칙 1(schema-drift)**: 롤백이 필요했을 것(`wouldRollback`)이고 마이그레이션 변경이
 * 있으면, 다른 축이 무엇이든 `rollback=false` + `escalate='schema-drift'`다(forward-only
 * 마이그레이션 위에서 이미지만 되돌리면 스키마 불일치로 더 위험하다 — §5-1). 마이그레이션 변경이
 * 있어도 애초에 롤백이 필요하지 않았다면(전 축 통과) escalate하지 않는다 — 되돌릴 실패가 없기
 * 때문이다.
 *
 * **우선 규칙 2(media-unknown-code)**: 미디어 판정에 호스트/도달 어느 집합에도 없는 코드가
 * 하나라도 있으면, `wouldRollback`·마이그레이션 여부와 무관하게 `rollback=false` +
 * `escalate='media-unknown-code'`다(규칙 1 다음 우선순위 — 둘 다 해당하면 규칙 1이 이긴다).
 * "무해하다"는 뜻이 아니라 "자동으로 처방을 정할 수 없다"는 뜻이다(근거는
 * `classifyMediaVerdictForRollback` 헤더 주석 — 호스트 집합은 닫혀 있고 도달 집합은 열려 있다).
 *
 * @param {{
 *   capture: ReturnType<typeof buildCapture>,
 *   migrationsChanged: boolean,
 *   axes: { apiSha: AxisOutcome, routes: AxisOutcome, workers: WorkerOutcome[], media: object|null },
 *   mode?: 'report'|'plan'|'enforce',
 *   runId: string,
 * }} args
 */
export function decideRollback({ capture, migrationsChanged, axes, mode = DEFAULT_ROLLBACK_MODE, runId }) {
  if (!capture || capture.ok !== true) {
    throw new Error('capture가 유효하지 않음(ok!==true) — 복구 지점 없이는 판정할 수 없다');
  }
  if (!ROLLBACK_MODES.includes(mode)) {
    throw new Error(`알 수 없는 mode: "${mode}"(허용: ${ROLLBACK_MODES.join(', ')})`);
  }

  const { apiSha, routes, workers = [], media = null } = axes ?? {};
  const reasons = [];
  let wouldRollback = false;

  if (!apiSha?.ok) {
    wouldRollback = true;
    reasons.push(`api SHA 대조 실패: ${apiSha?.reason ?? '(사유 미상)'}`);
  }
  if (!routes?.ok) {
    wouldRollback = true;
    reasons.push(`라우트/readiness 검증 실패: ${routes?.reason ?? '(사유 미상)'}`);
  }
  for (const w of workers) {
    if (!w.ok) {
      wouldRollback = true;
      reasons.push(`워커 SHA 대조 실패(${w.name}): ${w.reason ?? '(사유 미상)'}`);
    }
  }

  const mediaClass = classifyMediaVerdictForRollback(media);
  if (mediaClass.hasHostFailure) {
    wouldRollback = true;
    reasons.push(
      `미디어 호스트 계열 실패(네트워크 0회 판정 — 결정적 오설정): ${mediaClass.hostCodes.join(', ')}`,
    );
  }
  const mediaWarnOnly = mediaClass.hasReachabilityFailure;
  if (mediaWarnOnly) {
    reasons.push(`미디어 도달 계열 실패(경보만 — 롤백 트리거 아님): ${mediaClass.reachabilityCodes.join(', ')}`);
  }

  // ⚠️ 조율자 결정(대장 #243, 2026-09-26) — 미지의 미디어 실패 코드는 롤백도 경보만도 아니다.
  // "무해하다"는 뜻이 아니라 "자동으로 처방을 정할 수 없다"는 뜻이라 escalate로 사람에게 넘긴다
  // (classifyMediaVerdictForRollback의 헤더 주석 — 호스트 집합은 닫혀 있고 도달 집합은 열려 있다는
  // 비대칭이 근거). wouldRollback 여부와 무관하게 최우선으로 처리한다(아래 우선 규칙 참조).
  const hasUnknownMediaCode = mediaClass.unknownCodes.length > 0;
  if (hasUnknownMediaCode) {
    reasons.push(
      `미디어 실패 코드 미분류(호스트/도달 어느 집합에도 없음): ${mediaClass.unknownCodes.join(', ')}`,
    );
  }

  const anyAxisFailed = wouldRollback || mediaWarnOnly || hasUnknownMediaCode;

  if (wouldRollback && migrationsChanged) {
    reasons.push(
      '마이그레이션 변경 포함 — forward-only(prisma migrate deploy)라 이미지를 되돌려도 스키마는 ' +
        '되돌아가지 않는다. 자동 롤백 대신 사람에게 에스컬레이션한다(schema-drift).',
    );
    return { rollback: false, escalate: 'schema-drift', reasons, plan: null, mode, enforce: false, anyAxisFailed: true };
  }

  if (hasUnknownMediaCode) {
    reasons.push(
      '미디어 실패 코드를 분류하지 못해 자동 롤백 대신 사람에게 에스컬레이션한다(media-unknown-code) — ' +
        '사람이 이 코드를 media-reachability.mjs의 호스트/도달 계열 중 하나로 분류해 넣으면 다음부터는 ' +
        '자동 판정된다(그 순간 "미지" 상태가 사라진다).',
    );
    return { rollback: false, escalate: 'media-unknown-code', reasons, plan: null, mode, enforce: false, anyAxisFailed: true };
  }

  if (!wouldRollback) {
    if (reasons.length === 0) reasons.push('전 축 통과 — 롤백 불요');
    return { rollback: false, escalate: '', reasons, plan: null, mode, enforce: false, anyAxisFailed };
  }

  const plan = generateRollbackPlan({ capture, runId });
  return { rollback: true, escalate: '', reasons, plan, mode, enforce: mode === 'enforce', anyAxisFailed: true };
}

// ═══════════════════════════════════════════════════════════════════════════════════
// verdict — 최종 판정(순수) — CI를 실제로 막는 유일한 관문
// ═══════════════════════════════════════════════════════════════════════════════════

/**
 * decide 결과(+선택 재검증 결과)를 받아 최종 ok를 정한다. **롤백을 실제로 수행했다는 사실 자체가
 * 이미 실패다**(롤백 성공을 초록으로 덮지 않는다) — 재검증이 통과해도 exit는 뒤집히지 않는다.
 * @param {{ decideResult: ReturnType<typeof decideRollback>, reverify?: {ok:boolean, reason?:string}|null }} args
 */
export function computeFinalVerdict({ decideResult, reverify = null }) {
  const reasons = [...(decideResult.reasons ?? [])];
  let ok = true;

  if (decideResult.anyAxisFailed) ok = false;
  if (decideResult.rollback) ok = false;
  if (decideResult.escalate) ok = false;

  if (decideResult.rollback && reverify) {
    if (!reverify.ok) {
      ok = false;
      reasons.push(`롤백 후 재검증 실패: ${reverify.reason ?? '(사유 미상)'}`);
    } else {
      reasons.push(`롤백 후 재검증 통과: ${reverify.reason ?? '복구 지점으로 정상 서빙 확인'}`);
    }
  }

  return { ok, reasons, rollback: decideResult.rollback, escalate: decideResult.escalate, reverify };
}

/**
 * `$GITHUB_STEP_SUMMARY`용 복구 런북(대장 #215가 요구한 것) — 캡처한 3서비스 참조·GIT_SHA와
 * **`IMAGE_TAG` export가 포함된 완전한 수동 명령**을 항상 낸다(사람이 대신 조립하다 사고 재발
 * 방지). `generateRollbackPlan`을 그대로 재사용한다(사본 없음).
 * @param {{ capture: ReturnType<typeof buildCapture>, runId: string }} args
 */
export function formatRecoveryRunbook({ capture, runId }) {
  const lines = [];
  lines.push('## 수동 복구 런북 (대장 #215 방지 — IMAGE_TAG export를 반드시 포함할 것)');
  lines.push('');
  lines.push(`캡처 시각: ${capture.capturedAt}`);
  for (const svc of REQUIRED_SERVICES) {
    const s = capture.services[svc];
    lines.push(`- **${svc}**: ref=\`${s.ref}\` · imageId=\`${s.imageId}\` · GIT_SHA=\`${s.gitSha}\``);
  }
  lines.push('');
  lines.push('완전한 수동 복구 명령(순서대로 — 특히 `export IMAGE_TAG=`를 빠뜨리지 말 것):');
  lines.push('```bash');
  const plan = generateRollbackPlan({ capture, runId });
  for (const cmd of plan.commands) lines.push(cmd);
  lines.push('```');
  return lines.join('\n');
}

// ═══════════════════════════════════════════════════════════════════════════════════
// CLI
// ═══════════════════════════════════════════════════════════════════════════════════

function readOrDie(path, label) {
  try {
    return readFileSync(path, 'utf8');
  } catch (err) {
    throw new Error(`${label} 로드 실패(${path}): ${err.message}`);
  }
}

function readJsonOrDie(path, label) {
  const raw = readOrDie(path, label);
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`${label} JSON 파싱 실패(${path}): ${err.message}`);
  }
}

function writeJsonIfRequested(jsonOutPath, value) {
  if (!jsonOutPath) return;
  writeFileSync(jsonOutPath, JSON.stringify(value, null, 2));
}

function parseFlags(argv, { valued = [], boolean = [] } = {}) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (valued.includes(arg)) {
      opts[arg] = argv[++i];
    } else if (boolean.includes(arg)) {
      opts[arg] = true;
    } else {
      throw new Error(`알 수 없는 인자: ${arg}`);
    }
  }
  return opts;
}

function requireFlag(opts, flag, message) {
  if (opts[flag] === undefined) {
    throw new Error(message ?? `필수 인자 누락: ${flag}`);
  }
  return opts[flag];
}

function statusToOutcome(status, reason, label) {
  if (status !== 'ok' && status !== 'fail') {
    throw new Error(`${label}는 ok|fail 중 하나여야 함(받음: "${status}")`);
  }
  return { ok: status === 'ok', reason: reason ?? null };
}

function runCapture(argv) {
  const opts = parseFlags(argv, { valued: ['--input', '--run-id', '--json-out'] });
  const inputPath = requireFlag(opts, '--input');
  const rawText = readOrDie(inputPath, '캡처 입력');
  const capture = buildCapture(rawText, { runId: opts['--run-id'] ?? null });

  console.log('── 복구 지점 캡처(대장 #243) ──');
  if (capture.ok) {
    console.log(`판정: PASS — 3서비스 캡처 완료(${REQUIRED_SERVICES.join(', ')})`);
    for (const svc of REQUIRED_SERVICES) {
      const s = capture.services[svc];
      console.log(`  ✔ ${svc}: ref=${s.ref} imageId=${s.imageId} gitSha=${s.gitSha}`);
    }
  } else {
    console.error('판정: FAIL — 복구 지점을 신뢰할 수 없어 캡처를 거부한다(무인 배포 금지)');
    for (const r of capture.rejections) console.error(`  ✘ ${r}`);
  }

  writeJsonIfRequested(opts['--json-out'], capture);
  process.exitCode = capture.ok ? 0 : 1;
}

function runPlan(argv) {
  const opts = parseFlags(argv, { valued: ['--capture-file', '--run-id', '--json-out'] });
  const captureFile = requireFlag(opts, '--capture-file');
  const runId = requireFlag(opts, '--run-id');
  const capture = readJsonOrDie(captureFile, 'capture 파일');

  const plan = generateRollbackPlan({ capture, runId });
  console.log('── 롤백 원격 명령 생성(대장 #243) ──');
  console.log(plan.remoteCommand);

  writeJsonIfRequested(opts['--json-out'], plan);
}

function runDecide(argv) {
  const opts = parseFlags(argv, {
    valued: [
      '--capture-file',
      '--migrations-file',
      '--run-id',
      '--api-sha-status',
      '--api-sha-reason',
      '--routes-status',
      '--routes-reason',
      '--media-worker-sha-status',
      '--media-worker-sha-reason',
      '--ai-worker-sha-status',
      '--ai-worker-sha-reason',
      '--media-json',
      '--mode',
      '--json-out',
    ],
  });

  const captureFile = requireFlag(opts, '--capture-file');
  const migrationsFile = requireFlag(
    opts,
    '--migrations-file',
    '필수 인자 누락: --migrations-file (변경 없음도 빈 파일로 명시해야 한다 — fail-closed)',
  );
  const runId = requireFlag(opts, '--run-id');

  const capture = readJsonOrDie(captureFile, 'capture 파일');
  if (capture.ok !== true) {
    throw new Error('capture 파일이 ok:true가 아님 — 유효하지 않은 복구 지점으로는 판정하지 않는다');
  }

  const migrationsContent = readOrDie(migrationsFile, '마이그레이션 변경 목록 파일');
  const migrationsChanged = hasMigrationsChanged(migrationsContent);

  const apiSha = statusToOutcome(
    requireFlag(opts, '--api-sha-status'),
    opts['--api-sha-reason'],
    '--api-sha-status',
  );
  const routes = statusToOutcome(
    requireFlag(opts, '--routes-status'),
    opts['--routes-reason'],
    '--routes-status',
  );
  const workers = [
    {
      name: 'media-worker',
      ...statusToOutcome(
        requireFlag(opts, '--media-worker-sha-status'),
        opts['--media-worker-sha-reason'],
        '--media-worker-sha-status',
      ),
    },
    {
      name: 'ai-worker',
      ...statusToOutcome(
        requireFlag(opts, '--ai-worker-sha-status'),
        opts['--ai-worker-sha-reason'],
        '--ai-worker-sha-status',
      ),
    },
  ];

  let media = null;
  if (opts['--media-json']) {
    media = readJsonOrDie(opts['--media-json'], '미디어 도달성 JSON');
  }

  const mode = opts['--mode'] ?? DEFAULT_ROLLBACK_MODE;
  const decideResult = decideRollback({
    capture,
    migrationsChanged,
    axes: { apiSha, routes, workers, media },
    mode,
    runId,
  });

  console.log('── 롤백 판정(대장 #243) ──');
  console.log(`마이그레이션 변경: ${migrationsChanged ? '있음' : '없음'}`);
  console.log(`mode: ${mode}`);
  for (const r of decideResult.reasons) console.log(`  - ${r}`);
  console.log(`rollback=${decideResult.rollback} escalate=${decideResult.escalate || '(없음)'} enforce=${decideResult.enforce}`);
  if (decideResult.plan) console.log(`plan: ${decideResult.plan.remoteCommand}`);

  writeJsonIfRequested(opts['--json-out'], decideResult);
  // decide 자체의 exit code는 "실행이 성공했는가"만 뜻한다(판정 게이트 권한은 verdict에 있다).
}

function runVerdict(argv) {
  const opts = parseFlags(argv, {
    valued: [
      '--decide-file',
      '--capture-file',
      '--run-id',
      '--reverify-status',
      '--reverify-reason',
      '--summary-out',
      '--json-out',
    ],
  });

  const decideFile = requireFlag(opts, '--decide-file');
  const captureFile = requireFlag(opts, '--capture-file');
  const runId = requireFlag(opts, '--run-id');

  const decideResult = readJsonOrDie(decideFile, 'decide 결과 파일');
  const capture = readJsonOrDie(captureFile, 'capture 파일');

  let reverify = null;
  if (opts['--reverify-status'] !== undefined) {
    reverify = statusToOutcome(opts['--reverify-status'], opts['--reverify-reason'], '--reverify-status');
  }

  const finalVerdict = computeFinalVerdict({ decideResult, reverify });
  const runbook = formatRecoveryRunbook({ capture, runId });

  console.log('── 배포 최종 판정(대장 #243) ──');
  console.log(`판정: ${finalVerdict.ok ? 'PASS' : 'FAIL'}`);
  for (const r of finalVerdict.reasons) console.log(`  - ${r}`);
  console.log('');
  console.log(runbook);

  if (opts['--summary-out']) {
    writeFileSync(opts['--summary-out'], runbook);
  }
  writeJsonIfRequested(opts['--json-out'], { ...finalVerdict, runbook });

  process.exitCode = finalVerdict.ok ? 0 : 1;
}

const SUBCOMMANDS = { capture: runCapture, decide: runDecide, plan: runPlan, verdict: runVerdict };

function main() {
  const [sub, ...rest] = process.argv.slice(2);
  const handler = SUBCOMMANDS[sub];
  if (!handler) {
    console.error(`알 수 없는 서브커맨드: "${sub ?? ''}"(허용: ${Object.keys(SUBCOMMANDS).join(', ')})`);
    process.exitCode = 1;
    return;
  }
  try {
    handler(rest);
  } catch (err) {
    console.error(`실행 실패(${sub}): ${err.message}`);
    process.exitCode = 1;
  }
}

const isMainModule = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  main();
}
