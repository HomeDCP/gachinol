import type { StationId, UserId } from '../common/id';
import type { Timestamps } from '../common/time';

export const UserRole = {
  /** 지사 기자 */
  Reporter: 'reporter',
  /** 센터 운영자 (관제·승인) */
  CenterOperator: 'center_operator',
  /** 아나운서 (프롬프터 사용자) */
  Announcer: 'announcer',
  /** 구독자 (시청·채팅·구매) */
  Subscriber: 'subscriber',
  /** 플랫폼 관리자 */
  Admin: 'admin',
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];

export const UserStatus = {
  Active: 'active',
  Suspended: 'suspended',
  Withdrawn: 'withdrawn',
} as const;
export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];

interface UserBase extends Timestamps {
  id: UserId;
  name: string;
  /** 소셜 로그인 전용 구독자는 없을 수 있음. unique(있을 때) */
  email?: string;
  phone?: string;
  profileImageUrl?: string;
  status: UserStatus;
}

/** 지사 기자 — 소속 지사 타입 수준 필수. 승인 시 이 지사의 카톡채널이 기본 송출처 */
export interface ReporterUser extends UserBase {
  role: typeof UserRole.Reporter;
  stationId: StationId;
}

/** 센터 스태프(운영자·아나운서) 및 관리자. admin은 무소속 가능 */
export interface CenterStaffUser extends UserBase {
  role: typeof UserRole.CenterOperator | typeof UserRole.Announcer | typeof UserRole.Admin;
  /** 센터 Station id */
  stationId?: StationId;
}

/** 구독자(시청자) */
export interface SubscriberUser extends UserBase {
  role: typeof UserRole.Subscriber;
}

/** role 판별 유니언 — 기자의 소속 지사 필수를 타입 수준에서 강제 */
export type User = ReporterUser | CenterStaffUser | SubscriberUser;

/** 타입 가드 */
export const isReporterUser = (u: User): u is ReporterUser => u.role === UserRole.Reporter;
