/**
 * 페이지네이션은 용도별 2종으로 고정. 그 이상 만들지 않는다.
 */

/** 관제 테이블용 offset 페이지네이션 (총건수 표시·페이지 점프 필요). 기본 page=1, pageSize=20, 최대 100(서버 강제) */
export interface PageQuery {
  page?: number;
  pageSize?: number;
}

export interface Paginated<T> {
  items: readonly T[];
  page: number;
  pageSize: number;
  totalCount: number;
}

/** 모바일 무한스크롤 피드·채팅 히스토리용 커서 페이지네이션. UUID v7 id를 커서로 사용. 기본 limit=20, 최대 100 */
export interface CursorQuery {
  cursor?: string;
  limit?: number;
}

export interface CursorPage<T> {
  items: readonly T[];
  /** 더 없으면 null */
  nextCursor: string | null;
}
