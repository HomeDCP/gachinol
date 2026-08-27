import { Alert } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  ContentOrigin,
  ContentPriority,
  ContentStatus,
  ProgramCategory,
  ReviewPolicy,
  toId,
} from '@gachinol/shared';
import type {
  Content,
  ContentDetail,
  ContentId,
  Paginated,
  StatusTransitionLog,
  UserId,
} from '@gachinol/shared';

/**
 * 콘텐츠 상세 화면(app/(app)/contents/[id].tsx) 렌더 테스트 — T-W2-32 (대장 #124·#130).
 *
 * 순수 함수 테스트(actions.test.ts)만으로는 잡히지 않는 **배선**을 고정한다:
 *  ① published 콘텐츠에 "보관" 버튼과 경고 문구가 실제로 렌더된다 — 파생만 고쳐두고 화면에
 *     안 붙이는 것이 바로 대장 #124의 형태다("서버는 완비인데 앱에 호출이 0건").
 *  ② 보관은 **확인 다이얼로그를 경유**한다 — 취소하면 전이 API가 아예 호출되지 않는다.
 *  ③ (T-W2-36) 미성년 등장 정보 카드는 뜨되, 동의 확인·철회 같은 판단 UI는 없다.
 *  ④ **이미 승인된 콘텐츠에는 철회 버튼이 없다** — 서버가 409로 거부하는 조건이라
 *     노출하면 "눌러도 거절되는 버튼"이 된다(Wave 8a에서 실제로 저지른 결함).
 *
 * app/은 라우트 트리라 여기서 직접 import하지 않고 상대 경로로만 가져온다(E1 §C-2 —
 * expo-router의 require.context는 `+api`/`+html`/`+middleware` 외에는 아무 것도 제외하지
 * 않는다: node_modules/expo-router/_ctx-shared.js. 테스트를 app/ 아래 두면 프로덕션 라우트
 * 트리에 실린다).
 *
 * 확인 다이얼로그는 `src/ui/feedback.tsx`의 `confirmDialog`다. 그 안에서 네이티브는
 * `Alert.alert`, 웹은 자체 모달 호스트로 갈라지므로(RNW의 Alert는 빈 함수 — 대장 #92),
 * jest-expo 기본 플랫폼(native)에서는 아래처럼 `Alert.alert`를 스파이해 구동한다.
 * **화면·파생 코드 자체는 Alert를 import하지 않는다**(이 파일만 테스트 목적으로 쓴다).
 */
import ContentDetailScreen from '../../../../app/(app)/contents/[id]';

const CONTENT_ID = 'content-1';

const mockRouterReplace = jest.fn();
jest.mock('expo-router', () => {
  const React = require('react') as typeof import('react');
  return {
    useLocalSearchParams: () => ({ id: 'content-1' }),
    useFocusEffect: (cb: React.EffectCallback) => React.useEffect(cb, [cb]),
    router: { replace: (...args: unknown[]) => mockRouterReplace(...args), push: jest.fn() },
  };
});

jest.mock('expo-video', () => ({
  useVideoPlayer: () => ({}),
  VideoView: () => null,
}));

jest.mock('../../../auth/auth-context', () => ({
  useApiClient: () => ({}),
}));

const mockGetContentDetail = jest.fn();
const mockListTransitionLogs = jest.fn();
const mockListPublications = jest.fn();
const mockTransitionContent = jest.fn();
jest.mock('../../../api/contents', () => ({
  getContentDetail: (...a: unknown[]) => mockGetContentDetail(...a),
  listTransitionLogs: (...a: unknown[]) => mockListTransitionLogs(...a),
  listPublications: (...a: unknown[]) => mockListPublications(...a),
  transitionContent: (...a: unknown[]) => mockTransitionContent(...a),
  approveContent: jest.fn(),
  requestRevision: jest.fn(),
  rejectContent: jest.fn(),
  retryContent: jest.fn(),
  distributeContent: jest.fn(),
  retryPublication: jest.fn(),
  retractPublication: jest.fn(),
}));

jest.mock('../../../api/media', () => ({
  getMediaAccessUrl: jest.fn().mockResolvedValue({ url: 'https://example.test/preview.mp4' }),
}));

jest.mock('../../../api/stations', () => ({
  getStation: jest.fn().mockResolvedValue({ id: 'station-1', name: '애월지사' }),
}));

function buildContent(overrides: Partial<Content> = {}): Content {
  return {
    id: toId<ContentId>(CONTENT_ID),
    stationId: toId('station-1'),
    origin: ContentOrigin.ReporterUpload,
    reporterId: toId<UserId>('user-reporter-1'),
    title: '애월 해녀 이야기',
    category: ProgramCategory.News,
    status: ContentStatus.Published,
    priority: ContentPriority.Normal,
    reviewPolicy: ReviewPolicy.ReporterThenCenter,
    generation: 1,
    scenes: [],
    targetChannelAccountIds: [],
    tags: [],
    durationSec: 63,
    approvedByUserId: null,
    approvedAt: null,
    hasMinorSubject: false,
    publishedAt: '2026-08-15T00:00:00.000Z',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-15T00:00:00.000Z',
    ...overrides,
  };
}

const buildDetail = (content: Content): ContentDetail => ({
  content,
  assets: [],
  revisions: [],
  publications: [],
});

