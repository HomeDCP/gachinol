import { Alert } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { InfiniteData } from '@tanstack/react-query';
import {
  ContentOrigin,
  ContentPriority,
  ContentStatus,
  MediaAssetKind,
  MediaAssetStatus,
  ResidentUploadStatus,
  ReviewPolicy,
  ProgramCategory,
  toId,
} from '@gachinol/shared';
import type { Content, ContentDetail, ContentId, MediaAsset, MediaAssetId, Paginated } from '@gachinol/shared';
import type { ResidentUploadReviewItem } from '../../../api/resident-uploads';
import { residentUploadKeys } from '../../../query/keys';

/**
 * 검수 상세 화면(app/(app)/resident-uploads/[id].tsx) 렌더 테스트 — T-W2-26.
 *
 * 이 화면은 jest.config.js의 testMatch가 `app/`을 배제해 커버리지 0%였다(actions.ts 주석·
 * qa-verifier 결함④). 화면을 직접 렌더해 다음 두 불변식을 고정한다:
 *  ① 승인은 **확인 다이얼로그를 경유**한다 — "승인" 버튼을 눌러도 사용자가 다이얼로그에서
 *     확정하기 전에는 실제 승인 API가 호출되지 않는다(취소하면 아예 호출되지 않는다).
 *  ② 원본이 확인되기 전(sourceConfirmed=false)에는 승인 버튼이 **비활성**이다.
 *
 * app/은 라우트 트리라 여기서 직접 import하지 않고, 상대 경로로만 화면 모듈을 가져온다
 * (E1 §C-2 — expo-router의 require.context는 `+api`/`+html`/`+middleware` 외에는 아무 것도
 * 제외하지 않는다는 것을 소스로 확인했다: node_modules/expo-router/_ctx-shared.js. `__tests__`
 * 디렉터리·`.test.` 파일명 어느 쪽도 예외가 아니므로, 테스트를 app/ 아래 두면 프로덕션 라우트
 * 트리에 실릴 위험이 있다).
 */
import ResidentUploadDetailScreen from '../../../../app/(app)/resident-uploads/[id]';

// expo-router — 실제 네비게이터 없이 화면만 렌더하기 위해 최소 계약만 흉내낸다
const mockRouterReplace = jest.fn();
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'ru-1' }),
  router: { replace: (...args: unknown[]) => mockRouterReplace(...args), push: jest.fn() },
  Stack: { Screen: () => null },
}));

// 인증 컨텍스트 — 실제 API 호출은 아래 api/* 모듈 목이 가로채므로 client 값 자체는 쓰이지 않는다
jest.mock('../../../auth/auth-context', () => ({
  useApiClient: () => ({}),
}));

const mockGetContentDetail = jest.fn();
jest.mock('../../../api/contents', () => ({
  getContentDetail: (...args: unknown[]) => mockGetContentDetail(...args),
}));

const mockGetMediaAccessUrl = jest.fn();
jest.mock('../../../api/media', () => ({
  getMediaAccessUrl: (...args: unknown[]) => mockGetMediaAccessUrl(...args),
}));

const mockApprove = jest.fn();
const mockReject = jest.fn();
// ⚠️ `getResidentUpload`가 이 목에 없으면 조회가 조용히 깨진 채로 테스트가 통과한다 —
// initialData(목록 캐시 시드)가 화면을 그려주기 때문이다. 신규 API는 반드시 여기에 함께 등재한다.
const mockGetOne = jest.fn();
jest.mock('../../../api/resident-uploads', () => ({
  getResidentUpload: (...args: unknown[]) => mockGetOne(...args),
  approveResidentUpload: (...args: unknown[]) => mockApprove(...args),
  rejectResidentUpload: (...args: unknown[]) => mockReject(...args),
}));

const CONTENT_ID = 'content-1';
const ORIGINAL_ASSET_ID = 'asset-original-1';

function buildItem(overrides: Partial<ResidentUploadReviewItem> = {}): ResidentUploadReviewItem {
  return {
    id: 'ru-1',
    status: ResidentUploadStatus.AwaitingBranchReview,
    stationId: 'station-1',
    stationName: '애월지사',
    contentId: CONTENT_ID,
    uploaderContact: '010-0000-0000',
    consentAgreedAt: '2026-08-01T00:00:00.000Z',
    mimeType: 'video/mp4',
    sizeBytes: 1024,
    completedAt: '2026-08-01T00:05:00.000Z',
    createdAt: '2026-08-01T00:00:00.000Z',
    reviewedByUserId: null,
    reviewedAt: null,
    ...overrides,
  };
}

