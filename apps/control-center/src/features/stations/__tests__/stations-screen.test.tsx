import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { UserRole } from '@gachinol/shared';
import type { Station, User, UserId } from '@gachinol/shared';

/**
 * 지사 탭 렌더 테스트 (T-W2-30) — 순수 함수 테스트가 못 잡는 두 가지를 여기서 고정한다.
 *
 *  ① **RBAC 분기가 화면에 실제로 반영되는가**: `canManageStations`가 admin 전용이어도 화면이
 *     그 술어를 안 쓰면 센터 운영자에게 "누르면 403"인 버튼이 그대로 보인다.
 *     (술어 자체를 admin+center_operator로 바꾸는 뮤테이션도 여기서 빨간불이 된다.)
 *  ② **부활 액션이 서버로 보내는 목적 상태**: `availableStationTransitions('dormant')`가
 *     비면 순수 테스트도 깨지지만, 화면이 그 결과를 안 쓰거나 toStatus를 안 실어 보내면
 *     순수 테스트만으로는 통과해 버린다.
 *
 * app/ 하위에 테스트를 두면 expo-router의 require.context가 라우트로 흡수해 프로덕션 번들이
 * 오염되므로, 테스트는 src/에 두고 화면을 상대 경로로 import한다.
 */
import StationsScreen from '../../../../app/(app)/(tabs)/stations';

const station = (patch: Partial<Station> = {}): Station => ({
  id: '01234567-89ab-7def-8123-456789abcdef' as Station['id'],
  code: 'aewol',
  name: '애월 마을방송국',
  kind: 'branch',
  status: 'dormant',
  region: '제주시 애월읍',
  sortOrder: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...patch,
});

const mockStations = { items: [station()], page: 1, pageSize: 100, total: 1, hasNext: false };

let mockRole: User['role'] = UserRole.CenterOperator;

const mockTransitionMutate = jest.fn();
const mockCreateMutate = jest.fn();
const mockUpdateMutate = jest.fn();
const mockConfirm = jest.fn();

jest.mock('../queries', () => ({
  useBranchStations: () => ({
    isPending: false,
    isError: false,
    isRefetching: false,
    data: mockStations,
    refetch: jest.fn(),
  }),
}));

jest.mock('../mutations', () => ({
  useTransitionStation: () => ({ mutate: mockTransitionMutate, isPending: false }),
  useCreateStation: () => ({ mutate: mockCreateMutate, isPending: false }),
  useUpdateStation: () => ({ mutate: mockUpdateMutate, isPending: false }),
}));

jest.mock('../../../auth/auth-context', () => ({
  useCenterUser: () => ({
    id: 'user-1' as UserId,
    email: 'operator@example.com',
    name: '운영자',
    role: mockRole,
  }),
}));

jest.mock('../../../board/board-filter-context', () => ({
  useBoardFilter: () => ({ stationId: undefined, setStationId: jest.fn() }),
}));

// ui/toast는 ui/feedback을 재export하므로 여기 한 곳만 mock하면 둘 다 덮인다
jest.mock('../../../ui/feedback', () => ({
  confirmDialog: (...args: unknown[]) => mockConfirm(...args),
  showToast: jest.fn(),
  FeedbackHost: () => null,
}));

jest.mock('expo-router', () => ({
  router: { navigate: jest.fn(), push: jest.fn(), replace: jest.fn() },
}));

beforeEach(() => {
  mockRole = UserRole.CenterOperator;
  mockConfirm.mockResolvedValue(true);
});

describe('지사 탭 — RBAC 분기 (엔드포인트별 @Roles가 다르다)', () => {
  it('center_operator에게는 전이 버튼은 보이되 admin 전용 버튼은 렌더되지 않는다', async () => {
    const { getByText, queryByText } = await render(<StationsScreen />);

    // 전이는 center_operator·admin
    expect(getByText('부활')).toBeTruthy();
    // 생성·수정은 admin 전용 → 미렌더(disabled가 아니라 아예 없음)
    expect(queryByText('＋ 지사 추가')).toBeNull();
    expect(queryByText('정보 수정')).toBeNull();
    // 대신 왜 없는지 정직하게 알린다
    expect(getByText('지사 생성·수정은 관리자(admin) 계정만 할 수 있습니다.')).toBeTruthy();
  });

  it('admin에게는 생성·수정 버튼이 모두 렌더된다', async () => {
    mockRole = UserRole.Admin;
    const { getByText, queryByText } = await render(<StationsScreen />);

    expect(getByText('＋ 지사 추가')).toBeTruthy();
    expect(getByText('정보 수정')).toBeTruthy();
    expect(getByText('부활')).toBeTruthy();
    expect(queryByText('지사 생성·수정은 관리자(admin) 계정만 할 수 있습니다.')).toBeNull();
  });
});

describe('지사 탭 — 부활 액션이 서버로 나가는 경로', () => {
  it('부활 버튼 → 확인 다이얼로그 승인 → toStatus=operating으로 전이를 호출한다', async () => {
    const { getByText } = await render(<StationsScreen />);

    await fireEvent.press(getByText('부활'));

    await waitFor(() => expect(mockTransitionMutate).toHaveBeenCalled());
    const [vars] = mockTransitionMutate.mock.calls[0] as [
      { id: string; body: { toStatus: string } },
    ];
    expect(vars.id).toBe(station().id);
    expect(vars.body.toStatus).toBe('operating');
    expect(mockConfirm).toHaveBeenCalled();
  });

  it('확인 다이얼로그에서 취소하면 전이를 호출하지 않는다', async () => {
    mockConfirm.mockResolvedValue(false);
    const { getByText } = await render(<StationsScreen />);

    await fireEvent.press(getByText('부활'));

    await waitFor(() => expect(mockConfirm).toHaveBeenCalled());
    expect(mockTransitionMutate).not.toHaveBeenCalled();
  });

  it('운영 중 지사에는 "휴무 전환"이, 설립 예정에는 "운영 시작"이 뜬다', async () => {
    mockStations.items = [
      station({ status: 'operating' }),
      station({ id: 'b' as Station['id'], code: 'jeju-si', name: '제주시 마을방송국', status: 'planned' }),
    ];
    const { getByText, queryByText } = await render(<StationsScreen />);

    expect(getByText('휴무 전환')).toBeTruthy();
    expect(getByText('운영 시작')).toBeTruthy();
    expect(queryByText('부활')).toBeNull();

    mockStations.items = [station()];
  });
});

describe('지사 탭 — 생성 시트 (admin)', () => {
  it('"지사 추가"를 누르면 생성 폼이 열리고, 필수 항목이 비면 서버 호출이 없다', async () => {
    mockRole = UserRole.Admin;
    const { getByText } = await render(<StationsScreen />);

    await fireEvent.press(getByText('＋ 지사 추가'));
    await waitFor(() => expect(getByText('지사 코드 (필수)')).toBeTruthy());

    await fireEvent.press(getByText('추가'));

    await waitFor(() => expect(getByText('지사 이름을 입력해 주세요')).toBeTruthy());
    expect(mockCreateMutate).not.toHaveBeenCalled();
  });
});
