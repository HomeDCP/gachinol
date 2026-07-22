import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  HeadObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
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

  /** 업로드 완료 검증 — 오브젝트 부재 시 null (uploading 교착 회피용) */
  async headObject(key: string): Promise<HeadResult | null> {
    try {
      const out = await this.getClient().send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
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
}
