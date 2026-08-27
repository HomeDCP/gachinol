/**
 * 주민 링크 발급 화면 렌더 테스트(T-W2-35, 대장 #147) — AC3·AC4.
 *
 * 고정하는 불변식:
 *  ① 발급 성공 시 서버 응답 값(지사명·잔여/최대 건수·만료·전체 URL)만으로 결과를 그린다 —
 *     72h·5건·500MB를 화면에 하드코딩하지 않는다(E2 T-W2-35 행 명문).
 *  ② 토큰 원문은 서버가 해시만 보관해 재조회 불가 → "지금만 복사" 1회 노출 경고가 반드시 보인다.
 *  ③ 검수 목록 화면에 발급 화면 진입점이 있다(#147의 본질 — 발급 화면에 도달할 수 없으면
 *     경로 전체가 실사용 불가).
 *
 * app/ 라우트 모듈은 상대 경로로 import한다(detail-screen.test.tsx의 E1 §C-2 근거와 동일 —
 * 테스트를 app/ 아래 두면 프로덕션 라우트 트리에 실린다).
 */
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { IssuedResidentLink } from '../../../api/resident-links';

const mockRouterPush = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockRouterPush(...args), replace: jest.fn() },
  Stack: { Screen: () => null },
}));

jest.mock('../../../auth/auth-context', () => ({
  useApiClient: () => ({}),
}));

const mockIssue = jest.fn();
jest.mock('../../../api/resident-links', () => ({
  issueResidentLink: (...args: unknown[]) => mockIssue(...args),
}));

const mockList = jest.fn();
jest.mock('../../../api/resident-uploads', () => ({
  listResidentUploads: (...args: unknown[]) => mockList(...args),
  getResidentUpload: jest.fn(),
  approveResidentUpload: jest.fn(),
  rejectResidentUpload: jest.fn(),
}));

import IssueResidentLinkScreen from '../../../../app/(app)/resident-uploads/issue';
import ResidentUploadQueueScreen from '../../../../app/(app)/resident-uploads/index';

const issued: IssuedResidentLink = {
  id: 'link-1',
  token: 'tok-abc',
  stationId: 'station-1',
  stationName: '애월지사',
  expiresAt: '2026-08-31T12:00:00.000Z',
  maxUploads: 5,
  remainingUploads: 5,
  maxFileSizeBytes: 500 * 1024 * 1024,
};

const clients: QueryClient[] = [];
// render는 이 버전에서 await 대상이다(detail-screen.test.tsx와 동일 — 안 기다리면 쿼리가 없는 Promise)
async function renderWithQuery(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(queryClient);
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

afterEach(() => {
  for (const c of clients.splice(0)) c.clear();
  jest.clearAllMocks();
  delete process.env.EXPO_PUBLIC_SUBSCRIBER_WEB_URL;
});

describe('발급 화면 — AC3', () => {
  test('발급 성공 시 서버 값(지사명·건수·전체 URL)과 1회 노출 경고를 렌더한다', async () => {
    process.env.EXPO_PUBLIC_SUBSCRIBER_WEB_URL = 'https://watch.test';
    mockIssue.mockResolvedValue(issued);

    const screen = await renderWithQuery(<IssueResidentLinkScreen />);
    await fireEvent.press(screen.getByText('새 링크 발급'));

    await waitFor(() => expect(mockIssue).toHaveBeenCalledTimes(1));
    await waitFor(() => {
      // 서버 응답 값 렌더 — 하드코딩이 아니라 응답에서 왔음을 응답 고유 값(지사명·토큰 URL)로 판정
      expect(screen.getByText(/애월지사/)).toBeTruthy();
      expect(screen.getByText('https://watch.test/upload/tok-abc')).toBeTruthy();
      expect(screen.getByText(/5건/)).toBeTruthy();
      // 1회 노출 경고 — 서버는 해시만 보관하므로 화면 이탈 후 재조회 불가
      expect(screen.getByText(/지금만 복사/)).toBeTruthy();
    });
  });

  test('발급 전에는 발급 결과·경고가 없다 — 버튼만 노출', async () => {
    const screen = await renderWithQuery(<IssueResidentLinkScreen />);
    expect(screen.getByText('새 링크 발급')).toBeTruthy();
    expect(screen.queryByText(/지금만 복사/)).toBeNull();
    expect(mockIssue).not.toHaveBeenCalled();
  });
});

describe('검수 목록 진입점 — AC4', () => {
  test('목록 화면에서 발급 화면으로 이동하는 버튼이 있다', async () => {
    mockList.mockResolvedValue({ items: [], page: 1, pageSize: 20, totalCount: 0 });

    const screen = await renderWithQuery(<ResidentUploadQueueScreen />);
    const entry = await screen.findByText('주민 링크 발급');
    await fireEvent.press(entry);

    expect(mockRouterPush).toHaveBeenCalledWith('/resident-uploads/issue');
  });
});
