import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NOT_WIRED_CONTENT_TRANSITIONS, reconcileContentWiring } from '@gachinol/shared';

/**
 * ★ 양방향 검증 — api 단위 스위트 globalTeardown (EXEC-DECISIONS #29 1계층).
 *
 * ```
 * 미관측 집합 = CONTENT_STATUS_TRANSITIONS 전체 엣지 − 실행 중 관측된 엣지
 * 판정: 미관측 집합 == NOT_WIRED  (양방향 정확 일치)
 * ```
 * 역방향("등재됐는데 관측됨 → 레드")이 이 설계의 핵심이다 — 목록이 stale되면 스위트가 깨지므로
 * 박제가 구조적으로 불가능해진다.
 *
 * ── 왜 globalTeardown인가(집계 시점) ───────────────────────────────────
 * 판정은 **스위트 전체가 끝난 뒤에만** 가능한데, jest는 테스트 파일 실행 순서를 보장하지 않고
 * 워커가 별도 프로세스라 "마지막에 도는 전용 스펙"을 만들 수 없다(그 스펙이 먼저 돌면 전부 미관측으로
 * 보인다). globalTeardown은 **모든 워커 종료 후 정확히 1회** 실행되는 유일한 훅이다.
 * 별도 스크립트(`pnpm test && node check.mjs`)도 가능하지만 게이트 명령이
 * `pnpm --filter @gachinol/api test` 하나라, 훅 안에 두어야 **그 한 줄이 곧 검증**이 된다.
 *
 * ── 부분 실행 보호 ─────────────────────────────────────────────────────
 * `jest -t …`·경로 필터·`--onlyChanged`로 일부만 돌리면 관측이 당연히 비어 오탐이 난다.
 * 그래서 **필터 없는 전체 실행일 때만** 강제한다(부분 실행은 안내만 출력).
 */

interface JestGlobalConfigLike {
  testPathPattern?: string;
  testPathPatterns?: readonly string[];
  testNamePattern?: string;
  onlyChanged?: boolean;
  onlyFailures?: boolean;
  findRelatedTests?: boolean;
  lastCommit?: boolean;
}

const isFullRun = (g: JestGlobalConfigLike): boolean =>
  !g.testPathPattern &&
  (g.testPathPatterns === undefined || g.testPathPatterns.length === 0) &&
  !g.testNamePattern &&
  !g.onlyChanged &&
  !g.onlyFailures &&
  !g.findRelatedTests &&
  !g.lastCommit;

const readObserved = (dir: string): string[] => {
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.ndjson'));
  } catch {
    return [];
  }
  const keys = new Set<string>();
  for (const f of files) {
    for (const line of readFileSync(join(dir, f), 'utf8').split('\n')) {
      const key = line.trim();
      if (key) keys.add(key);
    }
  }
  return [...keys];
};

/** 초기 등재/재등재용 — 관측·미관측 전문을 NOT_WIRED 소스 형태로 출력 */
const printReport = (observed: readonly string[], unobserved: readonly string[]): void => {
  const lines = unobserved.map((k) => {
    const [from, to] = k.split('→');
    return `  { from: '${from}', to: '${to}', kind: NotWiredKind.Unimplemented, reason: 'TODO' },`;
  });
  console.log(
    `\n[wiring] 관측 엣지 ${observed.length}건 (= 구동 확인):\n` +
      `${[...observed].sort().map((k) => `    ${k}`).join('\n')}\n` +
      `\n[wiring] 미관측 엣지 ${unobserved.length}건 — packages/shared/src/content/not-wired.ts 등재 후보\n` +
      `${lines.join('\n')}\n`,
  );
};

export default function globalTeardown(globalConfig: JestGlobalConfigLike = {}): void {
  const dir =
    (globalThis as { __GACHINOL_WIRING_DIR__?: string }).__GACHINOL_WIRING_DIR__ ??
    process.env.GACHINOL_WIRING_PROBE_DIR;
  if (!dir) return;

  const observed = readObserved(dir);
  const report = reconcileContentWiring(observed);

  if (process.env.GACHINOL_WIRING_REPORT === '1') {
    printReport(observed, report.unobserved);
  }

  if (!isFullRun(globalConfig)) {
    console.warn(
      '\n[wiring] 부분 실행이라 미구동 레지스트리 대조를 건너뜁니다 (전체 실행에서만 강제)\n',
    );
    return;
  }
  if (report.ok) return;

  const sections: string[] = [];
  if (report.missingFromRegistry.length > 0) {
    sections.push(
      `· 테스트가 밟지 않는데 NOT_WIRED에 없음 ${report.missingFromRegistry.length}건 —\n` +
        `  구현했으면 그 엣지를 밟는 테스트를 쓰고, 안 했으면 등재하라:\n` +
        report.missingFromRegistry.map((k) => `    ${k}`).join('\n'),
    );
  }
  if (report.staleInRegistry.length > 0) {
    sections.push(
      `· NOT_WIRED에 있는데 실제로 관측됨 ${report.staleInRegistry.length}건 —\n` +
        `  구동되고 있으니 목록에서 빼라(박제 금지):\n` +
        report.staleInRegistry.map((k) => `    ${k}`).join('\n'),
    );
  }
  if (report.unknownInRegistry.length > 0) {
    sections.push(
      `· NOT_WIRED에 있는데 CONTENT_STATUS_TRANSITIONS에 없는 엣지 ${report.unknownInRegistry.length}건 —\n` +
        `  전이맵에 없는 엣지는 등재 대상이 아니다:\n` +
        report.unknownInRegistry.map((k) => `    ${k}`).join('\n'),
    );
  }
  if (report.illegalObserved.length > 0) {
    sections.push(
      `· 전이맵에 없는 엣지가 관측됨 ${report.illegalObserved.length}건 (계측/가드 이상):\n` +
        report.illegalObserved.map((k) => `    ${k}`).join('\n'),
    );
  }

  throw new Error(
    `\n[wiring] 미구동 계약 레지스트리 불일치 (EXEC-DECISIONS #29 1계층)\n` +
      `  관측 ${observed.length}건 / 미관측 ${report.unobserved.length}건 / 등재 ${NOT_WIRED_CONTENT_TRANSITIONS.length}건\n` +
      `${sections.join('\n')}\n\n` +
      `  레지스트리: packages/shared/src/content/not-wired.ts\n` +
      `  실패한 테스트가 있으면 관측이 줄어 이 대조도 함께 어긋난다 — 먼저 그쪽을 고쳐라.\n` +
      `  미관측 전문을 다시 뽑으려면: GACHINOL_WIRING_REPORT=1 pnpm --filter @gachinol/api test\n`,
  );
}
