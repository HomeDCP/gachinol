import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ContentStatus, ProgramCategory } from '@gachinol/shared';
import type { Content } from '@gachinol/shared';

/**
 * ★★ 위저드 모드 분기 렌더 테스트 (T-W2-34 — 대장 #123).
 *
 * 이 파일이 고정하는 단 하나의 사실: **간단 모드는 자막 단계를 거치지 않고 빈 scenes로 저장된다.**
 * T-W1-07b는 정확히 이 지점에서 "간단 모드가 정밀 모드와 완전히 같은 항등함수"라는 판정을 받았다 —
 * 모드 선택 UI가 자막 화면 **뒤**에 있어 무엇을 고르든 결과가 같았기 때문이다. 그래서 여기서는
 * 순수 함수(`validateCreateDraft`)만 보지 않고 **화면 배선까지** 확인한다:
 *  ① 모드 화면에서 "간단"을 누르면 다음 목적지가 `scenes`가 아니라 `classify`다(단계를 건너뛴다).
 *  ② 그 상태로 분류 화면에서 저장하면 서버로 나가는 바디의 `scenes`가 `[]`다.
 *  ③ "정밀"을 누르면 목적지가 `scenes`이고, 같은 저장이 자막을 실어 보낸다.
 *
 * 테스트를 `app/` 밖(`src/**` 하위)에 두는 이유는 expo-router의 `require.context`가 `+api`/`+html`/
 * `+middleware` 외에는 아무것도 제외하지 않아, `app/` 아래 테스트 파일이 프로덕션 라우트 트리에
 * 실릴 수 있기 때문이다(resident-uploads/detail-screen.test.tsx와 같은 근거).
 */

// ── expo-router: 실제 네비게이터 없이 화면만 렌더한다 ──────────────────────────
const mockPush = jest.fn();
const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  router: {
    push: (...args: unknown[]) => mockPush(...args),
    replace: (...args: unknown[]) => mockReplace(...args),
  },
  useNavigation: () => ({ addListener: () => () => undefined, dispatch: jest.fn() }),
  useLocalSearchParams: () => ({}),
  Stack: { Screen: () => null },
}));

// 인증 컨텍스트 — 실 API 호출은 아래 api/contents 목이 가로챈다
jest.mock('../../../auth/auth-context', () => ({ useApiClient: () => ({}) }));

const mockCreateDraft = jest.fn();
jest.mock('../../../api/contents', () => ({
  createDraft: (...args: unknown[]) => mockCreateDraft(...args),
}));

// 계측 — 배치 큐·타이머를 끌어들이지 않고 호출만 관찰한다
const mockModeSelected = jest.fn();
jest.mock('../../../telemetry/use-upload-funnel-events', () => ({
  useUploadFunnelEvents: () => ({
    wizardStepEnter: jest.fn(),
    wizardStepExit: jest.fn(),
    modeSelected: (...args: unknown[]) => mockModeSelected(...args),
    uploadStart: jest.fn(),
    uploadResume: jest.fn(),
    uploadComplete: jest.fn(),
  }),
}));

import { DraftProvider } from '../draft-context';
import ModeScreen from '../../../../app/(app)/contents/new/mode';
import ScenesScreen from '../../../../app/(app)/contents/new/scenes';
import ClassifyScreen from '../../../../app/(app)/contents/new/classify';

const SAVED: Content = {
  id: 'c-1',
  stationId: 's-aewol',
  origin: 'reporter_upload',
  reporterId: 'u-reporter',
  title: '애월 포구 아침',
  category: ProgramCategory.LocalWeather,
  status: ContentStatus.Draft,
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
} as unknown as Content;

const clients: QueryClient[] = [];
afterEach(() => {
  for (const c of clients.splice(0)) c.unmount();
});

/**
 * 위저드 3화면(모드·자막·분류)을 **같은 DraftProvider 아래** 함께 마운트한다.
 * 실제 앱에서는 한 번에 하나만 보이지만, 여기서 함께 띄우는 이유는 위저드 상태(모드·장면)가
 * 화면 사이를 실제로 건너간다는 것까지 한 트리에서 확인하기 위해서다. "자막 화면을 거쳤는가"는
 * 자막 입력이 실제로 채워졌는가로 표현된다.
 */
async function renderWizard() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(client);
  return render(
    <QueryClientProvider client={client}>
      <DraftProvider>
        <ModeScreen />
        <ScenesScreen />
        <ClassifyScreen />
      </DraftProvider>
    </QueryClientProvider>,
  );
}

/** 분류 폼 최소 입력 — 제목 + 분류(칩) */
async function fillClassify(utils: Awaited<ReturnType<typeof renderWizard>>): Promise<void> {
  // fireEvent는 act 스코프를 여는 비동기 API다 — 하나라도 await를 빠뜨리면 스코프가 겹쳐
  // ("overlapping act() calls") **다음 테스트의 렌더가 통째로 비어 버린다**(실측).
  await fireEvent.changeText(utils.getByPlaceholderText('콘텐츠 제목'), '애월 포구 아침');
  await fireEvent.press(utils.getByText('지역 날씨'));
}

