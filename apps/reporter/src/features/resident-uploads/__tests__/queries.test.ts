/**
 * findResidentUploadInCache — 상세 화면의 유일한 데이터 원천(qa-verifier 결함① 수정).
 * 캐시 조회만 검증한다(네트워크 없음) — QueryClient에 실 useInfiniteQuery가 만드는 것과 같은
 * 모양(InfiniteData<Paginated<...>>)으로 직접 시딩한다.
 */
import { QueryClient } from '@tanstack/react-query';
import type { ResidentUploadReviewItem } from '../../../api/resident-uploads';
import { residentUploadKeys } from '../../../query/keys';

// queries.ts는 훅(useResidentUploadQueue 등)을 통해 auth-context 경유로 모듈 스코프에서
// `expo-router`를 끌어온다 — mutations.test.ts와 동일한 이유의 동일한 우회.
jest.mock('expo-router', () => ({ router: { replace: jest.fn() } }));

import { findResidentUploadInCache } from '../queries';

function item(over: Partial<ResidentUploadReviewItem> = {}): ResidentUploadReviewItem {
  return {
    id: 'upload-1',
    status: 'awaiting_branch_review',
    stationId: 'station-1',
    stationName: '애월지사',
    contentId: 'content-1',
    uploaderContact: '010-1234-5678',
    consentAgreedAt: '2026-08-16T00:00:00.000Z',
    mimeType: 'video/mp4',
    sizeBytes: 12345,
    completedAt: '2026-08-16T00:01:00.000Z',
    createdAt: '2026-08-16T00:00:00.000Z',
    reviewedByUserId: null,
    reviewedAt: null,
    ...over,
  };
}

function seedList(
  queryClient: QueryClient,
  filter: { status: ResidentUploadReviewItem['status'] },
  items: readonly ResidentUploadReviewItem[],
): void {
  queryClient.setQueryData(residentUploadKeys.list(filter), {
    pages: [{ items, page: 1, pageSize: 20, totalCount: items.length }],
    pageParams: [1],
  });
}

const clients: QueryClient[] = [];
function newClient(): QueryClient {
  const c = new QueryClient();
  clients.push(c);
  return c;
}
afterEach(() => {
  for (const c of clients.splice(0)) c.clear();
});

describe('findResidentUploadInCache', () => {
  test('캐시에 있으면 전체 필드를 그대로 반환한다(원문 그대로, PII 포함 — 화면 내부 표시용)', () => {
    const queryClient = newClient();
    const target = item();
    seedList(queryClient, { status: 'awaiting_branch_review' }, [target]);
    expect(findResidentUploadInCache(queryClient, 'upload-1')).toEqual(target);
  });

  test('캐시에 없으면 null — 부분 필드 복구 없이 상세를 열지 않는다', () => {
    const queryClient = newClient();
    expect(findResidentUploadInCache(queryClient, 'no-such-id')).toBeNull();
  });

  test('여러 페이지에 걸쳐 있어도 찾는다', () => {
    const queryClient = newClient();
    queryClient.setQueryData(residentUploadKeys.list({ status: 'awaiting_branch_review' }), {
      pages: [
        { items: [item({ id: 'a' })], page: 1, pageSize: 20, totalCount: 2 },
        { items: [item({ id: 'b' })], page: 2, pageSize: 20, totalCount: 2 },
      ],
      pageParams: [1, 2],
    });
    expect(findResidentUploadInCache(queryClient, 'b')?.id).toBe('b');
  });

  test('필터(상태)가 다른 여러 캐시를 모두 뒤진다 — 어느 탭에서 진입했는지 모른다', () => {
    const queryClient = newClient();
    seedList(queryClient, { status: 'awaiting_branch_review' }, [item({ id: 'x' })]);
    seedList(queryClient, { status: 'approved' }, [item({ id: 'y', status: 'approved' })]);
    expect(findResidentUploadInCache(queryClient, 'y')?.status).toBe('approved');
  });

  test('resident-uploads와 무관한 다른 쿼리 캐시는 건드리지 않는다', () => {
    const queryClient = newClient();
    queryClient.setQueryData(['contents', 'detail', 'unrelated'], { some: 'thing' });
    seedList(queryClient, { status: 'awaiting_branch_review' }, [item({ id: 'z' })]);
    expect(findResidentUploadInCache(queryClient, 'z')?.id).toBe('z');
    expect(findResidentUploadInCache(queryClient, 'unrelated')).toBeNull();
  });
});