function buildLogsPage(
  edges: readonly { fromStatus: string; toStatus: string }[],
): Paginated<StatusTransitionLog> {
  return {
    items: edges.map((e, i) => ({
      id: toId(`log-${i}`),
      entityType: 'content',
      entityId: CONTENT_ID,
      fromStatus: e.fromStatus,
      toStatus: e.toStatus,
      actorType: 'user',
      actorUserId: toId('user-center-1'),
      jobId: null,
      at: '2026-08-10T00:00:00.000Z',
    })) as unknown as readonly StatusTransitionLog[],
    page: 1,
    pageSize: 20,
    totalCount: edges.length,
  };
}

type AlertButton = { text?: string; style?: string; onPress?: () => void };

/** 확인 다이얼로그에서 특정 버튼을 누른다 (네이티브 경로 = Alert.alert) */
const pressDialogButton = (text: string) =>
  jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
    (buttons as AlertButton[] | undefined)?.find((b) => b.text === text)?.onPress?.();
  });

const cancelDialog = () =>
  jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
    (buttons as AlertButton[] | undefined)?.find((b) => b.style === 'cancel')?.onPress?.();
  });

// react-query가 붙이는 focus/online 구독 + 캐시를 테스트마다 정리 (open handle 경고 예방).
// RNTL의 auto-cleanup은 렌더 트리만 unmount하고 QueryClient는 모른다.
const clientsToCleanup: QueryClient[] = [];
afterEach(() => {
  for (const c of clientsToCleanup.splice(0)) {
    c.unmount();
    c.clear();
  }
});

beforeEach(() => {
  mockListTransitionLogs.mockResolvedValue(buildLogsPage([]));
  mockListPublications.mockResolvedValue([]);
});

async function renderScreen(content: Content) {
  mockGetContentDetail.mockResolvedValue(buildDetail(content));
  const client = new QueryClient({
    // gcTime=Infinity면 react-query가 GC 타이머를 아예 걸지 않는다(유한값이면 setTimeout이 남아
    // "Jest did not exit"가 뜬다). 캐시는 afterEach의 clear()가 비운다.
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });
  clientsToCleanup.push(client);
  return render(
    <QueryClientProvider client={client}>
      <ContentDetailScreen />
    </QueryClientProvider>,
  );
}

describe('ContentDetailScreen — 보관 액션 (대장 #124)', () => {
  it('published 콘텐츠에 보관 버튼과 "무엇이 지워지는지" 경고 문구가 렌더된다', async () => {
    const { findByText, getByText } = await renderScreen(buildContent());

    await findByText('보관');
    // 경고는 되돌릴 수 없다는 사실 + 공개 객체 제거·CDN 퍼지를 명시해야 한다
    expect(getByText(/공개 서버에 복사돼 있던 재생용 영상·썸네일이 삭제/)).toBeTruthy();
    expect(getByText(/CDN 캐시가 즉시 무효화/)).toBeTruthy();
    expect(getByText(/되돌릴 수 없습니다/)).toBeTruthy();
  });

  it('published가 아니면(center_approved) 보관 버튼이 없다', async () => {
    const { findByText, queryByText } = await renderScreen(
      buildContent({ status: ContentStatus.CenterApproved, publishedAt: null }),
    );

    await findByText('송출'); // center_approved의 전용 액션이 대신 렌더된다
    expect(queryByText('보관')).toBeNull();
  });

  it('확인 다이얼로그에서 취소하면 전이 API가 호출되지 않는다', async () => {
    const alertSpy = cancelDialog();
    const { findByText } = await renderScreen(buildContent());

    await fireEvent.press(await findByText('보관'));

    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(alertSpy.mock.calls[0]?.[0]).toBe('보관 처리할까요?');
    await waitFor(() => expect(mockTransitionContent).not.toHaveBeenCalled());
  });

  it('확정하면 toStatus=archived로 범용 수동 전이를 호출한다', async () => {
    pressDialogButton('보관');
    mockTransitionContent.mockResolvedValue(buildContent({ status: ContentStatus.Archived }));
    const { findByText } = await renderScreen(buildContent());

    await fireEvent.press(await findByText('보관'));

    await waitFor(() =>
      expect(mockTransitionContent).toHaveBeenCalledWith(expect.anything(), CONTENT_ID, {
        toStatus: 'archived',
      }),
    );
  });
});

describe('ContentDetailScreen — 미성년 등장 정보 카드 (T-W2-36)', () => {
  const flagged = buildContent({
    status: ContentStatus.AwaitingCenterReview,
    publishedAt: null,
    hasMinorSubject: true,
  });

  it('hasMinorSubject=false면 카드 자체가 없다', async () => {
    const { findByText, queryByText } = await renderScreen(buildContent());
    await findByText('보관');
    expect(queryByText('미성년자 피촬영자')).toBeNull();
  });

  it('플래그가 켜져 있으면 정보 카드가 뜨되, 확인·철회 버튼과 차단 문구는 없다', async () => {
    const { findByText, getByText, queryByText } = await renderScreen(flagged);

    await findByText('미성년자 피촬영자');
    expect(getByText(/촬영자가 직접 받아 보관/)).toBeTruthy();
    // 판단 장치의 부재 — T-W2-36의 핵심 단언
    expect(queryByText('동의 확인')).toBeNull();
    expect(queryByText('동의 확인 철회')).toBeNull();
    expect(queryByText(/승인이 차단/)).toBeNull();
  });
});
