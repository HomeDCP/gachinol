module.exports = {
  preset: 'jest-expo',
  clearMocks: true,
  testMatch: ['**/src/**/__tests__/**/*.test.ts?(x)'],
  setupFiles: ['<rootDir>/src/test/setup.ts'],
  // 테스트도 shared를 "소스"로 소비 (Metro의 react-native 필드와 동일 원천)
  moduleNameMapper: {
    '^@gachinol/shared$': '<rootDir>/../../packages/shared/src/index.ts',
    // CSS는 Metro가 처리한다 — jest는 파싱조차 못 해 죽으므로 스텁으로 바꾼다(프로덕션 번들 무관, T-W1-04:
    // 루트 레이아웃 렌더 테스트가 처음으로 app/_layout.tsx의 `import '../src/global.css'`를 로드한다)
    '\\.css$': '<rootDir>/src/test/style-mock.js',
  },
  // pnpm isolated 대응: 실경로 node_modules/.pnpm/<pkg>@<ver>/node_modules/<pkg>/… 에서도
  // RN·expo 화이트리스트가 트랜스파일되도록 .pnpm 세그먼트 허용
  transformIgnorePatterns: [
    'node_modules/(?!(?:\\.pnpm/)?((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|react-native-svg|react-native-.*))',
  ],
};
