/**
 * E2E 기본 env — 로컬 전용 값. 이미 설정된 env가 우선한다.
 * (globalSetup과 각 테스트 워커 양쪽에서 import — jest setupFiles)
 *
 * DATABASE_URL 기본값은 개발 DB(gachinol)가 아닌 전용 테스트 DB(gachinol_test) —
 * e2e는 스위트마다 TRUNCATE CASCADE를 실행하므로 개발 DB와 절대 공유하면 안 된다.
 * (테스트 DB는 globalSetup이 없으면 만들어 준다. 이름에 'test'가 없으면 스위트를 거부한다.)
 */
process.env.NODE_ENV ??= 'test';
process.env.DATABASE_URL ??= 'postgresql://gachinol:gachinol@localhost:5432/gachinol_test';
process.env.JWT_ACCESS_SECRET ??= 'e2e-access-secret-local-only-0000000000';
process.env.JWT_REFRESH_SECRET ??= 'e2e-refresh-secret-local-only-000000000';
process.env.SEED_ADMIN_EMAIL ??= 'admin@e2e.local';
process.env.SEED_ADMIN_PASSWORD ??= 'e2e-admin-password';

/** e2e가 TRUNCATE 대상으로 삼아도 되는 DB인지 — 이름에 'test'가 있어야 한다 */
export const isSafeTestDbUrl = (url: string): boolean => {
  try {
    return /test/i.test(new URL(url).pathname.replace(/^\//, ''));
  } catch {
    return false;
  }
};
