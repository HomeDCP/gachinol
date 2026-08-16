import { Linking } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import { StationStatus, toId } from '@gachinol/shared';
import type { PlaybackInfo, StationId, StationSummary } from '@gachinol/shared';

/**
 * 시청 화면(app/watch/[id].tsx) 재생 실패 폴백의 **지사별 연락 채널** 렌더 테스트 — T-W2-28(대장 #127).
 *
 * 고정하는 불변식:
 *  ① 서버(`GET /v1/feed/stations` → StationSummary)가 그 지사의 supportTel을 주면 "전화로 문의하기"가
 *     렌더되고, 누르면 **그 지사 번호**로 전화가 걸린다(빌드 전역 env 값이 아니라).
 *  ② 지사도 env도 값이 없으면 그 버튼은 **아예 렌더되지 않는다**(흐린 채로도 존재하지 않는다).
 *  ③ 지사 값이 없고 env만 있으면 env로 폴백한다.
 *
 * 테스트를 `src/**\/__tests__/`에 두는 이유: expo-router의 require.context는 `+api`/`+html`/
 * `+middleware` 외에는 아무 것도 제외하지 않아, app/ 아래 테스트를 두면 프로덕션 라우트 트리에
 * 실린다(reporter detail-screen.test.tsx 선례).
 */

// expo-video — setup.ts의 전역 목을 이 파일에서 덮어써서 statusChange('error')를 주입할 수 있게 한다
// (전역 목은 addListener가 콜백을 버려 재생 실패를 재현할 수 없다).
const mockPlayerListeners: Record<string, ((payload: unknown) => void)[]> = {};
jest.mock('expo-video', () => ({
  useVideoPlayer: () => ({
    timeUpdateEventInterval: 0,
    addListener: (event: string, cb: (payload: unknown) => void) => {
      (mockPlayerListeners[event] ??= []).push(cb);
      return { remove: jest.fn() };
    },
  }),
  VideoView: () => null,
}));

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: '01920000-0000-7000-8000-0000000000a1' }),
  router: { replace: jest.fn(), push: jest.fn() },
}));

const mockUsePlayback = jest.fn();
const mockUsePublicStations = jest.fn();
jest.mock('../../feed/queries', () => ({
  usePlayback: () => mockUsePlayback(),
  usePublicStations: () => mockUsePublicStations(),
}));

import WatchScreen from '../../../../app/watch/[id]';

const PLAYBACK: PlaybackInfo = {
  contentId: toId('01920000-0000-7000-8000-0000000000a1'),
  title: '애월 해녀 이야기',
  stationName: '애월 마을방송국',
  hlsUrl: 'https://cdn.example/aewol.mp4',
  durationSec: 63,
  captions: [],
  publishedAt: '2026-08-15T00:00:00.000Z',
};

const aewol = (over: Partial<StationSummary> = {}): StationSummary => ({
  id: toId<StationId>('01920000-0000-7000-8000-000000000001'),
  name: '애월 마을방송국',
  region: '제주시 애월읍',
  status: StationStatus.Dormant,
  ...over,
});

async function renderFailedPlayback(stations: readonly StationSummary[]) {
  mockUsePlayback.mockReturnValue({
    isPending: false,
    isError: false,
    data: PLAYBACK,
    refetch: jest.fn(),
  });
  mockUsePublicStations.mockReturnValue({ data: stations });

  const view = await render(<WatchScreen />);
  // 플레이어가 치명적 재생 실패를 보고 → 폴백 UI로 전환
  await act(async () => {
    (mockPlayerListeners.statusChange ?? []).forEach((cb) => cb({ status: 'error' }));
  });
  return view;
}

describe('시청 화면 폴백 — 지사별 연락 채널(T-W2-28)', () => {
  const ORIGINAL_TEL = process.env.EXPO_PUBLIC_SUPPORT_TEL;

  beforeEach(() => {
    for (const key of Object.keys(mockPlayerListeners)) delete mockPlayerListeners[key];
    delete process.env.EXPO_PUBLIC_SUPPORT_TEL;
  });

  afterAll(() => {
    if (ORIGINAL_TEL !== undefined) process.env.EXPO_PUBLIC_SUPPORT_TEL = ORIGINAL_TEL;
  });

  it('지사가 대표번호를 주면 "전화로 문의하기"가 렌더되고 그 지사 번호로 걸린다', async () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    const { getByText } = await renderFailedPlayback([aewol({ supportTel: '064-000-0000' })]);

    await fireEvent.press(getByText('전화로 문의하기'));
    expect(openURL).toHaveBeenCalledWith('tel:064-000-0000');
  });

  it('env가 있어도 지사 값이 이긴다(빌드 1개=값 1개 문제의 해소 지점)', async () => {
    process.env.EXPO_PUBLIC_SUPPORT_TEL = '1670-9999';
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    const { getByText } = await renderFailedPlayback([aewol({ supportTel: '064-000-0000' })]);

    await fireEvent.press(getByText('전화로 문의하기'));
    expect(openURL).toHaveBeenCalledWith('tel:064-000-0000');
  });

  it('지사 값이 없고 env만 있으면 env로 폴백한다', async () => {
    process.env.EXPO_PUBLIC_SUPPORT_TEL = '1670-9999';
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    const { getByText } = await renderFailedPlayback([aewol()]);

    await fireEvent.press(getByText('전화로 문의하기'));
    expect(openURL).toHaveBeenCalledWith('tel:1670-9999');
  });

  it('지사도 env도 없으면 "전화로 문의하기"가 아예 렌더되지 않는다 — "다시 시도" 1개뿐', async () => {
    const { getByText, queryByText } = await renderFailedPlayback([aewol()]);

    expect(getByText('다시 시도')).toBeTruthy();
    expect(queryByText('전화로 문의하기')).toBeNull();
    expect(
      getByText('지금은 화면이 잘 안 나오고 있어요. 아래 버튼을 눌러 다시 시도해 주세요.'),
    ).toBeTruthy();
  });

  it('동명 지사가 2곳이면 매칭을 포기하고 전화 경로를 숨긴다(엉뚱한 지사로 걸지 않는다)', async () => {
    const twin = aewol({ id: toId<StationId>('01920000-0000-7000-8000-0000000000aa') });
    const { queryByText } = await renderFailedPlayback([
      aewol({ supportTel: '064-000-0000' }),
      twin,
    ]);

    expect(queryByText('전화로 문의하기')).toBeNull();
  });
});
