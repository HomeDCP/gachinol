import type { MediaAsset } from '@gachinol/shared';
import { MediaAssetKind, MediaAssetStatus } from '@gachinol/shared';

/**
 * 원본 자산 선택 — 서버 `MediaAssetsService.findOriginal`(services/api/src/media/media-assets.service.ts)의
 * 판정을 읽기 전용으로 미러한다: kind='original' · failed 제외 · 최신 createdAt 우선.
 * 검수 전 콘텐츠(origin='resident_link', status='uploaded')는 트랜스코딩이 아직 안 돌아 원본 1건만
 * 있는 게 정상이지만, 재발급으로 같은 세대에 행이 2건 이상 남는 경로가 이론상 있어(그쪽 주석 참조)
 * 여기서도 서버와 같은 결정적 규칙을 쓴다 — 다른 규칙을 쓰면 화면이 승인 전 확인한 영상과
 * 서버가 실제로 트랜스코딩할 영상이 어긋날 수 있다.
 */
export function selectOriginalAsset(assets: readonly MediaAsset[]): MediaAsset | null {
  const candidates = assets.filter(
    (a) => a.kind === MediaAssetKind.Original && a.status !== MediaAssetStatus.Failed,
  );
  if (candidates.length === 0) return null;
  return [...candidates].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0] ?? null;
}

/** 바이트 → 사람이 읽는 크기. null = 서버가 아직 실측하지 못한 건(완료 통지 실패 등) */
export function formatBytes(bytes: number | null): string {
  if (bytes === null) return '크기 미상';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'] as const;
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}
