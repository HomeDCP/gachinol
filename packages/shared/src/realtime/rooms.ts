import type { LiveSessionId, UserId } from '../common/id';

/** 관제 공용 룸 (center_operator·announcer·admin만 join) */
export const CONTROL_ROOM = 'control';

/** 라이브 시청 룸 */
export const liveRoom = (id: LiveSessionId): string => `live:${id}`;

/** 아나운서 프롬프터 룸 */
export const prompterRoom = (id: LiveSessionId): string => `prompter:${id}`;

/** 개인 알림 룸 — 기자 진행률 푸시 등. 연결 인증 시 서버가 자동 join */
export const userRoom = (id: UserId): string => `user:${id}`;
