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
