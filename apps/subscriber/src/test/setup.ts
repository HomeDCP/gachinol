/**
 * jest setupFiles — 익명 앱이라 secure-store 목은 불요.
 * 재생 화면 유닛 렌더를 위해 expo-video만 목으로 대체(네이티브 플레이어 부재).
 */
jest.mock('expo-video', () => ({
  useVideoPlayer: () => ({
    play: jest.fn(),
    pause: jest.fn(),
    replace: jest.fn(),
    currentTime: 0,
    timeUpdateEventInterval: 0,
    addListener: () => ({ remove: jest.fn() }),
  }),
  VideoView: () => null,
}));
