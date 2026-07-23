import type { LiveSessionStatus } from '@gachinol/shared';

/** 라이브 상태 라벨 (구독자 시점) — satisfies Record로 전수 강제 */
export const LIVE_STATUS_LABEL = {
  scheduled: '방송 예정',
  preparing: '방송 준비중',
  live: '방송중',
  interrupted: '일시 중단',
  ended: '방송 종료',
  canceled: '취소됨',
} as const satisfies Record<LiveSessionStatus, string>;

/** 시청자에게 노출되는 상태(공개 목록에 실리는 4종). live=강조 */
export function isOnAir(status: LiveSessionStatus): boolean {
  return status === 'live';
}

/** 시청자 수 — 0/음수/NaN 방어. '1,234명' */
export function formatViewerCount(total: number): string {
  const n = Number.isFinite(total) && total > 0 ? Math.floor(total) : 0;
  return `${n.toLocaleString('ko-KR')}명`;
}

/** 채팅 시각 — 'HH:MM' (24시간). 파싱 실패 시 빈 문자열 */
export function formatChatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}
