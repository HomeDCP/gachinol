import { loadWorkerEnv } from './env';

/**
 * 워커도 S3에 직접 쓴다 — path-style 스위치가 api와 엇갈리면 R2 전환 시 한쪽만 깨진다.
 * 환경변수는 항상 문자열이므로 "false"가 실제로 false로 읽혀야 한다
 * (z.coerce.boolean()이면 true가 되어 스위치가 조용히 무력화된다).
 */

const baseEnv = (over: Record<string, string> = {}): NodeJS.ProcessEnv => ({
  REDIS_URL: 'redis://localhost:6379',
  S3_ENDPOINT: 'http://localhost:9000',
  S3_ACCESS_KEY: 'key',
  S3_SECRET_KEY: 'secret',
  ...over,
});

describe('loadWorkerEnv — S3_FORCE_PATH_STYLE', () => {
  it('미설정이면 true (MinIO 기본)', () => {
    expect(loadWorkerEnv(baseEnv()).S3_FORCE_PATH_STYLE).toBe(true);
  });

  // 이 케이스가 이 파일의 존재 이유
  it('문자열 "false" → false (스위치가 실제로 꺼진다)', () => {
    expect(loadWorkerEnv(baseEnv({ S3_FORCE_PATH_STYLE: 'false' })).S3_FORCE_PATH_STYLE).toBe(false);
  });

  it('문자열 "true" → true', () => {
    expect(loadWorkerEnv(baseEnv({ S3_FORCE_PATH_STYLE: 'true' })).S3_FORCE_PATH_STYLE).toBe(true);
  });

  it.each(['yes', '1', '0', 'FALSE', ''])(
    '모호한 값 %p은 부팅에서 실패시킨다(조용한 오설정 금지)',
    (raw) => {
      expect(() => loadWorkerEnv(baseEnv({ S3_FORCE_PATH_STYLE: raw }))).toThrow(
        /환경변수 검증 실패/,
      );
    },
  );
});

describe('loadWorkerEnv — 기존 동작 회귀', () => {
  it('필수값만으로 로드되고 기본값이 채워진다', () => {
    const env = loadWorkerEnv(baseEnv());
    expect(env.S3_REGION).toBe('ap-northeast-2');
    expect(env.MEDIA_WORKER_CONCURRENCY).toBe(2);
    expect(env.MEDIA_RENDITION_HEIGHT).toBe(720);
  });

  it('숫자 문자열은 숫자로 강제된다', () => {
    expect(loadWorkerEnv(baseEnv({ MEDIA_WORKER_CONCURRENCY: '1' })).MEDIA_WORKER_CONCURRENCY).toBe(
      1,
    );
  });

  it('필수 키 누락 시 키 이름을 포함해 실패한다', () => {
    const withoutKey = baseEnv();
    delete withoutKey.S3_ACCESS_KEY;
    expect(() => loadWorkerEnv(withoutKey)).toThrow(/S3_ACCESS_KEY/);
  });
});

/**
 * 대장 #240 — MEDIA_MASTER_HEIGHT → MEDIA_MASTER_LONG_EDGE/MEDIA_MASTER_SHORT_EDGE 개명.
 * z.object는 모르는 키를 조용히 버린다(process.env 전체를 파싱해 .strict()를 못 쓴다) — 개명만
 * 하면 구 키를 계속 설정해도 에러도 효과도 없는 조용한 오설정이 된다. loadWorkerEnv가 구 키를
 * 명시적으로 감지해 즉사시켜야 한다.
 */
describe('loadWorkerEnv — MEDIA_MASTER_HEIGHT 폐기 키 fail-fast(대장 #240)', () => {
  it('MEDIA_MASTER_HEIGHT가 설정되면 부팅 즉시 실패하고 새 키를 안내한다', () => {
    expect(() =>
      loadWorkerEnv(baseEnv({ MEDIA_MASTER_HEIGHT: '1080' })),
    ).toThrow(/MEDIA_MASTER_HEIGHT.*대장 #240/s);
    expect(() => loadWorkerEnv(baseEnv({ MEDIA_MASTER_HEIGHT: '1080' }))).toThrow(
      /MEDIA_MASTER_LONG_EDGE/,
    );
    expect(() => loadWorkerEnv(baseEnv({ MEDIA_MASTER_HEIGHT: '1080' }))).toThrow(
      /MEDIA_MASTER_SHORT_EDGE/,
    );
  });

  it('새 키(MEDIA_MASTER_LONG_EDGE/MEDIA_MASTER_SHORT_EDGE)는 정상 로드되고 기본값을 갖는다', () => {
    const env = loadWorkerEnv(baseEnv());
    expect(env.MEDIA_MASTER_LONG_EDGE).toBe(1920);
    expect(env.MEDIA_MASTER_SHORT_EDGE).toBe(1080);
  });

  it('새 키는 override된다', () => {
    const env = loadWorkerEnv(
      baseEnv({ MEDIA_MASTER_LONG_EDGE: '2560', MEDIA_MASTER_SHORT_EDGE: '1440' }),
    );
    expect(env.MEDIA_MASTER_LONG_EDGE).toBe(2560);
    expect(env.MEDIA_MASTER_SHORT_EDGE).toBe(1440);
  });
});
