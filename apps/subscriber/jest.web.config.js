// apps/subscriber/jest.web.config.js — 웹 플랫폼 해석 축 전용 jest 설정 (QUEUE 2-2, 대장 #178).
//
// ⚠️ 파일명이 `jest.config.web.js`가 아니라 `jest.web.config.js`인 이유는
// apps/reporter/jest.web.config.js 헤더 참조(요지: `.web.js`로 끝나면 web-platform-test-gate.mjs가
// 이 설정 파일 자신을 오탐한다).
//
// reporter/jest.web.config.js와 동형(설계 근거 주석은 그쪽이 원본 — 사본 최소화를 위해 이 파일은
// subscriber 고유의 차이점만 상세히 적는다).
//
// ── subscriber 고유 — transformIgnorePatterns를 건드리지 않는 이유(C-3 실행 확인) ──────
// 이 앱의 .web.* 대상 3개 중 2개(register-service-worker.web.ts·hls-video.web.tsx)는 외부
// 런타임 의존(workbox-window·hls.js)이 있다. 프리셋 기본 transformIgnorePatterns
// (.pnpm|react-native|@react-native|expo|@expo|@expo-google-fonts|react-navigation|
// @react-navigation|@sentry/react-native|native-base 화이트리스트)에는 이 둘이 없어 babel
// 변환 대상에서 빠진다 — 그런데도 실행이 되는 이유는 변환이 "필요 없기" 때문이다(실측,
// package.json):
//   · hls.js@1.7.0 — exports.".".require = "./dist/hls.js"(사전 빌드된 CJS) → require()로
//     그대로 로드 가능.
//   · workbox-window@7.4.1 — main = "build/workbox-window.prod.umd.js"(UMD) → require()로
//     그대로 로드 가능.
// 두 값 모두 실측 재현: node -e 아래로 각 패키지 package.json의 main/exports 필드 확인.
// 그래서 이 설정은 transformIgnorePatterns를 아예 설정하지 않는다(프리셋 기본값 상속) — 앱
// jest.config.js처럼 이 키를 직접 두면 프리셋 값을 완전 대체하므로(병합 아님, C-3 실행 확인)
// 오히려 위 화이트리스트가 빠져나갈 위험만 생긴다.
module.exports = {
  preset: 'jest-expo/web',
  rootDir: __dirname,
  clearMocks: true,
  testTimeout: 30000,
  testMatch: ['<rootDir>/src/**/__web_tests__/**/*.test.ts?(x)'],
  moduleNameMapper: { '^@gachinol/shared$': '<rootDir>/../../packages/shared/src/index.ts' },
};
