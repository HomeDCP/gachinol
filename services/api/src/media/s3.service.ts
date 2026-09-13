import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CopyObjectCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { MULTIPART_PART_SIZE_BYTES } from '@gachinol/shared';
import { DomainException } from '../common/errors/domain.exception';
import type { Env } from '../config/env.schema';

export interface PresignResult {
  url: string;
  /** ISO8601 만료 시각 */
  expiresAt: string;
}

export interface HeadResult {
  sizeBytes: number;
  contentType?: string;
}

/**
 * 멀티파트 파트 크기 — **단일 원천은 `@gachinol/shared`**(대장 #211 보완, 2026-09-13).
 * 값·근거(Cloudflare 100MiB 실측 대비 34% 여유)는 shared `content/dto.ts`의 주석을 참조 —
 * 여기서는 재정의하지 않고 재수출만 한다(기존 `import { MULTIPART_PART_SIZE_BYTES } from
 * './s3.service'` 소비처(`s3.service.spec.ts` 등)가 무변경으로 계속 동작하도록).
 * `CreateMultipartUploadRequest`에 파트 크기 필드가 없는 이유는 여전히 유효하다 — 클라가 파트
 * 크기를 정하게 두면 100MiB 이상을 요청해 #211 결함을 재현할 수 있으므로 서버가 강제한다.
 */
export { MULTIPART_PART_SIZE_BYTES };

/** S3 규약 — 마지막 파트를 제외한 모든 파트는 최소 5MiB */
export const MULTIPART_MIN_PART_SIZE_BYTES = 5 * 1024 * 1024;

/** S3 규약 — 업로드 하나당 파트 수 상한 */
export const MULTIPART_MAX_PART_COUNT = 10_000;

export interface MultipartPlanPart {
  /** 1부터 시작하는 연속 정수(S3 규약) */
  partNumber: number;
  /** 이 파트가 담아야 할 바이트 수(마지막 파트는 나머지) */
  sizeBytes: number;
}

export interface MultipartPlan {
  /** 마지막 파트를 제외한 파트 크기 */
  partSizeBytes: number;
  parts: readonly MultipartPlanPart[];
}

/**
 * 총 바이트 수를 파트로 분할한다 — 순수 함수(네트워크·S3 호출 없음, D1 단위 테스트 대상).
 * `partSizeBytes`는 항상 `MULTIPART_MIN_PART_SIZE_BYTES` 이상이어야 하며(S3 규약),
 * 결과 파트 수가 `MULTIPART_MAX_PART_COUNT`를 넘으면 거부한다(5GB 상한 ÷ 64MiB ≈ 80파트로
 * 실사용 범위에서는 절대 닿지 않지만, 방어적으로 유지한다).
 */
export function planMultipartUpload(
  totalSizeBytes: number,
  partSizeBytes: number = MULTIPART_PART_SIZE_BYTES,
): MultipartPlan {
  if (!Number.isFinite(totalSizeBytes) || totalSizeBytes <= 0) {
    throw new DomainException('validation_failed', 'sizeBytes는 0보다 커야 합니다');
  }
  if (partSizeBytes < MULTIPART_MIN_PART_SIZE_BYTES) {
    throw new DomainException(
      'internal',
      `멀티파트 파트 크기는 최소 ${MULTIPART_MIN_PART_SIZE_BYTES}바이트여야 합니다`,
    );
  }
  const partCount = Math.max(1, Math.ceil(totalSizeBytes / partSizeBytes));
  if (partCount > MULTIPART_MAX_PART_COUNT) {
    throw new DomainException(
      'validation_failed',
      `파일이 너무 커 파트 수(${partCount})가 상한(${MULTIPART_MAX_PART_COUNT})을 초과합니다`,
    );
  }
  const parts: MultipartPlanPart[] = [];
  let remaining = totalSizeBytes;
  for (let partNumber = 1; partNumber <= partCount; partNumber += 1) {
    const sizeBytes = partNumber === partCount ? remaining : partSizeBytes;
    parts.push({ partNumber, sizeBytes });
    remaining -= sizeBytes;
  }
  return { partSizeBytes, parts };
}

/**
 * S3 호환 스토리지 접근 — presign(PUT/GET) + HEAD만. api는 미디어 바이트를 스트리밍하지 않는다.
 * 자격(S3_ACCESS_KEY/SECRET) 미설정 시 각 메서드가 도메인 예외를 던져 업로드 기능만 비활성
 * (부팅·기존 스모크·기존 스위트 무영향).
 */
@Injectable()
export class S3Service {
  private readonly logger = new Logger(S3Service.name);
  private client?: S3Client;

  constructor(private readonly config: ConfigService<Env, true>) {}

  get bucket(): string {
    return this.config.get('S3_BUCKET', { infer: true });
  }

  /** presign 발급 URL의 서명 대상 클라이언트 — 실기기용 공개 엔드포인트가 있으면 그것으로 서명 */
  private presignClient(): S3Client {
    const publicEndpoint = this.config.get('S3_PUBLIC_ENDPOINT', { infer: true });
    if (!publicEndpoint) return this.getClient();
    return this.buildClient(publicEndpoint);
  }

