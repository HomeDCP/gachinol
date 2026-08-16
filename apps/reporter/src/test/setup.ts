/**
 * jest setupFiles — expo-secure-store를 in-memory Map으로 mock.
 * 테스트에서 저장소 내부를 검사하려면 jest.requireMock('expo-secure-store').__store 사용.
 */
jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    AFTER_FIRST_UNLOCK: 'AFTER_FIRST_UNLOCK',
    __store: store,
    async getItemAsync(key: string): Promise<string | null> {
      return store.has(key) ? (store.get(key) ?? null) : null;
    },
    async setItemAsync(key: string, value: string): Promise<void> {
      store.set(key, value);
    },
    async deleteItemAsync(key: string): Promise<void> {
      store.delete(key);
    },
  };
});

/**
 * 화면 렌더 테스트(T-W2-26)를 위한 expo-video 목 — 네이티브 플레이어 부재(subscriber
 * src/test/setup.ts와 동형 패턴). 원본 재생 화면(resident-uploads/[id].tsx 등)을 렌더할 때 필요.
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
