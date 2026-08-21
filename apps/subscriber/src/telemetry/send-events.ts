import type { TelemetryEventEnvelope } from '@gachinol/shared';

/* ══════════════════════════════════════════════════════════════════════════
 * 구독자 웹 계측 발신 — **이 앱 최초의 계측 코드다**(그 전까지 apps/subscriber에 0줄, 대장 #131).
 *
 * ★ 왜 `src/api/client.ts`를 쓰지 않는가
 *   그 클라이언트는 **익명 GET 전용**이고(`get<TRes>` 하나뿐), 응답을 파싱해 화면에 쓰는 용도다.
 *   계측은 POST이며 **응답을 기다리지 않고 실패해도 화면을 막지 않아야** 한다. 성격이 반대라 섞지 않는다.
 *
 * ★ 링크아웃 클릭이 이 파일의 존재 이유다 — `fetch`만으로는 유실된다
 *   링크아웃은 **사용자가 페이지를 떠나는 순간** 발생한다. 문서가 언로드되면 진행 중인 일반 `fetch`는
 *   브라우저가 취소하고, 실패 로그조차 남지 않는다(대장 #92 `Alert`와 같은 "조용한 실패"다).
 *   → `navigator.sendBeacon` 우선, 없으면 `fetch(..., { keepalive: true })`.
 *   05 §A-1의 2단계 트리거가 이 수치를 근거로 삼으므로 유실은 지표 부정확이 아니라 **판단 근거 상실**이다.
 *
 * ★ fire-and-forget이 의도다
 *   계측 실패가 링크아웃 자체를 막으면 안 된다. 예외를 밖으로 던지지 않고 삼킨다.
 * ══════════════════════════════════════════════════════════════════════════ */

export interface TelemetrySender {
  /** 즉시 발신(응답 대기 없음). 실패해도 예외를 던지지 않는다 */
  send(event: TelemetryEventEnvelope): void;
}

export interface TelemetrySenderDeps {
  /** getApiBaseUrl() — '/v1'은 여기서 붙인다 (client.ts와 동일 규약) */
  baseUrl: string;
  /** 테스트 주입용. 기본은 globalThis.navigator?.sendBeacon */
  sendBeacon?: (url: string, body: string) => boolean;
  /** 테스트 주입용. 기본 globalThis.fetch */
  fetchFn?: typeof fetch;
}

const CONTENT_TYPE = 'application/json';

function defaultSendBeacon(url: string, body: string): boolean {
  const nav = globalThis.navigator as
    | { sendBeacon?: (u: string, d: unknown) => boolean }
    | undefined;
  if (typeof nav?.sendBeacon !== 'function') return false;
  try {
    // Blob이 있으면 Content-Type을 실어 보낸다. 없으면(RN 등) 문자열 그대로 —
    // 서버가 text/plain으로 받으면 파싱에 실패하므로, 그 경우는 false를 반환해 fetch 폴백으로 넘긴다.
    const BlobCtor = (globalThis as { Blob?: typeof Blob }).Blob;
    if (!BlobCtor) return false;
    return nav.sendBeacon(url, new BlobCtor([body], { type: CONTENT_TYPE }));
  } catch {
    return false;
  }
}

export function createTelemetrySender(deps: TelemetrySenderDeps): TelemetrySender {
  const url = `${deps.baseUrl.replace(/\/$/, '')}/v1/telemetry/events`;
  const beacon = deps.sendBeacon ?? defaultSendBeacon;
  const fetchFn = deps.fetchFn ?? globalThis.fetch;

  return {
    send(event: TelemetryEventEnvelope): void {
      // 배치 상한(TELEMETRY_MAX_BATCH_SIZE)은 배열 길이 1이라 항상 만족한다.
      // 서버 계약은 "배열 그 자체가 바디"(래핑 객체 아님) — telemetry.controller.ts 참조.
      const body = JSON.stringify([event]);

      if (beacon(url, body)) return;

      // 폴백: keepalive가 있으면 언로드 후에도 전송이 이어진다(RN에는 없을 수 있으나 무해).
      try {
        void fetchFn(url, {
          method: 'POST',
          headers: { 'Content-Type': CONTENT_TYPE },
          body,
          keepalive: true,
        })?.catch(() => {
          /* 계측 실패는 화면을 막지 않는다 */
        });
      } catch {
        /* 동상 */
      }
    },
  };
}
