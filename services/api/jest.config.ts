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
};

export default config;
