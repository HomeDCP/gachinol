import type { Config } from 'jest';

/**
 * 미디어 워커 단위 테스트 — ts-jest, node 환경.
 * @gachinol/shared는 dist(CJS)로 소비(패키지 main). FFmpeg 실행 테스트는 무겁지만
 * ffmpeg-static/ffprobe-static로 시스템 설치 없이 재현 가능(tiny mp4 런타임 생성).
 */
const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  moduleFileExtensions: ['js', 'json', 'ts'],
  // FFmpeg 실행 테스트 여유 (기본 5s로는 트랜스코딩 부족)
  testTimeout: 60000,
};

export default config;