function buildContent(overrides: Partial<Content> = {}): Content {
  return {
    id: toId<ContentId>(CONTENT_ID),
    stationId: toId('station-1'),
    origin: ContentOrigin.ResidentLink,
    reporterId: null,
    title: '무인교 마을 잔치',
    category: ProgramCategory.News,
    status: ContentStatus.Uploaded,
    priority: ContentPriority.Normal,
    reviewPolicy: ReviewPolicy.ReporterOnly,
    generation: 1,
    scenes: [],
    targetChannelAccountIds: [],
    tags: [],
    durationSec: null,
    approvedByUserId: null,
    approvedAt: null,
    hasMinorSubject: false,
    publishedAt: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

function buildOriginalAsset(overrides: Partial<MediaAsset> = {}): MediaAsset {
  return {
    id: toId<MediaAssetId>(ORIGINAL_ASSET_ID),
    owner: { kind: 'content', contentId: toId<ContentId>(CONTENT_ID) },
    kind: MediaAssetKind.Original,
    status: MediaAssetStatus.Ready,
    generation: 1,
    storageKey: `contents/${CONTENT_ID}/g1/original.mp4`,
    mimeType: 'video/mp4',
    createdAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

function buildContentDetail(overrides: Partial<ContentDetail> = {}): ContentDetail {
  return {
    content: buildContent(),
    assets: [buildOriginalAsset()],
    revisions: [],
    publications: [],
    ...overrides,
  };
}

/** 목록 쿼리 캐시에 항목을 심는다 — 상세 화면은 라우트 파라미터가 아니라 이 캐시에서 읽는다(review §) */
function primeResidentUploadCache(client: QueryClient, item: ResidentUploadReviewItem): void {
  const page: Paginated<ResidentUploadReviewItem> = {
    items: [item],
    page: 1,
    pageSize: 20,
    totalCount: 1,
  };
  const data: InfiniteData<Paginated<ResidentUploadReviewItem>> = {
    pages: [page],
    pageParams: [1],
  };
  client.setQueryData(residentUploadKeys.list({}), data);
}

// react-query가 붙이는 focus/online 구독·배치 타이머를 테스트마다 정리 — jest worker
// 강제종료 경고(open handle) 예방. RNTL의 auto-cleanup은 렌더 트리만 unmount하고
// QueryClient 자체는 모르므로 여기서 별도로 추적한다.
const clientsToCleanup: QueryClient[] = [];
afterEach(() => {
  for (const c of clientsToCleanup.splice(0)) c.unmount();
});

async function renderScreen(
  item: ResidentUploadReviewItem,
  opts: { seedCache?: boolean } = {},
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clientsToCleanup.push(client);
  // seedCache=false = 새로고침·북마크·URL 공유 진입(목록을 거치지 않아 캐시가 비어 있다)
  if (opts.seedCache !== false) primeResidentUploadCache(client, item);
  const result = await render(
    <QueryClientProvider client={client}>
      <ResidentUploadDetailScreen />
    </QueryClientProvider>,
  );
  return { client, ...result };
}

describe('ResidentUploadDetailScreen — 원본 확인 전 승인 버튼 비활성', () => {
  it('getContentDetail이 아직 응답하지 않으면 "원본 확인 중…" 상태로 승인이 막힌다', async () => {
    mockGetContentDetail.mockReturnValue(new Promise(() => {})); // 영원히 대기 — 로딩 상태 고정
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const { getByText } = await renderScreen(buildItem());

    const approveButton = getByText('원본 확인 중…');
    expect(approveButton).toBeTruthy();
    await fireEvent.press(approveButton);
    // disabled라 confirmDialog(Alert.alert)로도, mutate로도 이어지지 않는다
    expect(alertSpy).not.toHaveBeenCalled();
    expect(mockApprove).not.toHaveBeenCalled();
  });

  it('원본 자산이 없으면(assets=[]) "승인 불가"로 막힌다', async () => {
    mockGetContentDetail.mockResolvedValue(buildContentDetail({ assets: [] }));
    const { findByText, getByText } = await renderScreen(buildItem());

    await findByText('원본 영상을 찾을 수 없어 승인할 수 없습니다', { exact: false });
    const approveButton = getByText('승인 불가');
    await fireEvent.press(approveButton);
    expect(mockApprove).not.toHaveBeenCalled();
  });
});

describe('ResidentUploadDetailScreen — 승인은 확인 다이얼로그를 경유한다', () => {
  beforeEach(() => {
    mockGetContentDetail.mockResolvedValue(buildContentDetail());
    mockGetMediaAccessUrl.mockResolvedValue({ url: 'https://example.com/original.mp4' });
  });

  it('승인 버튼을 눌러도 다이얼로그에서 확정하기 전엔 approve API가 호출되지 않는다', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const { findByText } = await renderScreen(buildItem());

    const approveButton = await findByText('승인');
    await fireEvent.press(approveButton);

    // confirmDialog가 Alert.alert를 호출했다 — 이 시점까지는 아직 승인 API가 불리지 않는다
    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(alertSpy.mock.calls[0]?.[0]).toBe('승인할까요?');
    expect(mockApprove).not.toHaveBeenCalled();
  });

  it('다이얼로그에서 취소하면 approve API가 호출되지 않는다', async () => {
    type AlertButton = { text?: string; style?: string; onPress?: () => void };
    jest.spyOn(Alert, 'alert').mockImplementation((_title, _msg, buttons) => {
      (buttons as AlertButton[] | undefined)?.find((b) => b.style === 'cancel')?.onPress?.();
    });
    const { findByText } = await renderScreen(buildItem());

    const approveButton = await findByText('승인');
    await fireEvent.press(approveButton);

    await waitFor(() => expect(mockApprove).not.toHaveBeenCalled());
  });

  it('다이얼로그에서 확정하면 approve API가 호출된다', async () => {
    type AlertButton = { text?: string; style?: string; onPress?: () => void };
    jest.spyOn(Alert, 'alert').mockImplementation((_title, _msg, buttons) => {
      (buttons as AlertButton[] | undefined)?.find((b) => b.text === '승인')?.onPress?.();
    });
    mockApprove.mockResolvedValue(buildItem({ status: ResidentUploadStatus.Approved }));
    const { findByText } = await renderScreen(buildItem());

    const approveButton = await findByText('승인');
    await fireEvent.press(approveButton);

    await waitFor(() => expect(mockApprove).toHaveBeenCalledWith(expect.anything(), 'ru-1'));
  });
});

describe('ResidentUploadDetailScreen — 새로고침 생존 (대장 #120)', () => {
  it('★ 목록 캐시가 비어도 서버 단건 조회로 상세가 열린다 — 새로고침·북마크·URL 공유 진입', async () => {
    const item = buildItem();
    mockGetOne.mockResolvedValue(item);

    const rendered = await renderScreen(item, { seedCache: false });
    const { queryByText } = rendered;

    // 상태 배지는 item 하나만 있으면 그려진다 — 다른 쿼리(원본 조회) 상태에 좌우되지 않는 신호다.
    // 舊 구현은 여기서 "검수 항목 정보를 찾을 수 없습니다"로 목록에 되돌렸다.
    // 상태 배지는 item 하나만 있으면 그려진다 — 다른 쿼리(원본 조회) 상태에 좌우되지 않는 신호다.
    // 舊 구현은 여기서 "검수 항목 정보를 찾을 수 없습니다"로 목록에 되돌렸다.
    await rendered.findByText('검수 대기');
    expect(queryByText('검수 항목 정보를 찾을 수 없습니다.')).toBeNull();
    expect(mockGetOne).toHaveBeenCalledWith(expect.anything(), item.id);
  });

  it('★ URL에는 id만 실린다 — 항목 원문을 route param으로 나르지 않는다(PII 노출 차단)', async () => {
    const item = buildItem();
    mockGetOne.mockResolvedValue(item);

    await renderScreen(item, { seedCache: false });

    // 조회 인자에 연락처가 섞여 들어가지 않는다(경로 파라미터는 식별자뿐)
    const [, ...args] = mockGetOne.mock.calls[0];
    expect(args).toEqual([item.id]);
    expect(JSON.stringify(args)).not.toContain(item.uploaderContact ?? '@@none@@');
  });

  it('조회가 실패하면 목록으로 쫓아내지 않고 재시도를 준다', async () => {
    const item = buildItem();
    mockGetOne.mockRejectedValue(new Error('network down'));

    const { findByText } = await renderScreen(item, { seedCache: false });

    await findByText('다시 시도');
  });

  it('시드가 있으면 즉시 그리고 서버 값으로 갱신한다 — 낡은 캐시가 사실로 굳지 않는다', async () => {
    const stale = buildItem({ status: 'awaiting_branch_review' });
    const fresh = buildItem({ status: 'approved' });
    mockGetOne.mockResolvedValue(fresh);

    const { findByText } = await renderScreen(stale);

    // 서버가 approved라고 답하면 화면은 검수 완료 안내로 바뀐다
    await findByText('이미 검수가 완료된 건입니다.');
    expect(mockGetOne).toHaveBeenCalled();
  });
});
