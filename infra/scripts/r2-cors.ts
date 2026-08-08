/**
 * infra/scripts/r2-cors.ts
 *
 * R2·MinIO 버킷 CORS 정책(PUT/GET 오리진 화이트리스트) 적용 스크립트.
 * (T-W0-02, 원천: docs/plan/02-web-architecture.md §D-T4 · §E 체크리스트 3번)
 *
 * 배경: 웹 피벗으로 업로드가 브라우저 fetch/XHR presigned PUT이 된다(D-T4 1단계) — 버킷에 CORS가
 * 없으면 프리플라이트가 막혀 업로드가 아예 불가능하다. 재생(GET, hls.js/<video> Range 요청)도 동일.
 *
 * 대상 구분(중요 — EXEC-DECISIONS #12):
 *  - Cloudflare R2: 표준 S3 `PutBucketCors`(버킷 단위)를 지원한다 — 이 스크립트의 1차 대상.
 *    단, R2는 AllowedHeaders에 와일드카드(`*`)를 넣으면 프리플라이트가 깨지는 알려진 이슈가 있어
 *    기본값은 명시적 헤더 목록(`content-type,range`)을 쓴다 — 필요 시 S3_CORS_ALLOWED_HEADERS로 조정.
 *  - MinIO: **Community Edition(이 리포의 로컬 이미지 `minio/minio:latest`)은 버킷 단위 CORS
 *    (`PutBucketCors`/`mc cors set`)를 지원하지 않는다** — AIStor(유료) 전용 기능이며, 커뮤니티판은
 *    "A header you provided implies functionality that is not implemented"(NotImplemented)로 실패한다
 *    (2026-08-08 실측 확인, 로컬 도커 MinIO 대상). 로컬 MinIO의 CORS는 이 스크립트가 아니라
 *    `infra/docker-compose.yml`의 `MINIO_API_CORS_ALLOW_ORIGIN`(서버 전역 오리진 화이트리스트, 메서드/헤더는
 *    제한하지 않음 — 실제 작업 제한은 presigned URL 서명 자체가 담당)이 담당한다.
 *    이 스크립트를 MinIO Community에 대고 실행하면 크래시 대신 그 사실을 안내하고 종료 코드 2로 끝난다.
 *
 * 신규 npm 의존성 없음 — `services/api`가 이미 쓰는 `@aws-sdk/client-s3`를 그대로 재사용한다
 * (모노레포 워크스페이스라 이 파일은 자체 node_modules가 없다 — 아래 "사용" 커맨드로 실행하면
 * tsx가 자신의 설치 위치를 기준으로 의존성을 해석해 별도 조치 없이 resolve된다. 실측 확인됨).
 *
 * 사용 (리포 루트에서):
 *   pnpm --filter @gachinol/api exec tsx ../../infra/scripts/r2-cors.ts [--dry-run] [--get]
 *
 * 플래그:
 *   --dry-run   적용할 CORSRule만 출력하고 실제 PutBucketCors 호출은 하지 않는다
 *   --get       현재 버킷에 설정된 CORSRules를 조회만 한다(적용 없음)
 *
 * 필요 env(리포 루트 .env가 있으면 자동 로드 — 셸에 이미 설정된 값이 우선):
 *   S3_ENDPOINT / S3_REGION / S3_BUCKET / S3_ACCESS_KEY / S3_SECRET_KEY / S3_FORCE_PATH_STYLE
 *     — 기존 services/api S3Service와 동일 키(§5 "R2 전환은 env 교체로 성립"). R2 사용 시 이 값들을
 *       R2 계정 값으로 교체하면 된다(코드 무변경).
 *   S3_CORS_ALLOWED_ORIGINS (신규, 필수) — 콤마 구분 오리진 화이트리스트.
 *   S3_CORS_ALLOWED_HEADERS (신규, 선택, 기본 "content-type,range")
 *   S3_CORS_MAX_AGE_SEC     (신규, 선택, 기본 3600)
 */

import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  S3Client,
  PutBucketCorsCommand,
  GetBucketCorsCommand,
  type CORSRule,
} from '@aws-sdk/client-s3';

// ── .env 로드 (services/api/scripts/prisma-with-env.mjs와 동일 관례 — 신규 의존성 없이 Node 내장
//    process.loadEnvFile 사용, 이미 설정된 셸 env는 덮어쓰지 않는다) ──
const here = dirname(fileURLToPath(import.meta.url)); // infra/scripts
const rootEnvPath = resolve(here, '../../.env');
if (existsSync(rootEnvPath)) {
  process.loadEnvFile(rootEnvPath);
}

const ALLOWED_METHODS = ['GET', 'PUT', 'HEAD'] as const; // AC 범위: PUT(업로드)·GET(재생/프리뷰) + 무해한 HEAD 동반

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`[r2-cors] 필수 환경변수 누락: ${name}`);
    process.exit(1);
  }
  return v;
}

