import { useMemo } from 'react';
import type { ApiClient } from '../api/client';
import { useApiClient } from '../auth/auth-context';

/**
 * 업로드 퍼널 계측 발신 (T-W1-07b, 02 §E-16 클라이언트분 — 업로드퍼널 트랙).
 *
 * 서버 카탈로그(services/api/src/telemetry/telemetry.service.ts `TelemetryEventName`)와 이름을
 * 그대로 맞춘다 — 카탈로그 밖 이름은 서버가 배치를 거부하지 않고 조용히 무시+카운트하므로(설계상
 * "유실 허용"), 오타 하나가 관측 유실로 이어져도 배치 자체는 안전하다. 다만 이름을 지어내지 않고
 * 서버 상수와 1:1 대응시킨다.
 *
 * **콘텐츠 소비(재생·자막토글) 트랙 + `large_caption_mode_toggle` 이벤트는 T-W1-07a
 * (apps/subscriber)가 소유한다** — 02 §E-16 원문이 "큰 자막 모드 토글"을 업로드퍼널 트랙 열거에
 * 함께 적었으나, 이 리포의 DD1(docs/plan/exec/E2-work-breakdown.md 113~114행)이 "큰 자막 모드
 * 토글은 T-W1-07a에" 귀속을 명시적으로 확정했다. 이 모듈은 그 이벤트를 발신하지 않는다(자막 토글
 * UI 자체가 기자 웹 업로드 위저드에 없다).
 *
 * 업로드 실패는 fire-and-forget으로 삼킨다(설계 제약) — 계측 실패가 업로드·저장 흐름을 절대
 * 막지 않는다. 호출부는 반환값을 기다릴 필요가 없다(전부 void 반환).
 */

/** 본 태스크가 소유한 위저드 2단계 — 촬영(index)·자막(scenes)은 타 태스크 소유라 계측 대상 밖 */
export type UploadFunnelStep = 'classify' | 'upload';

export interface UploadFunnelEvents {
  wizardStepEnter(step: UploadFunnelStep, contentId?: string): void;
  wizardStepExit(step: UploadFunnelStep, contentId?: string): void;
  uploadStart(contentId: string): void;
  /** 업로드 실패/중단 후 재시도 — 03 §C-3 "다시 시도" 버튼의 발신처 (upload.tsx) */
  uploadResume(contentId: string): void;
  uploadComplete(contentId: string): void;
}

/**
 * 위저드 세션 상관자 — 모듈 싱글턴(같은 브라우저 세션 동안 classify.tsx↔upload.tsx 화면 이동에
 * 걸쳐 동일 값 유지). 서버 KPI(위저드 완주율·재개 성공률)는 `sessionId` 기준 Set 교집합으로
 * 계산되므로(telemetry.service.ts), 같은 위저드 시도의 이벤트가 같은 sessionId를 공유해야 한다.
 * 새로고침·앱 재시작 시 재발급 — 세션 단위 KPI에는 이 입도로 충분하다(draft-context.tsx처럼
 * 위저드 상태를 영속화하는 신규 인프라 없이 기존 모듈 캐시만으로 상관 성립).
 */
let cachedSessionId: string | null = null;

function getSessionId(): string {
  if (!cachedSessionId) {
    cachedSessionId = `rep_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  }
  return cachedSessionId;
}

/** 테스트 전용 — 모듈 싱글턴 세션 id를 초기화해 테스트 간 독립성을 보장한다 */
export function __resetUploadFunnelSessionIdForTest(): void {
  cachedSessionId = null;
}

interface RawTelemetryEvent {
  name: string;
  sessionId?: string;
  contentId?: string;
  payload?: Record<string, unknown>;
}

/** `POST /telemetry/events`(@Public) — 배열 자체가 바디. auth:false로 세션 상태와 무관하게 발신 */
function send(client: ApiClient, event: RawTelemetryEvent): void {
  client
    .request('POST', '/telemetry/events', {
      auth: false,
      body: [{ ...event, occurredAt: new Date().toISOString() }],
    })
    .catch(() => {
      // 계측은 유실 허용 등급 — 실패를 사용자에게 노출하지 않고 조용히 삼킨다 (설계 제약)
    });
}

/**
 * 순수 팩토리 — `ApiClient`만 주입받아 React 없이도 테스트 가능
 * (`http-upload-service.ts`/`use-upload-service.ts`와 동형 패턴).
 */
export function createUploadFunnelEvents(client: ApiClient): UploadFunnelEvents {
  const sessionId = getSessionId();

  return {
    wizardStepEnter(step, contentId) {
      send(client, { name: 'upload_wizard_step_enter', sessionId, contentId, payload: { step } });
    },
    wizardStepExit(step, contentId) {
      send(client, { name: 'upload_wizard_step_exit', sessionId, contentId, payload: { step } });
    },
    uploadStart(contentId) {
      send(client, { name: 'upload_start', sessionId, contentId });
    },
    uploadResume(contentId) {
      send(client, { name: 'upload_resume', sessionId, contentId });
    },
    uploadComplete(contentId) {
      send(client, { name: 'upload_complete', sessionId, contentId });
    },
  };
}

/** ★ 화면은 이 훅으로 계측 발신기를 얻는다 (use-upload-service.ts와 동형 패턴) */
export function useUploadFunnelEvents(): UploadFunnelEvents {
  const client = useApiClient();
  return useMemo(() => createUploadFunnelEvents(client), [client]);
}
