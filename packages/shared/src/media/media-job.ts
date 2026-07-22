import type { JobType, JobPayloadMap } from '../job/job';
import type { MediaAssetKind } from './media-asset';

/**
 * BullMQ 미디어 큐 wire 계약 — api(생산자·QueueEvents)와 media-worker(Worker)의 단일 원천.
 *
 * `Job` 애그리거트(도메인/DB 모델, `JobBase & {type,payload}`)와 구분되는 '큐 wire' 계약이다.
 * worker는 DB가 없으므로 payload(assetId만)만으로는 부족 → api가 스토리지 좌표(source/output)를
 * job.data에 실어 보낸다. payload는 shared JobPayloadMap을 **재사용**(재정의 금지).
 */

/** 미디어 큐 이름 — api Queue/QueueEvents와 worker Worker가 공유 */
export const MEDIA_QUEUE_NAME = 'media' as const;
export type MediaQueueName = typeof MEDIA_QUEUE_NAME;

/** 이번 슬라이스에서 미디어 워커가 처리하는 잡 타입 (JobType의 부분집합) */
export const MEDIA_JOB_TYPES = ['transcode', 'preview', 'thumbnail'] as const;
export type MediaJobType = Extract<JobType, 'transcode' | 'preview' | 'thumbnail'>;

/** S3 오브젝트 좌표 */
export interface S3ObjectRef {
  bucket: string;
  key: string;
}

/**
 * BullMQ 잡의 data 계약 (job.name = MediaJobType, job.data = MediaJobData<T>).
 * worker는 `job.name === '...'` 분기만으로 payload가 좁혀진다 — 캐스팅 금지.
 */
export interface MediaJobData<T extends MediaJobType = MediaJobType> {
  /** = BullMQ job.name (소비자 분기 키) */
  type: T;
  /** shared 도메인 payload 재사용 (재정의 금지) */
  payload: JobPayloadMap[T];
  /** enqueue 시점 Content.generation (산출물 세대 정합) */
  generation: number;
  /** 읽을 원본 좌표 (항상 original 자산) */
  source: S3ObjectRef;
  /** 산출물 버킷 */
  outputBucket: string;
  /** 반드시 'contents/{contentId}/g{n}/'. worker는 이 하위에만 write */
  outputKeyPrefix: string;
}

/** type으로 좁혀지는 판별 유니언 (worker 분기용) */
export type MediaJobOf<T extends MediaJobType = MediaJobType> = T extends MediaJobType
  ? MediaJobData<T>
  : never;

/**
 * worker가 산출한 미디어 오브젝트 1건 서술자 — MediaAsset의 '물리 산출' 부분집합.
 * id/owner/status/createdByJobId/createdAt/generation은 api가 부여(worker 무관).
 * checksumSha256는 **필수**(B2B 무결성 — worker가 항상 계산).
 */
export interface ProducedAsset {
  kind: MediaAssetKind;
  bucket: string;
  /** outputKeyPrefix + 파일명 */
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  checksumSha256: string;
  durationSec?: number;
  width?: number;
  height?: number;
  bitrateKbps?: number;
  videoCodec?: string;
  audioCodec?: string;
  /** '720p' · 'preview-360p' 등 */
  renditionLabel?: string;
}

/**
 * MediaJobType별 리턴 계약 (worker→api, job.returnvalue). 이번 슬라이스는 3종만 실사용.
 * transcode는 MVP에서 rendition 1개(720p)이나 다해상도 확장 대비 배열.
 */
export interface JobResultMap {
  transcode: { assets: readonly ProducedAsset[] };
  preview: { asset: ProducedAsset };
  thumbnail: { asset: ProducedAsset };
}

/** type으로 좁혀지는 판별 리턴 (api QueueEvents completed 소비자용) */
export type JobResultOf<T extends MediaJobType = MediaJobType> = JobResultMap[T];

/** 결정적 jobId — 동일 (type, contentId, generation)의 중복 인큐 dedup. api·worker·테스트 공유 */
export const mediaJobId = (type: MediaJobType, contentId: string, generation: number): string =>
  `${type}:${contentId}:g${generation}`;

/** 산출물 key 접두 규약 — 'contents/{contentId}/g{n}/' (MediaAsset storageKey 규약) */
export const mediaOutputKeyPrefix = (contentId: string, generation: number): string =>
  `contents/${contentId}/g${generation}/`;

/** 원본 자산 key 규약 — 'contents/{contentId}/g1/original.{ext}' (원본은 항상 g1) */
export const originalStorageKey = (contentId: string, ext: string): string =>
  `contents/${contentId}/g1/original.${ext.replace(/^\.+/, '')}`;
