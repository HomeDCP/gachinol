import { envSchema } from './env.schema';

/**
 * 환경변수는 **항상 문자열**로 들어온다(process.env). 불리언 스위치가 문자열 "false"를
 * 제대로 false로 읽는지가 이 스위트의 핵심이다 — z.coerce.boolean()은 이걸 true로 만들어
 * 스위치를 조용히 무력화한다(프로덕션 R2 전환 시 S3 클라이언트 오설정).
 */

/** 스키마 필수값만 채운 최소 env — 각 테스트는 여기에 대상 키만 얹는다 */
const baseEnv = (over: Record<string, string> = {}): Record<string, string> => ({
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  JWT_ACCESS_SECRET: 'access_secret_that_is_long_enough_0123456789',
  JWT_REFRESH_SECRET: 'refresh_secret_that_is_long_enough_9876543210',
  ...over,
});

describe('envSchema — 불리언 스위치', () => {
  describe.each([
    ['S3_FORCE_PATH_STYLE', true],
    ['DCP_ARBITER_HOLD_ON_IMMINENT', true],
  ] as const)('%s (기본 %s)', (key, defaultValue) => {
    it('미설정이면 기본값', () => {
      expect(envSchema.parse(baseEnv())[key]).toBe(defaultValue);
    });

    // 이 케이스가 이 파일의 존재 이유 — z.coerce.boolean()이면 true가 되어 스위치가 안 꺼진다
    it('문자열 "false" → false (스위치가 실제로 꺼진다)', () => {
      expect(envSchema.parse(baseEnv({ [key]: 'false' }))[key]).toBe(false);
    });

    it('문자열 "true" → true', () => {
      expect(envSchema.parse(baseEnv({ [key]: 'true' }))[key]).toBe(true);
    });

    it('실제 boolean도 받는다(프로그램 구성)', () => {
      expect(envSchema.parse({ ...baseEnv(), [key]: false })[key]).toBe(false);
      expect(envSchema.parse({ ...baseEnv(), [key]: true })[key]).toBe(true);
    });

    it.each(['yes', 'no', '1', '0', 'FALSE', ''])(
      '모호한 값 %p은 조용히 통과시키지 않고 부팅에서 실패시킨다',
      (raw) => {
        expect(() => envSchema.parse(baseEnv({ [key]: raw }))).toThrow();
      },
    );
  });
});

describe('envSchema — 기본 동작 회귀', () => {
  it('필수값만으로 파싱된다', () => {
    const env = envSchema.parse(baseEnv());
    expect(env.NODE_ENV).toBe('development');
    expect(env.API_PORT).toBe(4000);
    expect(env.S3_BUCKET).toBe('gachinol-media');
  });

  it('숫자 문자열은 숫자로 강제된다(coerce.number는 의도된 사용)', () => {
    expect(envSchema.parse(baseEnv({ API_PORT: '5000' })).API_PORT).toBe(5000);
  });

  it('access/refresh 시크릿이 같으면 거부한다', () => {
    const same = 'same_secret_that_is_long_enough_01234567890';
    expect(() =>
      envSchema.parse(baseEnv({ JWT_ACCESS_SECRET: same, JWT_REFRESH_SECRET: same })),
    ).toThrow();
  });

  it('DCP_ARBITER_FAIL_MODE는 hold|run만 받는다', () => {
    expect(envSchema.parse(baseEnv({ DCP_ARBITER_FAIL_MODE: 'run' })).DCP_ARBITER_FAIL_MODE).toBe(
      'run',
    );
    expect(() => envSchema.parse(baseEnv({ DCP_ARBITER_FAIL_MODE: 'maybe' }))).toThrow();
  });
});
