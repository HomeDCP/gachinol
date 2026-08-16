import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * api 단위 스위트 globalSetup — 콘텐츠 전이 계측 수집 디렉터리 준비 (EXEC-DECISIONS #29 1계층).
 *
 * 매 실행마다 **새 임시 디렉터리**를 만든다 → 이전 실행·다른 스위트(e2e)의 관측이 절대 섞이지 않는다
 * (stale 관측이 섞이면 "NOT_WIRED에 있는데 관측됨" 오탐이 난다).
 * 여기서 심은 `process.env`는 globalSetup 이후 fork되는 jest 워커에 그대로 상속된다 —
 * 그래서 `src/contents/transition-probe.ts`의 이중 게이트가 이 실행에서만 열린다.
 */
export default function globalSetup(): void {
  const dir = mkdtempSync(join(tmpdir(), 'gachinol-wiring-'));
  process.env.GACHINOL_WIRING_PROBE_DIR = dir;
  // globalTeardown은 별도 모듈 인스턴스라 전역 변수를 공유하지 못한다 — env로 넘긴다
  (globalThis as { __GACHINOL_WIRING_DIR__?: string }).__GACHINOL_WIRING_DIR__ = dir;
  process.on('exit', () => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* 정리 실패는 무시 */
    }
  });
}
