export const Platform = {
  /** 지사별 카톡채널 (현재 기본 송출처) */
  Kakao: 'kakao',
  Youtube: 'youtube',
  Facebook: 'facebook',
  Instagram: 'instagram',
  X: 'x',
  Threads: 'threads',
  /** 자체 구독자 앱 */
  App: 'app',
} as const;
export type Platform = (typeof Platform)[keyof typeof Platform];

/** 플랫폼별 지원 기능 — 커넥터 구현·UI 노출 제어 (카톡 API 능력 미확정 대응) */
export const ChannelCapability = {
  VodPublish: 'vod_publish',
  LivePublish: 'live_publish',
  CommentRead: 'comment_read',
} as const;
export type ChannelCapability = (typeof ChannelCapability)[keyof typeof ChannelCapability];
