/**
 * 피드 keyset 커서 (순수 유틸) — 정렬키가 publishedAt(id 아님)이고 UUID v7 id와 단조 일치하지
 * 않으므로 복합 keyset이 필수. opaque 문자열은 서버만 발급하며 base64url(`${publishedAtISO}|${id}`).
 * 손상/변조 커서는 decode에서 null → 서비스가 fail-closed 400으로 거부(조용한 첫 페이지 회귀 금지).
 */
export interface FeedCursor {
  /** ISO8601 (contents.published_at) */
  publishedAt: string;
  /** contents.id (UUID v7) */
  id: string;
}

export const encodeFeedCursor = (publishedAt: string, id: string): string =>
  Buffer.from(`${publishedAt}|${id}`, 'utf8').toString('base64url');

export const decodeFeedCursor = (raw: string): FeedCursor | null => {
  try {
    const decoded = Buffer.from(raw, 'base64url').toString('utf8');
    const sep = decoded.indexOf('|');
    // sep<=0 → publishedAt 비어있음(또는 구분자 없음) → 손상
    if (sep <= 0) return null;
    const publishedAt = decoded.slice(0, sep);
    const id = decoded.slice(sep + 1);
    if (!id) return null;
    // publishedAt은 유효 시각이어야 함 — 파싱 실패 시 손상
    if (Number.isNaN(Date.parse(publishedAt))) return null;
    return { publishedAt, id };
  } catch {
    return null;
  }
};
