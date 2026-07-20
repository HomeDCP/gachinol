#!/usr/bin/env node
/**
 * Prisma CLI를 .env 로드 후 실행하는 래퍼.
 *
 * Prisma CLI는 cwd(./ 또는 ./prisma)의 .env만 읽고 상위 디렉토리로 탐색하지 않는다 —
 * README 표준 위치(리포 루트 .env)를 그대로 쓰면 DATABASE_URL 누락으로 실패한다.
 * 여기서 services/api/.env → 리포 루트 .env 순으로 로드해 문서화된 플로우를 실제로 동작시킨다.
 * 우선순위(앞이 이김): 셸 env > services/api/.env > 리포 루트 .env
 * (process.loadEnvFile은 이미 설정된 변수를 덮어쓰지 않는다 — Node 21.7+)
 *
 * 사용: node scripts/prisma-with-env.mjs <prisma args...>
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url)); // services/api/scripts
for (const envPath of [resolve(here, '../.env'), resolve(here, '../../../.env')]) {
  if (existsSync(envPath)) process.loadEnvFile(envPath);
}

// pnpm 스크립트 경유 실행이라 node_modules/.bin이 PATH에 있다
const result = spawnSync('prisma', process.argv.slice(2), {
  stdio: 'inherit',
  env: process.env,
  shell: process.platform === 'win32',
});
process.exit(result.status ?? 1);
