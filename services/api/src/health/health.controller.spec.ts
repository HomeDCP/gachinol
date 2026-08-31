import type { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.schema';
import { HealthController } from './health.controller';

/**
 * `GET /health/version` — 배포된 이미지의 커밋 SHA 노출(대장 #186).
 * liveness/readiness는 terminus 표준 응답이라(기존 계약) 여기서는 신설 계약만 검증한다.
 */
const setup = (gitSha: string) => {
  const config = { get: () => gitSha } as unknown as ConfigService<Env, true>;
  const controller = new HealthController(
    undefined as never,
    undefined as never,
    undefined as never,
    config,
  );
  return { controller };
};

describe('HealthController — version', () => {
  it('GIT_SHA가 설정되면 그 값을 그대로 반환한다', () => {
    const { controller } = setup('abc1234deadbeef');

    expect(controller.version()).toEqual({ sha: 'abc1234deadbeef' });
  });

  it('GIT_SHA 미설정 시 빈 문자열이 아니라 unknown을 반환한다', () => {
    const { controller } = setup('unknown'); // env.schema.ts 기본값과 동형(zod default)

    expect(controller.version()).toEqual({ sha: 'unknown' });
  });
});
