import type { MediaAsset as MediaAssetRow } from '@prisma/client';
import { toMediaAsset } from './media-asset.mapper';

const row = (over: Partial<MediaAssetRow> = {}): MediaAssetRow => ({
  id: 'm-1',
  ownerKind: 'content',
  contentId: 'c-1',
  kind: 'preview',
  status: 'ready',
  generation: 1,
  bucket: 'gachinol-media',
  storageKey: 'contents/c-1/g1/preview.mp4',
  mimeType: 'video/mp4',
  sizeBytes: BigInt('5000000000'), // 5GB > Int 상한 — BigInt→Number 검증
  durationSec: 12,
  width: 640,
  height: 360,
  bitrateKbps: 600,
  videoCodec: 'h264',
  audioCodec: 'aac',
  renditionLabel: 'preview-360p',
  checksumSha256: 'abc',
  createdByJobId: 'preview:c-1:g1',
  createdAt: new Date('2026-07-22T00:00:00.000Z'),
  // 공개 사본 기록(T-W2-33) — 내부 운영 필드라 wire(MediaAsset)로는 노출되지 않는다
  publicBucket: null,
  publicKey: null,
  publicCopiedAt: null,
  ...over,
});

describe('toMediaAsset', () => {
  it('owner=content 판별 유니언·BigInt sizeBytes→Number·ISO createdAt', () => {
    const asset = toMediaAsset(row());
    expect(asset.owner).toEqual({ kind: 'content', contentId: 'c-1' });
    expect(asset.sizeBytes).toBe(5_000_000_000);
    expect(typeof asset.sizeBytes).toBe('number');
    expect(asset.createdAt).toBe('2026-07-22T00:00:00.000Z');
    expect(asset.renditionLabel).toBe('preview-360p');
  });

  it('sizeBytes null → undefined (JSON 직렬화 안전)', () => {
    const asset = toMediaAsset(row({ sizeBytes: null }));
    expect(asset.sizeBytes).toBeUndefined();
  });
});
