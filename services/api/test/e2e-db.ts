import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const FLAG_FILE = join(__dirname, '.e2e-db.json');

export interface E2eDbInfo {
  available: boolean;
  adminEmail?: string;
  adminPassword?: string;
}

/** globalSetup이 기록한 플래그 파일 동기 확인 — DB 없으면 스위트를 skip으로 녹색 종료 */
export const e2eDb = (): E2eDbInfo => {
  try {
    return JSON.parse(readFileSync(FLAG_FILE, 'utf8')) as E2eDbInfo;
  } catch {
    return { available: false };
  }
};

export const dbAvailable = (): boolean => e2eDb().available;

/** DB 필요 스위트용: `const d = describeWithDb(); d('...', () => ...)` */
export const describeWithDb = (): jest.Describe => (dbAvailable() ? describe : describe.skip);
