import type { ApiClient } from './client';

/**
 * `services/api/src/resident-links/resident-links.service.ts`의 `IssuedResidentLink` 미러.
 * 그 인터페이스는 api 모듈 로컬(export되지만 `@gachinol/shared`가 아님)이라 이 태스크의 파일
 * 소유권(`apps/reporter/**`만)으로는 shared에 승격할 수 없다 — `resident-uploads.ts`의
 * `ResidentUploadReviewItem` 미러와 동일한 이유의 동일한 패턴(원본 출처 명시로 드리프트 추적).
 *
 * ★ `token`은 이 응답에서 **1회만** 나온다 — 서버는 해시만 보관하므로(원문 미저장) 발급 이력
 *   조회·재조회 API 자체가 없다. 분실 시 재발급만 가능하며, 화면은 이 사실을 반드시 고지해야 한다.
 */
export interface IssuedResidentLink {
  readonly id: string;
  readonly token: string;
  readonly stationId: string;
  readonly stationName: string;
  readonly expiresAt: string;
  readonly maxUploads: number;
  readonly remainingUploads: number;
  readonly maxFileSizeBytes: number;
}

/**
 * POST /v1/resident-links — 주민 임시 업로드 링크 발급(03 §C-5, 대장 #147).
 *
 * 기자는 서버가 자기 소속 지사로 자동 귀속시키므로 stationId를 보내지 않는다 — admin 전용
 * 파라미터를 기자 앱 계약에 노출하지 않는다(resident-uploads.ts의 stationId 배제와 같은 판단).
 * body는 명시적 빈 객체 — zod DTO(zIssueResidentLink)가 객체를 기대하므로 본문 생략으로
 * Content-Type 없는 요청을 만들지 않는다.
 */
export const issueResidentLink = (c: ApiClient): Promise<IssuedResidentLink> =>
  c.request<IssuedResidentLink>('POST', '/resident-links', { body: {} });
