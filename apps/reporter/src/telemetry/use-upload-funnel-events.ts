import { TelemetryEventName, type TelemetryEventEnvelope } from '@gachinol/shared';
import { useMemo } from 'react';
import { AppState, Platform } from 'react-native';
import type { ApiClient } from '../api/client';
import { useApiClient } from '../auth/auth-context';
import { createTelemetryBatchQueue, type TelemetryBatchQueue } from './telemetry-batch';

/**
 * 업로드 퍼널 계측 발신 (T-W1-07b, 02 §E-16 클라이언트분 — 업로드퍼널 트랙).
 *
 * ★ 이벤트 이름의 단일 원천은 `@gachinol/shared`의 `TelemetryEventName`이다 (T-W2-29, 대장 #128 ⓐ).
 *   과거에는 이 파일이 서버 카탈로그와 같은 문자열을 **리터럴로 재타이핑**했다. 서버는 카탈로그 밖
 *   이름을 400으로 거부하지 않고 조용히 무시+카운트하므로(계측=유실 허용 등급), 오타 하나가 아무
 *   실패 없이 관측을 영구 유실시켰고 테스트도 같은 리터럴을 자기참조로 단언해 잡지 못했다.
 *   이제 아래 `emit()`이 `name: TelemetryEventName`을 요구하므로 **카탈로그 밖 이름은 tsc가 거부**한다.
 *
 * ★ 전송은 배치 큐를 거친다 (T-W2-29, 대장 #128 ⓑ) — 플러시 조건·유실 정책은
 *   `telemetry-batch.ts` 상단 주석이 원천이다(사본 금지).
 *
 * **콘텐츠 소비(재생·자막토글) 트랙 + `large_caption_mode_toggle` 이벤트는 T-W1-07a
 * (apps/subscriber)가 소유한다** — 02 §E-16 원문이 "큰 자막 모드 토글"을 업로드퍼널 트랙 열거에
 * 함께 적었으나, 이 리포의 DD1(docs/plan/exec/E2-work-breakdown.md 113~114행)이 "큰 자막 모드
 * 토글은 T-W1-07a에" 귀속을 명시적으로 확정했다. 이 모듈은 그 이벤트를 발신하지 않는다(자막 토글
 * UI 자체가 기자 웹 업로드 위저드에 없다). 카탈로그 ③ 모드선택 트랙(`TelemetryEventName.ModeSelected`)도
 * 발신하지 않는다 — 대장 #123으로 프로덕션에서 제거했다(존재하지 않는 "간단 모드"의 선택지를
 * 계측하면 채택률 KPI가 무의미해진다). **재도입 금지**(이름 리터럴조차 이 파일에 남기지 않는다 —
 * 기자 앱 프로덕션 코드에 그 문자열이 0건임을 grep으로 고정하는 수용 기준이 있다).
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

/**
 * 배치 큐도 **모듈 싱글턴**이다 — 화면(classify.tsx·upload.tsx)마다 팩토리가 새로 호출되지만 큐가
 * 화면별로 나뉘면 배치가 쪼개지고(요청 절감 효과 상실) 화면 언마운트 시 대기분이 통째로 사라진다.
 * `ApiClient`는 큐를 재생성하지 않고 아래 참조만 갈아끼운다(로그인/로그아웃으로 클라이언트 인스턴스가
 * 바뀌어도 대기 중인 계측을 버리지 않기 위해 — 이 엔드포인트는 @Public이라 토큰과 무관하다).
 */
let currentClient: ApiClient | null = null;
let queue: TelemetryBatchQueue | null = null;
let detachFlushTriggers: (() => void) | null = null;

/** `POST /telemetry/events`(@Public) — 배열 자체가 바디. auth:false로 세션 상태와 무관하게 발신 */
function sendBatch(batch: readonly TelemetryEventEnvelope[]): Promise<unknown> {
  const client = currentClient;
  if (!client) return Promise.reject(new Error('ApiClient가 아직 바인딩되지 않았습니다'));
  return client.request('POST', '/telemetry/events', { auth: false, body: batch });
}

