import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ContentStatus, ProgramCategory } from '@gachinol/shared';
import type { Content, ContentDetail, Scene } from '@gachinol/shared';

/**
 * ★★ 미성년자 피촬영자 플래그 입력 배선 테스트 (T-W2-14 — 대장 #118 · 07 §3-3 · 02 §E-20 · 03 §C-2-1).
 *
 * 고정하는 것:
 *  ① 위저드 분류 단계에서 체크박스를 켜고 저장하면 `hasMinorSubject: true`가 나간다.
 *     켜지 않으면 **명시적 `false`**가 나간다 — 서버 기본값 의존이 아니라 폼이 값을 소유한다.
 *  ② 체크 시 법정대리인 동의서 안내가 나타난다(03 §C-2-1 — 업로드 자체는 막지 않는다).
 *  ③ 초안 수정 화면은 기존 값을 프리필하고, 해제 저장 시 PATCH 바디에 **명시적 `false`**를
 *     싣는다 — PATCH에서 키 생략='변경 없음'이므로 생략하면 해제가 서버에 전달되지 않는다.
 *  (이력) 舊 ④ "확인 기록 삭제" 경고는 확인 개념과 함께 T-W2-36으로 제거됐다.
 *
 * 테스트는 `src/**` 아래에 둔다 — `app/` 아래 두면 expo-router의 `require.context`가 라우트로
 * 흡수해 프로덕션 번들이 오염된다(wizard-mode.test.tsx와 같은 근거).
 */

const mockPush = jest.fn();
const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  router: {
    push: (...args: unknown[]) => mockPush(...args),
    replace: (...args: unknown[]) => mockReplace(...args),
  },
  useLocalSearchParams: () => ({ id: 'c-1' }),
  useNavigation: () => ({ addListener: () => () => undefined, dispatch: jest.fn() }),
  Stack: { Screen: () => null },
}));

jest.mock('../../../auth/auth-context', () => ({
  useApiClient: () => ({}),
  useReporter: () => ({ id: 'u-reporter', role: 'reporter', stationId: 's-aewol' }),
}));

const mockCreateDraft = jest.fn();
const mockGetContentDetail = jest.fn();
const mockUpdateDraft = jest.fn();
jest.mock('../../../api/contents', () => ({
  createDraft: (...args: unknown[]) => mockCreateDraft(...args),
  getContentDetail: (...args: unknown[]) => mockGetContentDetail(...args),
  updateDraft: (...args: unknown[]) => mockUpdateDraft(...args),
}));

jest.mock('../../../telemetry/use-upload-funnel-events', () => ({
  useUploadFunnelEvents: () => ({
    wizardStepEnter: jest.fn(),
    wizardStepExit: jest.fn(),
    modeSelected: jest.fn(),
    uploadStart: jest.fn(),
    uploadResume: jest.fn(),
    uploadComplete: jest.fn(),
  }),
}));

import { DraftProvider } from '../draft-context';
import ModeScreen from '../../../../app/(app)/contents/new/mode';
import ClassifyScreen from '../../../../app/(app)/contents/new/classify';
import EditDraftScreen from '../../../../app/(app)/contents/[id]/edit';

const CHECKBOX_LABEL = '촬영본에 만 14세 미만 아동이 나옵니다';
const GUIDE_RE = /촬영자가 직접 받아 보관/;

const sceneRow: Scene = {
  id: 's-1',
  order: 0,
  caption: '포구 전경',
  startSec: null,
  endSec: null,
} as Scene;

const content = (over: Partial<Content> = {}): Content =>
  ({
    id: 'c-1',
    stationId: 's-aewol',
    origin: 'reporter_upload',
    reporterId: 'u-reporter',
    title: '애월 포구 아침',
    category: ProgramCategory.News,
    status: ContentStatus.Draft,
    priority: 'normal',
    reviewPolicy: 'center_required',
    generation: 1,
    scenes: [sceneRow],
    targetChannelAccountIds: [],
    tags: [],
    durationSec: null,
    approvedByUserId: null,
    approvedAt: null,
    hasMinorSubject: false,
    publishedAt: null,
    createdAt: '2026-08-26T00:00:00.000Z',
    updatedAt: '2026-08-26T00:00:00.000Z',
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
  jest.clearAllMocks();
});

function newClient(): QueryClient {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(client);
  return client;
}

// ── 위저드(생성) 경로 ──────────────────────────────────────────────────────────

async function renderWizard() {
  return render(
    <QueryClientProvider client={newClient()}>
      <DraftProvider>
        <ModeScreen />
        <ClassifyScreen />
      </DraftProvider>
    </QueryClientProvider>,
  );
}

/** 간단 모드 + 최소 분류 입력 — 자막 없이 저장 가능해지는 최단 경로 */
async function fillMinimum(utils: Awaited<ReturnType<typeof renderWizard>>): Promise<void> {
  await fireEvent.press(utils.getByText('간단 — 자막 없이 바로 올리기'));
  await fireEvent.changeText(utils.getByPlaceholderText('콘텐츠 제목'), '애월 포구 아침');
  await fireEvent.press(utils.getByText('뉴스'));
}

