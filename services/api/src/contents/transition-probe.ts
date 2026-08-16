import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ContentStatus } from '@gachinol/shared';
import { contentTransitionKey } from '@gachinol/shared';

/**
 * ★ 콘텐츠 전이 런타임 계측 — EXEC-DECISIONS #29 1계층 (테스트 전용).
 *
 * 왜 런타임인가: 정적 grep은 이 코드베이스에서 성립하지 않는다(#29 ②). 전이 실행 인자 대부분이
 * 변수다 — `recommendations.service.ts:275`의 `applySystemTransition(id, from, …)`,
 * `content-workflow.service.ts`의 `assertAllowed(from, to)` 12곳. 그래서 **실제로 실행된 엣지**를
 * 단일 관문(`ContentWorkflowService.applyHop`)에서 수집한다.
 *
 * ── 프로덕션 영향 0의 근거 ─────────────────────────────────────────────
 * 1) 활성화 조건이 **모듈 로드 시점 1회**만 평가되고 그 결과가 `recordContentTransition`에
 *    바인딩된다. 비활성이면 이 심볼은 **본문이 빈 함수**다 — 분기·문자열 결합·I/O가 전부 없다.
 * 2) 조건이 **이중 게이트**다: `NODE_ENV === 'test'` **그리고** `GACHINOL_WIRING_PROBE_DIR`.
 *    후자는 api 단위 jest의 globalSetup만 설정한다(런타임 설정·`.env`·컨테이너 어디에도 없다).
 *    프로덕션(`NODE_ENV=production`)·개발(`nest start`)·e2e 스위트 전부 비활성이다.
 * 3) 신규 env 키를 `config/env.schema.ts`에 추가하지 않는다(리포 관례). 이 변수는 애플리케이션
 *    설정이 아니라 **테스트 하네스 채널**이라 스키마에 넣으면 프로덕션 계약이 오염된다 —
 *    그래서 `process.env` 직접 참조를 이 모듈 **한 곳에 가둔다**(다른 어떤 파일도 읽지 않는다).
 * 4) 기록 실패는 삼켜진다(catch) — 계측이 프로덕션/테스트 동작을 바꾸지 않는다.
 *
 * ── 수집 방식 ──────────────────────────────────────────────────────────
 * jest 워커는 별도 **프로세스**라 인메모리 집계가 합쳐지지 않는다. 그래서 워커마다 자기 pid 파일에
 * **최초 관측 시 1회만** append 한다(엣지 종류가 유한하므로 전체 실행에서 수십 회 이하).
 * 프로세스가 강제 종료돼도 이미 쓰인 관측은 남는다(exit 훅 의존 없음).
 */

const PROBE_DIR: string | undefined =
  process.env.NODE_ENV === 'test' ? process.env.GACHINOL_WIRING_PROBE_DIR : undefined;

/** 전이 관측 기록 — 비활성 시 본문 없는 함수(호출 비용만, 부작용 0) */
export const recordContentTransition: (from: ContentStatus, to: ContentStatus) => void = PROBE_DIR
  ? (() => {
      const file = join(PROBE_DIR, `${process.pid}.ndjson`);
      const seen = new Set<string>();
      return (from: ContentStatus, to: ContentStatus): void => {
        const key = contentTransitionKey(from, to);
        if (seen.has(key)) return;
        seen.add(key);
        try {
          appendFileSync(file, `${key}\n`, 'utf8');
        } catch {
          // 계측 실패가 테스트를 깨뜨리지 않는다
        }
      };
    })()
  : () => {
      /* 비활성 — 프로덕션 경로 */
    };

/** 계측 활성 여부 (하네스 자기점검용) */
export const isTransitionProbeEnabled = (): boolean => PROBE_DIR !== undefined;
