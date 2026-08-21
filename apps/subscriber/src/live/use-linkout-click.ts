import { useCallback, useMemo } from 'react';
import { Linking } from 'react-native';
import type { LiveSessionId, ProductCard } from '@gachinol/shared';
import { isSafeLinkoutUrl, TelemetryEventName } from '@gachinol/shared';
import { getApiBaseUrl } from '../config/env';
import { createTelemetrySender, type TelemetrySender } from '../telemetry/send-events';

/* ══════════════════════════════════════════════════════════════════════════
 * 링크아웃 클릭 — **계측 발신이 먼저, 이동이 나중**.
 *
 * ★ 순서가 요점이다. 이동을 먼저 시키면 문서가 언로드되며 발신이 취소될 수 있다.
 *   `send()`는 sendBeacon 기반이라 **동기적으로 큐에 넣고 즉시 반환**하므로 이동을 지연시키지 않는다
 *   (send-events.ts 주석 참조).
 *
 * ★ 이동 실패가 계측을 되돌리지 않는다 — 계측은 "클릭이 일어났다"의 기록이고, 이동 성공 여부는
 *   외부 브라우저·앱의 사정이다. 둘을 트랜잭션으로 묶으면 클릭 수가 실제보다 적게 잡힌다.
 *
 * ★ URL을 **여기서 한 번 더** 검증한다(shared 규칙 재사용, 사본 아님). 저장 경계(api zod)와
 *   읽기 경계(api mapper)가 이미 막지만, 구버전 잔재·수기 DB 수정이 화면까지 도달하는 경로를
 *   최종적으로 끊는다. 규칙이 한 곳(shared)에 있으므로 세 겹이 어긋날 수 없다.
 * ══════════════════════════════════════════════════════════════════════════ */

export interface UseLinkoutClickDeps {
  /** 테스트 주입용 — 기본은 실 sender */
  sender?: TelemetrySender;
  /** 테스트 주입용 — 기본 Linking.openURL */
  openUrl?: (url: string) => Promise<unknown>;
}

export interface LinkoutClickHandler {
  /** 카드 클릭 — 계측 후 외부 판매 채널로 이동. 부적격 URL이면 아무 것도 하지 않고 false */
  (card: ProductCard): boolean;
}

export interface LinkoutClickContext {
  liveSessionId: LiveSessionId;
  sender: TelemetrySender;
  openUrl: (url: string) => Promise<unknown>;
}

/**
 * 판정·발신·이동의 전부 — **순수 함수로 분리했다**(React 훅 밖에서 그대로 검증 가능).
 *
 * Wave 8a의 관찰: 화면·훅 안에 판정 로직을 쓰면 그 분기를 통째로 지워도 전 스위트가 그린이었다
 * (3태스크가 같은 형태의 결함을 하나씩 만들었다). 여기 로직이 밖에 있어야 뮤테이션이 실제로 잡힌다.
 */
export function performLinkoutClick(card: ProductCard, ctx: LinkoutClickContext): boolean {
  if (!isSafeLinkoutUrl(card.url)) return false;

  ctx.sender.send({
    name: TelemetryEventName.CommerceLinkoutClick,
    occurredAt: new Date().toISOString(),
    payload: { liveSessionId: ctx.liveSessionId, productCardId: card.id },
  });

  void Promise.resolve(ctx.openUrl(card.url)).catch(() => {
    /* 외부 앱·브라우저 사정이라 계측을 되돌리지 않는다 */
  });
  return true;
}

export function useLinkoutClick(
  liveSessionId: LiveSessionId,
  deps: UseLinkoutClickDeps = {},
): LinkoutClickHandler {
  const sender = useMemo(
    () => deps.sender ?? createTelemetrySender({ baseUrl: getApiBaseUrl() }),
    [deps.sender],
  );
  // 기본값을 인라인으로 두면 매 렌더 새 함수가 되어 아래 useCallback이 매번 무효화된다
  // (react-hooks/exhaustive-deps가 실제로 잡았다 — 대장 #122로 규칙이 켜지며 드러남).
  const openUrl = useMemo(
    () => deps.openUrl ?? ((url: string) => Linking.openURL(url)),
    [deps.openUrl],
  );

  return useCallback(
    (card: ProductCard): boolean => performLinkoutClick(card, { liveSessionId, sender, openUrl }),
    [liveSessionId, sender, openUrl],
  );
}
