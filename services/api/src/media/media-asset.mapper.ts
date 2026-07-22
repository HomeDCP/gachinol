import type {
  ContentId,
  JobId,
  MediaAsset,
  MediaAssetId,
  MediaAssetKind,
  MediaAssetStatus,
} from '@gachinol/shared';
import { toId } from '@gachinol/shared';
import type { MediaAsset as MediaAssetRow } from '@prisma/client';

/**
 * row → shared MediaAsset. owner는 ownerKind='content'만 지원(라이브 미도입).
 * sizeBytes는 BigInt|null → Number|undefined (JSON 직렬화 전 필수 변환).
 */
export const toMediaAsset = (row: MediaAssetRow): MediaAsset => ({
  id: toId<MediaAssetId>(row.id),
  owner: {
    kind: 'content',
    contentId: toId<ContentId>(row.contentId ?? ''),
  },
  kind: row.kind as MediaAssetKind,
  status: row.status as MediaAssetStatus,
  generation: row.generation,
  bucket: row.bucket,
  storageKey: row.storageKey,
  mimeType: row.mimeType,
  sizeBytes: row.sizeBytes == null ? undefined : Number(row.sizeBytes),
  durationSec: row.durationSec ?? undefined,
  width: row.width ?? undefined,
  height: row.height ?? undefined,
  bitrateKbps: row.bitrateKbps ?? undefined,
  videoCodec: row.videoCodec ?? undefined,
  audioCodec: row.audioCodec ?? undefined,
  renditionLabel: row.renditionLabel ?? undefined,
  checksumSha256: row.checksumSha256 ?? undefined,
  createdByJobId: row.createdByJobId ? toId<JobId>(row.createdByJobId) : undefined,
  createdAt: row.createdAt.toISOString(),
});
