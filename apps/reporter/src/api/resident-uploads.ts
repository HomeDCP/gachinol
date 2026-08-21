import type { PageQuery, Paginated, ResidentUploadStatus } from '@gachinol/shared';
import type { ApiClient } from './client';

/**
 * `services/api/src/resident-links/resident-reviews.service.ts`의 `ResidentUploadReviewItem` 미러.
 * 그 인터페이스는 api 모듈 로컬(export되지만 `@gachinol/shared`가 아님)이라 이 태스크의 파일
 * 소유권(`apps/reporter/**`만)으로는 shared에 승격할 수 없다 — `client.ts`의 `WebSessionResponse`와
 * 동일한 이유의 동일한 패턴(사본이지만 원본 주석에 출처를 명시해 드리프트를 추적 가능하게 한다).
 *
 * 원본 재생은 이 응답에 담기지 않는다: `contentId`로 기존 경로
 * (`GET /v1/contents/:id` 상세의 `assets` → `GET /v1/media-assets/:id/url` 서명 URL)를 그대로 쓴다
 * (`api/contents.ts`의 `getContentDetail` + `api/media.ts`의 `getMediaAccessUrl` 재사용 — 사본 금지).
 */
export interface ResidentUploadReviewItem {
  readonly id: string;
  readonly status: ResidentUploadStatus;
  readonly stationId: string;
  readonly stationName: string;
  /** 완료 통지 시 생성된 콘텐츠 — 검수 화면의 미리보기·상세 진입점. 정상 흐름에선 항상 non-null */
  readonly contentId: string | null;
  /** 07 §3-15 ⓐ 업로더 연락처 — 검수자 전용(무인증 표면 노출 금지) */
  readonly uploaderContact: string | null;
  /** 07 §3-15 ⓑ 이용허락 클릭동의 시각. null = 동의 없이 접수된 건(검수자 판단 재료) */
  readonly consentAgreedAt: string | null;
  readonly mimeType: string;
  readonly sizeBytes: number | null;
  readonly completedAt: string | null;
  readonly createdAt: string;
  readonly reviewedByUserId: string | null;
  readonly reviewedAt: string | null;
}

export interface ResidentUploadListQuery extends PageQuery {
  /** 미지정 시 서버 기본값 awaiting_branch_review */
  status?: ResidentUploadStatus;
  // stationId는 admin 전용 서버 파라미터다. 기자가 보내도 서버가 자기 소속 지사로 덮어써 무시되므로
  // 클라이언트 계약에 아예 노출하지 않는다(보내봤자 소용없는 필드를 API 시그니처에 두지 않는다).
}

/** GET /v1/resident-uploads — 검수 대기열. 지사 경계는 서버가 강제(기자=자기 지사만) */
export const listResidentUploads = (
  c: ApiClient,
  q: ResidentUploadListQuery,
): Promise<Paginated<ResidentUploadReviewItem>> =>
  c.request<Paginated<ResidentUploadReviewItem>>('GET', '/resident-uploads', {
    query: { page: q.page, pageSize: q.pageSize, status: q.status },
  });

/**
 * GET /v1/resident-uploads/:id — 검수 단건 조회(대장 #120).
 *
 * 상세 화면이 목록 캐시에만 기대던 것을 걷어낸다 — 캐시가 비는 **새로고침·북마크·URL 공유**에서도
 * 열려야 한다. 항목을 route param에 실어 해결하면 검수자 전용 PII(`uploaderContact`)가 주소창·
 * 히스토리에 남으므로(T-W2-25b가 실 URL 558자로 실증) 그 길은 막혀 있다.
 * 미존재 404 · 타 지사 403(목록·승인·반려와 같은 경계).
 */
export const getResidentUpload = (c: ApiClient, id: string): Promise<ResidentUploadReviewItem> =>
  c.request<ResidentUploadReviewItem>('GET', `/resident-uploads/${id}`);

/**
 * POST /v1/resident-uploads/:id/approve — 정식 파이프라인 진입(트랜스코딩 인큐). 되돌릴 수 없다.
 * 멱등: 이미 approved인 건을 다시 호출해도 200 — 잡 유실 복구용 재인큐가 일어날 수 있다.
 */
export const approveResidentUpload = (
  c: ApiClient,
  id: string,
): Promise<ResidentUploadReviewItem> =>
  c.request<ResidentUploadReviewItem>('POST', `/resident-uploads/${id}/approve`);

/**
 * POST /v1/resident-uploads/:id/reject — 검수 반려 [종결]. 되돌릴 수 없다.
 * 바디를 받지 않는다 — 서버에 사유를 저장할 컬럼이 없어 받아도 버려진다(대장 #113).
 */
export const rejectResidentUpload = (c: ApiClient, id: string): Promise<ResidentUploadReviewItem> =>
  c.request<ResidentUploadReviewItem>('POST', `/resident-uploads/${id}/reject`);