function parseList(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseOrigins(): string[] {
  const origins = parseList(process.env.S3_CORS_ALLOWED_ORIGINS);
  if (origins.length === 0) {
    console.error(
      '[r2-cors] S3_CORS_ALLOWED_ORIGINS 미설정 — 오리진 화이트리스트 없이는 적용할 수 없습니다.\n' +
        '  .env.example 참고: 콤마 구분 오리진 목록(예: http://localhost:8081,https://watch.<도메인>)',
    );
    process.exit(1);
  }
  return origins;
}

function parseHeaders(): string[] {
  const headers = parseList(process.env.S3_CORS_ALLOWED_HEADERS);
  // R2는 AllowedHeaders 와일드카드('*')에서 프리플라이트가 깨지는 알려진 이슈가 있어 명시 헤더가 기본값
  return headers.length > 0 ? headers : ['content-type', 'range'];
}

function buildClient(): S3Client {
  const endpoint = process.env.S3_ENDPOINT;
  const region = process.env.S3_REGION ?? 'ap-northeast-2';
  const forcePathStyle = (process.env.S3_FORCE_PATH_STYLE ?? 'true') !== 'false';
  const accessKeyId = requireEnv('S3_ACCESS_KEY');
  const secretAccessKey = requireEnv('S3_SECRET_KEY');
  return new S3Client({
    region,
    ...(endpoint ? { endpoint } : {}),
    forcePathStyle,
    credentials: { accessKeyId, secretAccessKey },
  });
}

function isNotImplemented(e: unknown): boolean {
  const err = e as { name?: string; message?: string } | undefined;
  return (
    err?.name === 'NotImplemented' ||
    (typeof err?.message === 'string' && err.message.toLowerCase().includes('not implemented'))
  );
}

function isNoSuchCors(e: unknown): boolean {
  const err = e as { name?: string } | undefined;
  return err?.name === 'NoSuchCORSConfiguration';
}

function reportNotImplemented(): void {
  console.error(
    '[r2-cors] 버킷 단위 CORS(PutBucketCors/GetBucketCors)가 이 엔드포인트에서 지원되지 않습니다' +
      '(NotImplemented).\n' +
      '  이는 MinIO Community Edition의 알려진 제약입니다(버킷 단위 CORS는 AIStor 유료 전용 —\n' +
      '  2026-08-08 실측: `mc cors set` 동일 실패). 로컬 MinIO의 CORS는 이 스크립트가 아니라\n' +
      '  infra/docker-compose.yml의 MINIO_API_CORS_ALLOW_ORIGIN(서버 전역 화이트리스트)이 담당합니다.\n' +
      '  → 이 스크립트는 Cloudflare R2(및 CORS를 지원하는 실 S3 호환 스토리지) 대상입니다.\n' +
      '  주의: 이 오류가 MinIO에서 뜨는 것은 예상된 동작이며, R2 도달을 검증하지 않습니다.',
  );
}

async function printCurrent(client: S3Client, bucket: string): Promise<void> {
  try {
    const out = await client.send(new GetBucketCorsCommand({ Bucket: bucket }));
    console.log('[r2-cors] 현재 CORSRules:');
    console.log(JSON.stringify(out.CORSRules ?? [], null, 2));
  } catch (e) {
    if (isNoSuchCors(e)) {
      console.log('[r2-cors] 현재 CORS 설정 없음');
      return;
    }
    if (isNotImplemented(e)) {
      reportNotImplemented();
      process.exit(2);
    }
    console.error('[r2-cors] CORS 조회 실패:', e instanceof Error ? e.message : e);
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const dryRun = args.has('--dry-run');
  const getOnly = args.has('--get');

  const client = buildClient();
  const bucket = process.env.S3_BUCKET ?? 'gachinol-media';

  console.log(
    `[r2-cors] 대상: endpoint=${process.env.S3_ENDPOINT ?? '(미설정 — AWS 기본 S3 엔드포인트)'} bucket=${bucket}`,
  );

  if (getOnly) {
    await printCurrent(client, bucket);
    return;
  }

  const corsRule: CORSRule = {
    AllowedOrigins: parseOrigins(),
    AllowedMethods: [...ALLOWED_METHODS],
    AllowedHeaders: parseHeaders(),
    ExposeHeaders: ['ETag', 'Content-Range', 'Accept-Ranges', 'Content-Length'],
    MaxAgeSeconds: Number(process.env.S3_CORS_MAX_AGE_SEC ?? 3600),
  };

  console.log('[r2-cors] 적용할 CORSRule:');
  console.log(JSON.stringify(corsRule, null, 2));

  if (dryRun) {
    console.log('[r2-cors] --dry-run: 실제 적용 없이 종료');
    return;
  }

  try {
    await client.send(
      new PutBucketCorsCommand({
        Bucket: bucket,
        CORSConfiguration: { CORSRules: [corsRule] },
      }),
    );
  } catch (e) {
    if (isNotImplemented(e)) {
      reportNotImplemented();
      process.exit(2);
    }
    console.error('[r2-cors] CORS 적용 실패:', e instanceof Error ? e.message : e);
    process.exit(1);
  }

  console.log('[r2-cors] 적용 완료. 확인 중...');
  await printCurrent(client, bucket);
}

main().catch((e) => {
  console.error('[r2-cors] 예기치 못한 오류:', e);
  process.exit(1);
});
