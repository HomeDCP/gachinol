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
