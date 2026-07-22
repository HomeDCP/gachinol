/** 날짜·재생시간 포맷 (한국어) */

/** durationSec: 0 → '0:00', n → 'm:ss'. 음수·NaN 방어 */
export function formatDuration(durationSec: number): string {
  if (!Number.isFinite(durationSec)) return '0:00';
  const total = Math.max(0, Math.floor(durationSec));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** 상대 시간 — 피드 카드용 */
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const diffMs = now.getTime() - d.getTime();
  if (diffMs < 60_000) return '방금 전';
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}일 전`;
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
}