  private getClient(): S3Client {
    if (this.client) return this.client;
    const endpoint = this.config.get('S3_ENDPOINT', { infer: true });
    this.client = this.buildClient(endpoint);
    return this.client;
  }

  private buildClient(endpoint?: string): S3Client {
    const accessKeyId = this.config.get('S3_ACCESS_KEY', { infer: true });
    const secretAccessKey = this.config.get('S3_SECRET_KEY', { infer: true });
    if (!accessKeyId || !secretAccessKey) {
      throw new DomainException(
        'internal',
        'S3 자격이 설정되지 않아 업로드 기능을 사용할 수 없습니다 (S3_ACCESS_KEY/S3_SECRET_KEY)',
      );
    }
    return new S3Client({
      region: this.config.get('S3_REGION', { infer: true }),
      ...(endpoint ? { endpoint } : {}),
      forcePathStyle: this.config.get('S3_FORCE_PATH_STYLE', { infer: true }),
      credentials: { accessKeyId, secretAccessKey },
    });
  }

  private expiresAt(seconds: number): string {
    return new Date(Date.now() + seconds * 1000).toISOString();
  }

  async presignPut(
    key: string,
    opts: { contentType?: string; expiresIn?: number } = {},
  ): Promise<PresignResult> {
    const expiresIn =
      opts.expiresIn ?? this.config.get('S3_PRESIGN_EXPIRES_SEC', { infer: true }) ?? 900;
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ...(opts.contentType ? { ContentType: opts.contentType } : {}),
    });
    const url = await getSignedUrl(this.presignClient(), command, { expiresIn });
    return { url, expiresAt: this.expiresAt(expiresIn) };
  }

  async presignGet(key: string, opts: { expiresIn?: number } = {}): Promise<PresignResult> {
    const expiresIn =
      opts.expiresIn ?? this.config.get('DOWNLOAD_URL_TTL_SEC', { infer: true }) ?? 900;
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    const url = await getSignedUrl(this.presignClient(), command, { expiresIn });
    return { url, expiresAt: this.expiresAt(expiresIn) };
  }

  /**
   * 멀티파트 업로드 시작 — S3에 uploadId를 발급받는다(실제 오브젝트는 아직 없음).
   * ⚠️ 이 호출은 presign과 달리 **실제로 S3에 네트워크 요청**을 보낸다(presignPut/presignGet은
   * 로컬 서명 계산만) — 일반 클라이언트(비-공개 엔드포인트)로 보낸다. 공개 엔드포인트는 presign
   * 서명 대상에만 쓰인다(대장 #211 위임 지시 — presignClient는 파트 URL 발급에만 적용).
   */
  async createMultipartUpload(
    key: string,
    opts: { contentType?: string } = {},
  ): Promise<{ uploadId: string }> {
    const out = await this.getClient().send(
      new CreateMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        ...(opts.contentType ? { ContentType: opts.contentType } : {}),
      }),
    );
    if (!out.UploadId) {
      throw new DomainException('internal', '멀티파트 업로드 시작에 실패했습니다(UploadId 없음)');
    }
    return { uploadId: out.UploadId };
  }

  /**
   * 파트 1개 presigned PUT 발급 — **공개 엔드포인트(presignClient)로 서명**한다(§ presignPut과 동일
   * 규칙). 브라우저가 이 URL로 직접 파트 바이트를 PUT하므로 내부 전용 엔드포인트로 서명하면 실기기에서
   * 도달 불가(대장 #211 위임 지시가 명시적으로 경고한 함정).
   */
  async presignUploadPart(
    key: string,
    uploadId: string,
    partNumber: number,
    opts: { expiresIn?: number } = {},
  ): Promise<PresignResult> {
    const expiresIn =
      opts.expiresIn ?? this.config.get('S3_PRESIGN_EXPIRES_SEC', { infer: true }) ?? 900;
    const command = new UploadPartCommand({
      Bucket: this.bucket,
      Key: key,
      UploadId: uploadId,
      PartNumber: partNumber,
    });
    const url = await getSignedUrl(this.presignClient(), command, { expiresIn });
    return { url, expiresAt: this.expiresAt(expiresIn) };
  }

  /**
   * 멀티파트 완료 — 파트를 partNumber 오름차순으로 정렬해 CompleteMultipartUploadCommand에 싣는다
   * (클라가 보낸 순서를 신뢰하지 않음). S3가 파트 누락·ETag 불일치를 감지하면 여기서 throw —
   * 호출자(UploadService)가 이를 업로드 실패로 취급해 콘텐츠를 롤백한다(I-2).
   */
  async completeMultipartUpload(
    key: string,
    uploadId: string,
    parts: readonly { partNumber: number; eTag: string }[],
  ): Promise<void> {
    await this.getClient().send(
      new CompleteMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: {
          Parts: [...parts]
            .sort((a, b) => a.partNumber - b.partNumber)
            .map((p) => ({ PartNumber: p.partNumber, ETag: p.eTag })),
        },
      }),
    );
  }

  /**
   * 멀티파트 중단 — 진행 중인 업로드가 남긴 파트 바이트를 S3에서 정리한다.
   * S3 의미상 이미 완료·중단된 uploadId를 다시 중단해도 통상 무해(idempotent에 가깝다) —
   * 다만 호출자가 실패를 무시하고 콘텐츠 롤백을 강행할지는 UploadService가 결정한다
   * (사용자의 취소 의도는 S3 쪽 정리 성패와 무관하게 이행돼야 하므로 — 대장 #211 I-2).
   */
  async abortMultipartUpload(key: string, uploadId: string): Promise<void> {
    await this.getClient().send(
      new AbortMultipartUploadCommand({ Bucket: this.bucket, Key: key, UploadId: uploadId }),
    );
  }

  /**
   * 업로드 완료 검증 — 오브젝트 부재 시 null (uploading 교착 회피용).
   * opts.bucket 미지정 시 기본 버킷(S3_BUCKET) — 공개 렌디션 버킷 등 다른 버킷 조회 시에만 지정.
   */
  async headObject(key: string, opts: { bucket?: string } = {}): Promise<HeadResult | null> {
    try {
      const out = await this.getClient().send(
        new HeadObjectCommand({ Bucket: opts.bucket ?? this.bucket, Key: key }),
      );
      return {
        sizeBytes: Number(out.ContentLength ?? 0),
        contentType: out.ContentType,
      };
    } catch (e) {
      // 404/NotFound → 부재로 취급. 그 외(권한·네트워크)도 부재로 수렴해 사용자 재-issue 복구 유도
      const name = e instanceof Error ? e.name : String(e);
      if (name === 'NotFound' || name === 'NoSuchKey' || name.includes('404')) return null;
      this.logger.warn(`headObject 실패(${key}): ${name}`);
      return null;
    }
  }

  /**
   * 서버측 오브젝트 복사(멱등 — 같은 목적지 키로 재호출해도 덮어쓸 뿐 안전).
   * 공개 렌디션 복사(D-T8) 전용 — api는 그 외에는 바이트를 옮기지 않는다.
   *
   * **`cacheControl`/`contentType`을 주면 `MetadataDirective: 'REPLACE'`로 전환된다**(대장 #129 ⓑ).
   * S3/R2의 CopyObject는 기본(`COPY`)에서 **요청에 실린 시스템 메타데이터를 무시**하고 원본 것을
   * 그대로 승계하므로 `CacheControl`만 얹어서는 목적지에 반영되지 않는다. 반대로 `REPLACE`는
   * **원본 메타데이터를 전부 버리므로 `ContentType`을 함께 주지 않으면 `binary/octet-stream`으로
   * 떨어져 브라우저 재생이 깨진다** — 그래서 두 값은 호출부에서 항상 짝으로 넘긴다.
   *
   * ⚠️ 공개 읽기 권한(ACL)은 여기서 설정하지 않는다 — **Cloudflare R2에는 오브젝트 ACL이 없고**
   * 공개 여부는 버킷 단위 설정(커스텀 도메인 바인딩 / r2.dev 공개)으로만 정해진다. 즉 공개 서빙은
   * "공개 버킷이 이미 공개로 준비돼 있다"를 전제하며, 그 전제는 docs/infrastructure.md §4-C에 있다.
   */
  async copyObject(params: {
    sourceBucket: string;
    sourceKey: string;
    destBucket: string;
    destKey: string;
    /** 목적지 Cache-Control. 지정 시 MetadataDirective=REPLACE (contentType 동반 필수) */
    cacheControl?: string;
    /** 목적지 Content-Type. REPLACE로 원본 메타데이터가 버려지므로 반드시 명시 */
    contentType?: string;
  }): Promise<void> {
    const copySource = `${params.sourceBucket}/${encodeS3KeyForCopySource(params.sourceKey)}`;
    const replaceMetadata = Boolean(params.cacheControl ?? params.contentType);
    await this.getClient().send(
      new CopyObjectCommand({
        Bucket: params.destBucket,
        Key: params.destKey,
        CopySource: copySource,
        ...(replaceMetadata ? { MetadataDirective: 'REPLACE' as const } : {}),
        ...(params.cacheControl ? { CacheControl: params.cacheControl } : {}),
        ...(params.contentType ? { ContentType: params.contentType } : {}),
      }),
    );
  }

  /**
   * 오브젝트 삭제 — S3 의미상 부재 키 삭제도 성공(idempotent). 공개 렌디션 제거(D-T8 필수 대칭) 전용.
   * opts.bucket 미지정 시 기본 버킷(S3_BUCKET).
   */
  async deleteObject(key: string, opts: { bucket?: string } = {}): Promise<void> {
    await this.getClient().send(
      new DeleteObjectCommand({ Bucket: opts.bucket ?? this.bucket, Key: key }),
    );
  }
}

/** CopySource는 '{bucket}/{key}' 형태 + 키 세그먼트별 URI 인코딩(슬래시는 경로 구분자로 보존) */
function encodeS3KeyForCopySource(key: string): string {
  return key.split('/').map(encodeURIComponent).join('/');
}
