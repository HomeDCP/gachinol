import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ContentStatus, ProgramCategory } from '@gachinol/shared';
import type { Content, ContentDetail } from '@gachinol/shared';

/**
 * 사후 자막 보강 화면 렌더 테스트 (T-W2-34 — 대장 #123 · 정본 03 §C-4).
 *
 * 고정하는 것:
 *  ① 자막 0인 콘텐츠에서 편집기가 뜨고, 입력한 자막이 `PATCH :id/captions`로 나간다.
 *  ② 자막만 나간다 — 제목·분류를 실을 입력 자체가 화면에 없다.
 *  ③ 이미 송출·종결된 콘텐츠는 편집기 대신 상세로 되돌린다(서버 409를 화면이 앞질러 막는다).
 *
 * 테스트는 `src/**` 아래에 둔다 — `app/` 아래 두면 expo-router의 `require.context`가 라우트로
 * 흡수해 프로덕션 번들이 오염된다(resident-uploads/detail-screen.test.tsx와 같은 근거).
 */

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  router: { replace: (...args: unknown[]) => mockReplace(...args), push: jest.fn() },
  useLocalSearchParams: () => ({ id: 'c-1' }),
  useNavigation: () => ({ addListener: () => () => undefined, dispatch: jest.fn() }),
  Stack: { Screen: () => null },
}));

jest.mock('../../../auth/auth-context', () => ({ useApiClient: () => ({}) }));

const mockGetContentDetail = jest.fn();
const mockUpdateCaptions = jest.fn();
jest.mock('../../../api/contents', () => ({
  getContentDetail: (...args: unknown[]) => mockGetContentDetail(...args),
  updateCaptions: (...args: unknown[]) => mockUpdateCaptions(...args),
}));

import CaptionsScreen from '../../../../app/(app)/contents/[id]/captions';

const content = (over: Partial<Content> = {}): Content =>
  ({
    id: 'c-1',
    stationId: 's-aewol',
    origin: 'reporter_upload',
    reporterId: 'u-other-reporter', // ★ 담당 기자가 아니어도 채울 수 있다
    title: '애월 포구 아침',
    category: ProgramCategory.LocalWeather,
    status: ContentStatus.Uploaded,
    priority: 'normal',
    reviewPolicy: 'reporter_only',
    generation: 1,
    scenes: [],
    targetChannelAccountIds: [],
    tags: [],
    durationSec: null,
    approvedByUserId: null,
    approvedAt: null,
    hasMinorSubject: false,
    publishedAt: null,
    createdAt: '2026-08-16T00:00:00.000Z',
    updatedAt: '2026-08-16T00:00:00.000Z',
    ...over,
  }) as Content;

const detail = (over: Partial<Content> = {}): ContentDetail => ({
  content: content(over),
  assets: [],
  revisions: [],
  publications: [],
});

const clients: QueryClient[] = [];
afterEach(() => {
  for (const c of clients.splice(0)) c.unmount();
});

async function renderScreen() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(client);
  return render(
    <QueryClientProvider client={client}>
      <CaptionsScreen />
    </QueryClientProvider>,
  );
}

describe('CaptionsScreen — 자막 보강', () => {
  it('★ 자막 0인 콘텐츠에서 입력한 자막이 PATCH :id/captions로 나간다', async () => {
    mockGetContentDetail.mockResolvedValue(detail());
    mockUpdateCaptions.mockResolvedValue(content());
    const utils = await renderScreen();

    const input = await utils.findByPlaceholderText('화면에 노출될 자막');
    await fireEvent.changeText(input, '포구에 배가 들어옵니다');
    await fireEvent.press(utils.getByText('자막 저장'));

    await waitFor(() => expect(mockUpdateCaptions).toHaveBeenCalled());
    const body = mockUpdateCaptions.mock.calls[0]![2] as { scenes: { caption: string }[] };
    expect(body.scenes).toEqual([
      { order: 0, caption: '포구에 배가 들어옵니다', startSec: null, endSec: null },
    ]);
    // 자막 말고는 아무것도 실리지 않는다 — 넓힌 액터가 제목·분류를 못 고치는 구조적 보장
    expect(Object.keys(body)).toEqual(['scenes']);
  });

  it('빈 자막은 저장되지 않는다 (요청 0회)', async () => {
    mockGetContentDetail.mockResolvedValue(detail());
    const utils = await renderScreen();

    await utils.findByPlaceholderText('화면에 노출될 자막');
    await fireEvent.press(utils.getByText('자막 저장'));

    expect(mockUpdateCaptions).not.toHaveBeenCalled();
    expect(utils.getByText('자막을 입력해 주세요')).toBeTruthy();
  });

  it('제목·분류 입력이 화면에 없다 — 자막 전용 화면', async () => {
    mockGetContentDetail.mockResolvedValue(detail());
    const utils = await renderScreen();

    await utils.findByPlaceholderText('화면에 노출될 자막');
    expect(utils.queryByPlaceholderText('콘텐츠 제목')).toBeNull();
    expect(utils.queryByText('지역 날씨')).toBeNull(); // 분류 칩
  });

  it('★ 이미 송출된(published) 콘텐츠는 편집기 대신 상세로 되돌린다', async () => {
    mockGetContentDetail.mockResolvedValue(detail({ status: ContentStatus.Published }));
    const utils = await renderScreen();

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/contents/c-1'));
    expect(utils.queryByPlaceholderText('화면에 노출될 자막')).toBeNull();
  });

  it('종결(canceled)된 콘텐츠도 되돌린다', async () => {
    mockGetContentDetail.mockResolvedValue(detail({ status: ContentStatus.Canceled }));
    await renderScreen();

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/contents/c-1'));
  });

  it('기존 자막이 있으면 프리필된다 (수정 경로)', async () => {
    mockGetContentDetail.mockResolvedValue(
      detail({
        scenes: [
          { id: 's-1', order: 0, caption: '기존 자막', startSec: 0, endSec: 5 },
        ] as unknown as Content['scenes'],
      }),
    );
    const utils = await renderScreen();

    const input = await utils.findByPlaceholderText('화면에 노출될 자막');
    expect(input.props.value).toBe('기존 자막');
  });
});
