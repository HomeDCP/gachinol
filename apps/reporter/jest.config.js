module.exports = {
  preset: 'jest-expo',
  clearMocks: true,
  // 렌더 테스트 타임아웃 — jest 기본 5초는 **CI 러너에서 부족하다**(대장 #157).
  //
  // 원인은 테스트 로직이 아니라 **트랜스파일 비용의 배분**이다: jest-expo가 react-native 트리를
  // babel로 변환하는데, 그 앱의 **첫 렌더 테스트 하나가 그 비용을 통째로 떠안는다**.
  // 실측(같은 테스트, `published 콘텐츠에 보관 버튼…`):
  //   로컬 캐시 warm 106ms → 로컬 `--no-cache` 1,097ms(10배) → CI 16,473ms(거기서 다시 15배).
  // 즉 두 배율(캐시 부재 × 러너 성능)이 곱해진다. 둘 다 우리가 통제하지 못한다.
  //
  // 30초는 CI 실측 최댓값(16.5초)의 약 1.8배다 — 15초로 뒀다가 실측보다 작아 되돌린 이력이 있다.
  // 무제한이 아니라 상한을 두는 이유는 진짜 무한대기(해결되지 않는 Promise·누락된 act)를
  // 여전히 실패로 잡기 위해서다.
  testTimeout: 30000,
  testMatch: ['**/src/**/__tests__/**/*.test.ts?(x)'],
  setupFiles: ['<rootDir>/src/test/setup.ts'],
  // 테스트도 shared를 "소스"로 소비 (Metro의 react-native 필드와 동일 원천)
  moduleNameMapper: { '^@gachinol/shared$': '<rootDir>/../../packages/shared/src/index.ts' },
  // pnpm isolated 대응: 실경로 node_modules/.pnpm/<pkg>@<ver>/node_modules/<pkg>/… 에서도
  // RN·expo 화이트리스트가 트랜스파일되도록 .pnpm 세그먼트 허용
  transformIgnorePatterns: [
    'node_modules/(?!(?:\\.pnpm/)?((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|react-native-svg|react-native-.*))',
  ],
};
