import type { StationId } from '../common/id';
import type { PageQuery } from '../common/pagination';
import type { UserRole, UserStatus } from './user';

/** 관리자 계정 생성 (셀프 가입 아님 — subscriber 가입 플로우는 다음 단계) */
export interface CreateUserRequest {
  role: UserRole;
  name: string;
  email: string;
  /** 초기 비밀번호 — 전송 전용 */
  password: string;
  phone?: string;
  /** role='reporter'면 필수, admin은 생략 가능 (서버 검증) */
  stationId?: StationId;
}

export interface UpdateUserRequest {
  name?: string;
  phone?: string;
  profileImageUrl?: string;
  status?: UserStatus;
  stationId?: StationId;
}

export interface UserListQuery extends PageQuery {
  role?: UserRole;
  stationId?: StationId;
  status?: UserStatus;
}