describe('위저드 모드 분기 — 간단 모드는 자막 단계를 건너뛴다', () => {
  beforeEach(() => {
    mockCreateDraft.mockResolvedValue(SAVED);
  });

  it('★ "간단"을 누르면 다음 화면이 scenes가 아니라 classify다', async () => {
    const utils = await renderWizard();
    await fireEvent.press(utils.getByText('간단 — 자막 없이 바로 올리기'));

    expect(mockPush).toHaveBeenCalledWith('/contents/new/classify');
    expect(mockPush).not.toHaveBeenCalledWith('/contents/new/scenes');
  });

  it('"정밀"을 누르면 기존대로 자막 화면으로 간다', async () => {
    const utils = await renderWizard();
    await fireEvent.press(utils.getByText('정밀 — 장면별 자막까지 기입'));

    expect(mockPush).toHaveBeenCalledWith('/contents/new/scenes');
  });

  it('★★ 간단 모드로 저장하면 서버로 나가는 scenes가 빈 배열이다', async () => {
    const utils = await renderWizard();
    await fireEvent.press(utils.getByText('간단 — 자막 없이 바로 올리기'));
    await fillClassify(utils);
    await fireEvent.press(utils.getByText('초안 저장'));

    // onSuccess의 markSaved·router.replace까지 이 테스트 안에서 끝내야 다음 테스트로 상태가 새지 않는다
    await waitFor(() => expect(mockReplace).toHaveBeenCalled());
    const body = mockCreateDraft.mock.calls[0]![1] as { scenes: unknown[]; title: string };
    expect(body.scenes).toEqual([]);
    expect(body.title).toBe('애월 포구 아침');
  });

  it('★★ 정밀 모드는 같은 조작에서 저장이 막힌다 — 두 모드가 같은 함수가 아니라는 증거', async () => {
    const utils = await renderWizard();
    await fireEvent.press(utils.getByText('정밀 — 장면별 자막까지 기입'));
    await fillClassify(utils);
    await fireEvent.press(utils.getByText('초안 저장'));

    // 자막을 채우지 않았으므로 검증에서 막힌다 — 요청이 아예 나가지 않는다.
    // (간단 모드는 같은 조작에서 200으로 저장됐다 — 바로 위 테스트)
    expect(mockCreateDraft).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('정밀 모드는 자막 화면에서 채운 자막을 그대로 실어 보낸다 (기존 흐름 무회귀)', async () => {
    const utils = await renderWizard();
    await fireEvent.press(utils.getByText('정밀 — 장면별 자막까지 기입'));
    await fireEvent.changeText(
      utils.getByPlaceholderText('화면에 노출될 자막'),
      '포구에 배가 들어옵니다',
    );
    await fillClassify(utils);
    await fireEvent.press(utils.getByText('초안 저장'));

    await waitFor(() => expect(mockReplace).toHaveBeenCalled());
    const body = mockCreateDraft.mock.calls[0]![1] as { scenes: { caption: string }[] };
    expect(body.scenes).toHaveLength(1);
    expect(body.scenes[0]!.caption).toBe('포구에 배가 들어옵니다');
  });

  it('★★ 간단 모드는 자막이 입력돼 있어도 버린다 — 자막 단계를 아예 거치지 않았다는 뜻', async () => {
    const utils = await renderWizard();
    await fireEvent.press(utils.getByText('간단 — 자막 없이 바로 올리기'));
    // 같은 입력을 넣어도(= 위 정밀 모드 테스트와 동일 조작) 결과가 다르다
    await fireEvent.changeText(
      utils.getByPlaceholderText('화면에 노출될 자막'),
      '포구에 배가 들어옵니다',
    );
    await fillClassify(utils);
    await fireEvent.press(utils.getByText('초안 저장'));

    await waitFor(() => expect(mockReplace).toHaveBeenCalled());
    const body = mockCreateDraft.mock.calls[0]![1] as { scenes: unknown[] };
    expect(body.scenes).toEqual([]);
  });

  it('간단 모드를 고르면 분류 화면이 사후 보강을 예고한다 (사용자가 자막 유실로 오해하지 않게)', async () => {
    const utils = await renderWizard();
    expect(utils.queryByText(/간단 모드로 저장합니다/)).toBeNull();

    await fireEvent.press(utils.getByText('간단 — 자막 없이 바로 올리기'));
    expect(utils.getByText(/간단 모드로 저장합니다/)).toBeTruthy();
  });

  it('mode_selected 계측이 선택할 때마다 나간다 (채택률 KPI의 유일 입력)', async () => {
    const utils = await renderWizard();
    await fireEvent.press(utils.getByText('간단 — 자막 없이 바로 올리기'));
    await fireEvent.press(utils.getByText('정밀 — 장면별 자막까지 기입'));

    expect(mockModeSelected.mock.calls).toEqual([['simple'], ['precise']]);
  });
});
