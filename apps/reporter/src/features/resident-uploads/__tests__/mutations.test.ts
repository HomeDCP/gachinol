/**
 * 승인/반려 뮤테이션의 invalidate 규칙 — 낙관적 업데이트 금지(리포 관례) 검증.
 * 이 리포에는 React 훅을 렌더 없이 단위 테스트할 도구(@testing-library/react-hooks 등)가 없어서,
 * 훅이 아니라 onSuccess/onError로 넘기는 순수 함수(mutations.ts export)를 실제 QueryClient로 검증한다.
 */
import { Alert } from 'react-native';
import { QueryClient } from '@tanstack/react-query';
import { ApiClientError } from '../../../api/errors';
import type { ResidentUploadReviewItem } from '../../../api/resident-uploads';
import { residentUploadKeys } from '../../../query/keys';

// mutations.ts는 훅(useApproveResidentUpload 등)을 통해 auth-context 경유로 모듈 스코프에서
// `expo-router`를 끌어온다. 그 트랜지티브 체인(@react-navigation/native)이 jest.config.js
// transformIgnorePatterns와 어긋나 raw ESM 파싱 실패를 낸다 — auth-context.test.ts와 동일한
// 이유의 동일한 우회(reporter 전역 jest 설정은 이 태스크 소유 파일이 아니라 건드리지 않는다).
jest.mock('expo-router', () => ({ router: { replace: jest.fn() } }));

import { onResidentUploadReviewError, onResidentUploadReviewed } from '../mutations';

const item: ResidentUploadReviewItem = {
  id: 'upload-1',
  status: 'approved',
  stationId: 'station-1',
  stationName: '애월지사',
  contentId: 'content-1',
  uploaderContact: null,
  consentAgreedAt: null,
  mimeType: 'video/mp4',
  sizeBytes: 100,
  completedAt: null,
  createdAt: '2026-08-16T00:00:00.000Z',
  reviewedByUserId: 'user-1',
  reviewedAt: '2026-08-16T00:01:00.000Z',
};

// QueryClient는 쿼리마다 GC 타이머(기본 5분)를 예약한다 — 정리하지 않으면 테스트 프로세스가
// 열린 타이머 때문에 종료를 못하고 매달린다("Jest did not exit..."). 만든 클라이언트를 전부
// 추적했다가 afterEach에서 clear()해 타이머를 확실히 해제한다.
const clients: QueryClient[] = [];

function seededClient(): QueryClient {
  const queryClient = new QueryClient();
  clients.push(queryClient);
  // 큐 목록 캐시를 미리 채워둔다 — invalidate 여부를 isInvalidated로 확인
  queryClient.setQueryData(residentUploadKeys.list({ status: 'awaiting_branch_review' }), {
    pages: [{ items: [], page: 1, pageSize: 20, totalCount: 0 }],
    pageParams: [1],
  });
  return queryClient;
}

afterEach(() => {
  for (const c of clients.splice(0)) c.clear();
});

describe('onResidentUploadReviewed — 성공 시', () => {
  test('큐 목록(prefix) 전체를 invalidate 한다', () => {
    const queryClient = seededClient();
    onResidentUploadReviewed(queryClient, item);
    const state = queryClient.getQueryState(
      residentUploadKeys.list({ status: 'awaiting_branch_review' }),
    );
    expect(state?.isInvalidated).toBe(true);
  });
});

describe('onResidentUploadReviewError — 409 경합', () => {
  beforeEach(() => {
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });

  test('409면 큐 목록을 invalidate 한다', () => {
    const queryClient = seededClient();
    const err = new ApiClientError(409, { code: 'conflict', message: '다른 검수자가 먼저 처리했습니다' });
    onResidentUploadReviewError(queryClient, err);
    const state = queryClient.getQueryState(
      residentUploadKeys.list({ status: 'awaiting_branch_review' }),
    );
    expect(state?.isInvalidated).toBe(true);
  });

  test('409가 아니면(예: 500) invalidate 하지 않는다', () => {
    const queryClient = seededClient();
    const err = new ApiClientError(500, { code: 'internal', message: '서버 오류' });
    onResidentUploadReviewError(queryClient, err);
    const state = queryClient.getQueryState(
      residentUploadKeys.list({ status: 'awaiting_branch_review' }),
    );
    expect(state?.isInvalidated).toBe(false);
  });

  test('ApiClientError가 아닌 예외(네트워크 오류 등)는 invalidate 하지 않는다', () => {
    const queryClient = seededClient();
    onResidentUploadReviewError(queryClient, new Error('네트워크 오류'));
    const state = queryClient.getQueryState(
      residentUploadKeys.list({ status: 'awaiting_branch_review' }),
    );
    expect(state?.isInvalidated).toBe(false);
  });
});
