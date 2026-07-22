import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { WorkerEnv } from './env';

/** worker의 S3 접근 계약 — 원본 read(파일로) · 산출물 write(파일에서) · sha256 */
export interface S3Io {
  /** bucket/key 오브젝트를 로컬 파일로 내려받음 */
  download(bucket: string, key: string, destPath: string): Promise<void>;
  /** 로컬 파일을 bucket/key로 올림 */
  upload(bucket: string, key: string, srcPath: string, contentType: string): Promise<void>;
}

/** 파일 sha256 (hex) — 산출물 무결성(B2B). worker가 항상 계산 */
export async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(path), hash);
  return hash.digest('hex');
}

/** 파일 크기(bytes) */
export async function fileSize(path: string): Promise<number> {
  const s = await stat(path);
  return s.size;
}

export function createS3Io(env: WorkerEnv): S3Io {
  const client = new S3Client({
    region: env.S3_REGION,
    endpoint: env.S3_ENDPOINT,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
    credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY },
  });

  return {
    async download(bucket, key, destPath) {
      const out = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      const body = out.Body;
      if (!body) throw new Error(`S3 오브젝트 본문 없음 (${bucket}/${key})`);
      // Node 런타임에서 Body는 Readable
      await pipeline(body as Readable, createWriteStream(destPath));
    },
    async upload(bucket, key, srcPath, contentType) {
      const size = await fileSize(srcPath);
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: createReadStream(srcPath),
          ContentType: contentType,
          ContentLength: size,
        }),
      );
    },
  };
}
