import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CaptionFilter, ProgramCategory } from '@gachinol/shared';
import type { ContentSummary, Paginated } from '@gachinol/shared';

/**
 * 자막 대기열 **발견 수단** 렌더 테스트 (T-W2-34 — 대장 #123).
 *
 * 왜 필요한가: 편집 화면만 만들고 진입로를 안 만드는 결함이 이 리포에서 반복됐다(가장 최근이
 * 대장 #118 — 미성년자 게이트가 막은 콘텐츠를 센터가 **발견할 수 없었다**). 그래서 여기서는
 * "필터를 켤 수 있다"가 아니라 **켜지 않아도 눈에 띄는가**를 고정한다:
 *  ① 목록 화면 첫 렌더에 자막 대기열 건수 카드가 뜬다(필터 조작 0회).
 *  ② 그 카드를 누르면 서버에 `captions=needed`가 실제로 나간다.
 *  ③ 대기열이 0건이면 카드가 사라진다(할 일이 없는데 자리를 차지하지 않는다).
 */

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn() },
  Stack: { Screen: () => null },
}));

jest.mock('../../../auth/auth-context', () => ({
  useApiClient: () => ({}),
  useReporter: () => ({ id: 'u-me', stationId: 's-aewol', role: 'reporter', name: '나' }),
  useSession: () => ({ signOut: jest.fn() }),
}));

const mockListContents = jest.fn();
jest.mock('../../../api/contents', () => ({
  listContents: (...args: unknown[]) => mockListContents(...args),
}));

jest.mock('../../../api/stations', () => ({
  getStation: jest.fn().mockResolvedValue({ id: 's-aewol', name: '애월 마을방송국' }),
}));

jest.mock('../../../features/system/queries', () => ({
  useProcessingState: () => ({ data: undefined }),
  useHoldReleaseToast: () => undefined,
}));

import ContentListScreen from '../../../../app/(app)/index';

const summary = (id: string): ContentSummary =>
  ({
    id,
    title: `콘텐츠 ${id}`,
    category: ProgramCategory.LocalWeather,
    status: 'uploaded',
    stationId: 's-aewol',
    stationName: '애월 마을방송국',
    reporterId: 'u-other',
    reporterName: '동료 기자',
    durationSec: null,
    hasMinorSubject: false,
    createdAt: '2026-08-16T00:00:00.000Z',
    publishedAt: null,
  }) as ContentSummary;

const page = (items: ContentSummary[], totalCount = items.length): Paginated<ContentSummary> => ({
  items,
  page: 1,
  pageSize: 20,
  totalCount,
});

/** 호출 인자의 `captions` 값으로 응답을 가른다 — 카운트 쿼리와 목록 쿼리가 같은 목을 공유한다 */
function respondWith(opts: { queueCount: number; queueItems?: ContentSummary[] }): void {
  mockListContents.mockImplementation((_client: unknown, q: { captions?: string }) =>
    Promise.resolve(
      q.captions === CaptionFilter.Needed
        ? page(opts.queueItems ?? [], opts.queueCount)
        : page([summary('c-plain')]),
    ),
  );
}

const clients: QueryClient[] = [];
afterEach(() => {
  for (const c of clients.splice(0)) c.unmount();
});

async function renderList() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(client);
  return render(
    <QueryClientProvider client={client}>
      <ContentListScreen />
    </QueryClientProvider>,
  );
}

describe('목록 화면 — 자막 대기열 발견 수단', () => {
  it('★ 필터를 켜지 않아도 대기열 건수가 첫 화면에 보인다', async () => {
    respondWith({ queueCount: 3, queueItems: [summary('c-1'), summary('c-2'), summary('c-3')] });
    const utils = await renderList();

    expect(await utils.findByText('자막 필요 3건')).toBeTruthy();
  });

  it('★ 카드를 누르면 서버에 captions=needed가 실제로 나간다', async () => {
    respondWith({ queueCount: 2, queueItems: [summary('c-1'), summary('c-2')] });
    const utils = await renderList();

    await fireEvent.press(await utils.findByText('자막 필요 2건'));

    await waitFor(() => {
      const queries = mockListContents.mock.calls.map(
        (c) => (c[1] as { captions?: string; pageSize: number }),
      );
      // 목록 쿼리(pageSize 20)가 captions=needed로 나갔다 — 카운트 쿼리(pageSize 1)와 구분
      expect(
        queries.some((q) => q.captions === CaptionFilter.Needed && q.pageSize === 20),
      ).toBe(true);
    });
  });

  it('대기열 항목에는 "자막 없음" 배지가 붙는다', async () => {
    respondWith({ queueCount: 1, queueItems: [summary('c-1')] });
    const utils = await renderList();

    expect(utils.queryByText('자막 없음')).toBeNull(); // 전체 목록에서는 추측하지 않는다
    await fireEvent.press(await utils.findByText('자막 필요 1건'));
    expect(await utils.findByText('자막 없음')).toBeTruthy();
  });

  it('0건이면 카드가 아예 없다 (할 일이 없는데 자리를 차지하지 않는다)', async () => {
    respondWith({ queueCount: 0, queueItems: [] });
    const utils = await renderList();

    await utils.findByText('주민 업로드 검수'); // 첫 렌더 완료 기준점
    await waitFor(() => expect(mockListContents).toHaveBeenCalled());
    expect(utils.queryByText(/자막 필요 \d+건/)).toBeNull();
  });
});
