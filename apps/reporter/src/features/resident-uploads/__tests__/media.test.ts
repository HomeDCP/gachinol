import type { MediaAsset, MediaAssetId } from '@gachinol/shared';
import { formatBytes, selectOriginalAsset } from '../media';

function asset(over: Partial<MediaAsset> = {}): MediaAsset {
  return {
    id: 'asset-1' as MediaAssetId,
    owner: { kind: 'content', contentId: 'content-1' as never },
    kind: 'original',
    status: 'ready',
    generation: 1,
    storageKey: 'contents/content-1/g1/original.mp4',
    mimeType: 'video/mp4',
    createdAt: '2026-08-01T00:00:00.000Z',
    ...over,
  };
}

describe('selectOriginalAsset — 서버 findOriginal 미러', () => {
  test('original 자산이 없으면 null', () => {
    expect(selectOriginalAsset([])).toBeNull();
    expect(selectOriginalAsset([asset({ kind: 'preview' })])).toBeNull();
  });

  test('original 1건이면 그것을 고른다', () => {
    const a = asset();
    expect(selectOriginalAsset([a])).toBe(a);
  });

  test('failed 상태 original은 배제한다 — 심지어 가장 최신이어도', () => {
    // failed가 ready보다 뒤(최신)다: status 필터를 지우고 "최신 createdAt 우선" 정렬만 남겨도
    // 우연히 같은 답(ready)이 나오면 이 테스트가 그 필터의 존재를 증명하지 못한다(qa-verifier 결함③).
    // 그래서 failed를 일부러 더 최신으로 둬 필터가 실제로 판별력을 갖도록 한다.
    const ready = asset({
      id: 'a1' as MediaAssetId,
      status: 'ready',
      createdAt: '2026-08-01T00:00:00.000Z',
    });
    const failed = asset({
      id: 'a2' as MediaAssetId,
      status: 'failed',
      createdAt: '2026-08-02T00:00:00.000Z',
    });
    expect(selectOriginalAsset([failed, ready])).toBe(ready);
    expect(selectOriginalAsset([ready, failed])).toBe(ready);
  });

  test('original이 2건 이상이면 최신 createdAt을 고른다(재발급 잔존분 대비)', () => {
    const older = asset({ id: 'a1' as MediaAssetId, createdAt: '2026-08-01T00:00:00.000Z' });
    const newer = asset({ id: 'a2' as MediaAssetId, createdAt: '2026-08-02T00:00:00.000Z' });
    expect(selectOriginalAsset([older, newer])).toBe(newer);
    expect(selectOriginalAsset([newer, older])).toBe(newer);
  });

  test('preview·thumbnail 등 다른 kind는 무시한다', () => {
    const original = asset({ id: 'a1' as MediaAssetId });
    const preview = asset({ id: 'a2' as MediaAssetId, kind: 'preview' });
    const thumb = asset({ id: 'a3' as MediaAssetId, kind: 'thumbnail' });
    expect(selectOriginalAsset([preview, thumb, original])).toBe(original);
  });
});

describe('formatBytes', () => {
  test('null이면 미상 문구', () => {
    expect(formatBytes(null)).toBe('크기 미상');
  });

  test('1024 미만은 B 단위', () => {
    expect(formatBytes(500)).toBe('500 B');
  });

  test('KB·MB·GB로 승격', () => {
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(formatBytes(3 * 1024 * 1024 * 1024)).toBe('3.0 GB');
  });
});
