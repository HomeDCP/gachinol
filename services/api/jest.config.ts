import type { Config } from 'jest';

/** 단위 테스트 — DB 불요(Prisma mock), 항상 실행 */
const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  moduleFileExtensions: ['js', 'json', 'ts'],
  collectCoverageFrom: ['**/*.ts'],
  coverageDirectory: '../coverage',
  // 미구동 계약 레지스트리 양방향 검증 (EXEC-DECISIONS #29 1계층).
  // setup이 계측 수집 디렉터리를 열고, teardown이 전 워커 종료 후 1회 대조한다.
  globalSetup: '<rootDir>/../test/wiring/global-setup.ts',
  globalTeardown: '<rootDir>/../test/wiring/global-teardown.ts',
};

export default config;