/**
 * 앱이 백그라운드로 가거나(네이티브) 탭이 숨겨지면(웹) 즉시 플러시한다 — 배치 큐의 유일한 실질적
 * 유실 구간이 "전송 전 종료"이므로 마지막 기회를 잡는다. 웹은 `AppState`(react-native-web)만으로는
 * 신뢰하기 어려워 `visibilitychange`도 함께 건다(둘 다 걸려도 플러시는 멱등 — 큐가 비어 있으면 no-op).
 */
function attachFlushTriggers(): void {
  if (detachFlushTriggers) return;
  const offs: Array<() => void> = [];

  const subscription = AppState.addEventListener('change', (state) => {
    if (state !== 'active') queue?.flush();
  });
  offs.push(() => subscription.remove());

  if (Platform.OS === 'web' && typeof document !== 'undefined') {
    const onVisibilityChange = (): void => {
      if (document.visibilityState === 'hidden') queue?.flush();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    offs.push(() => document.removeEventListener('visibilitychange', onVisibilityChange));
  }

  detachFlushTriggers = () => {
    for (const off of offs) off();
    detachFlushTriggers = null;
  };
}

function getQueue(): TelemetryBatchQueue {
  if (!queue) {
    queue = createTelemetryBatchQueue({ send: sendBatch });
    attachFlushTriggers();
  }
  return queue;
}

/**
 * 테스트 전용 — 모듈 싱글턴(세션 id·배치 큐·플러시 트리거)을 초기화해 테스트 간 독립성을 보장한다.
 * 큐에 남아 있던 대기분은 폐기된다.
 */
export function __resetUploadFunnelTelemetryForTest(): void {
  cachedSessionId = null;
  queue?.dispose();
  queue = null;
  detachFlushTriggers?.();
  currentClient = null;
}

/** 큐 적재 — `name`이 shared 카탈로그로 좁혀져 있어 카탈로그 밖 문자열은 tsc가 거부한다 */
function emit(
  name: TelemetryEventName,
  fields: Omit<TelemetryEventEnvelope, 'name' | 'occurredAt'>,
  /** 놓치면 KPI가 깨지는 종단 신호는 배치 지연 없이 즉시 내보낸다 */
  flushNow = false,
): void {
  const q = getQueue();
  // occurredAt은 **적재 시각**(전송 시각 아님) — 배치 지연이 이벤트 시각을 왜곡하면 안 된다
  q.enqueue({ ...fields, name, occurredAt: new Date().toISOString() });
  if (flushNow) q.flush();
}

/**
 * 순수 팩토리 — `ApiClient`만 주입받아 React 없이도 테스트 가능
 * (`http-upload-service.ts`/`use-upload-service.ts`와 동형 패턴).
 */
export function createUploadFunnelEvents(client: ApiClient): UploadFunnelEvents {
  currentClient = client;
  const sessionId = getSessionId();

  return {
    wizardStepEnter(step, contentId) {
      emit(TelemetryEventName.WizardStepEnter, { sessionId, contentId, payload: { step } });
    },
    wizardStepExit(step, contentId) {
      emit(TelemetryEventName.WizardStepExit, { sessionId, contentId, payload: { step } });
    },
    uploadStart(contentId) {
      emit(TelemetryEventName.UploadStart, { sessionId, contentId });
    },
    uploadResume(contentId) {
      emit(TelemetryEventName.UploadResume, { sessionId, contentId });
    },
    uploadComplete(contentId) {
      // 퍼널 종단 = 완주율 KPI의 분자. 여기서 5초를 더 기다리다 탭이 닫히면 그 세션은 영구히
      // "미완주"로 집계된다 → 즉시 플러시(이때 큐에 쌓여 있던 앞선 이벤트들도 같은 요청에 실린다).
      emit(TelemetryEventName.UploadComplete, { sessionId, contentId }, true);
    },
  };
}

/** ★ 화면은 이 훅으로 계측 발신기를 얻는다 (use-upload-service.ts와 동형 패턴) */
export function useUploadFunnelEvents(): UploadFunnelEvents {
  const client = useApiClient();
  return useMemo(() => createUploadFunnelEvents(client), [client]);
}