describe('위저드 분류 단계 — 만 14세 미만 체크박스 (AC1·AC2)', () => {
  beforeEach(() => {
    mockCreateDraft.mockResolvedValue(content());
  });

  it('★ 체크하고 저장하면 hasMinorSubject: true가 나간다', async () => {
    const utils = await renderWizard();
    await fillMinimum(utils);
    await fireEvent.press(utils.getByText(CHECKBOX_LABEL));
    await fireEvent.press(utils.getByText('초안 저장'));

    await waitFor(() => expect(mockReplace).toHaveBeenCalled());
    const body = mockCreateDraft.mock.calls[0]![1] as { hasMinorSubject?: boolean };
    expect(body.hasMinorSubject).toBe(true);
  });

  it('★ 체크하지 않으면 명시적 false가 나간다 — 서버 기본값에 기대지 않는다', async () => {
    const utils = await renderWizard();
    await fillMinimum(utils);
    await fireEvent.press(utils.getByText('초안 저장'));

    await waitFor(() => expect(mockReplace).toHaveBeenCalled());
    const body = mockCreateDraft.mock.calls[0]![1] as { hasMinorSubject?: boolean };
    expect(body.hasMinorSubject).toBe(false);
  });

  it('체크해도 업로드(저장)는 막히지 않는다 — 03 §C-2-1 "업로드를 막지 않는다"', async () => {
    const utils = await renderWizard();
    await fillMinimum(utils);
    await fireEvent.press(utils.getByText(CHECKBOX_LABEL));
    await fireEvent.press(utils.getByText('초안 저장'));

    await waitFor(() => expect(mockCreateDraft).toHaveBeenCalled());
  });

  it('체크 시 동의서 안내가 나타나고, 해제하면 사라진다 (AC2)', async () => {
    const utils = await renderWizard();
    await fillMinimum(utils);
    expect(utils.queryByText(GUIDE_RE)).toBeNull();

    await fireEvent.press(utils.getByText(CHECKBOX_LABEL));
    expect(utils.getByText(GUIDE_RE)).toBeTruthy();

    await fireEvent.press(utils.getByText(CHECKBOX_LABEL));
    expect(utils.queryByText(GUIDE_RE)).toBeNull();
  });
});

// ── T-W2-36: 촬영자 책임 문구 (판단 게이트 해체, 사용자 결정 2026-08-27) ────────

describe('T-W2-36 — 안내 문구가 촬영자 책임 모델을 말한다', () => {
  beforeEach(() => {
    mockCreateDraft.mockResolvedValue(content());
  });

  it('★ 체크 시 "촬영자가 직접 받아 보관" 안내가 뜨고, 승인 차단을 시사하는 문구는 없다', async () => {
    const utils = await renderWizard();
    await fillMinimum(utils);
    await fireEvent.press(utils.getByText(CHECKBOX_LABEL));

    expect(utils.getByText(/촬영자가 직접 받아 보관/)).toBeTruthy();
    // 게이트 해체 후 이 문구는 거짓이 된다 — 남아 있으면 안 된다
    expect(utils.queryByText(/승인·송출되지 않습니다/)).toBeNull();
  });
});

// ── 초안 수정 경로 ─────────────────────────────────────────────────────────────

async function renderEdit() {
  return render(
    <QueryClientProvider client={newClient()}>
      <EditDraftScreen />
    </QueryClientProvider>,
  );
}

describe('초안 수정 화면 — 프리필·명시적 전송 (AC3)', () => {
  it('★ hasMinorSubject=true인 콘텐츠는 체크된 상태로 프리필된다', async () => {
    mockGetContentDetail.mockResolvedValue(detail({ hasMinorSubject: true }));
    const utils = await renderEdit();

    const checkbox = await utils.findByText(CHECKBOX_LABEL);
    expect(checkbox).toBeTruthy();
    // 프리필이 체크 상태라는 관찰 가능한 증거 = 안내 문구가 처음부터 보인다
    expect(utils.getByText(GUIDE_RE)).toBeTruthy();
  });

  it('★★ 체크를 해제하고 저장하면 PATCH 바디에 명시적 false가 실린다', async () => {
    mockGetContentDetail.mockResolvedValue(detail({ hasMinorSubject: true }));
    mockUpdateDraft.mockResolvedValue(content());
    const utils = await renderEdit();

    await fireEvent.press(await utils.findByText(CHECKBOX_LABEL));
    await fireEvent.press(utils.getByText('저장'));

    await waitFor(() => expect(mockUpdateDraft).toHaveBeenCalled());
    const body = mockUpdateDraft.mock.calls[0]![2] as { hasMinorSubject?: boolean };
    expect(body.hasMinorSubject).toBe(false);
  });

  it('체크된 채 저장하면 true가 실린다 (프리필 값 유실 없음)', async () => {
    mockGetContentDetail.mockResolvedValue(detail({ hasMinorSubject: true }));
    mockUpdateDraft.mockResolvedValue(content());
    const utils = await renderEdit();

    await utils.findByText(CHECKBOX_LABEL);
    await fireEvent.press(utils.getByText('저장'));

    await waitFor(() => expect(mockUpdateDraft).toHaveBeenCalled());
    const body = mockUpdateDraft.mock.calls[0]![2] as { hasMinorSubject?: boolean };
    expect(body.hasMinorSubject).toBe(true);
  });

  // (이력) 舊 AC4(확인 무효화 경고) 테스트 2건은 확인 개념과 함께 T-W2-36으로 제거.
});
