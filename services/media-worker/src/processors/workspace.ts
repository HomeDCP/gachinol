import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** 잡별 임시 작업 디렉토리 생성 + 콜백 종료 후 정리(finally) */
export async function withWorkspace<T>(
  jobId: string,
  fn: (dir: string) => Promise<T>,
): Promise<T> {
  const safeId = jobId.replace(/[^a-zA-Z0-9._-]/g, '_');
  const dir = await mkdtemp(join(tmpdir(), `gachinol-${safeId}-`));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
