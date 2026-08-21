import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ProcessingState } from '@gachinol/shared';
import { getProcessingState } from '../../api/system';
import { useApiClient } from '../../auth/auth-context';
import { systemKeys } from '../../query/keys';
import { showToast } from '../../ui/toast';
import { pollIntervalMs, shouldAnnounceRelease } from './processing-hold';

/**
 * 미디어 처리 게이트 상태.
 *
 * 게이트가 비활성인 배포(로컬·클라우드 단독)에서는 첫 응답의 `enabled=false`로 폴링이 멈춘다
 * → 그 환경에서는 사실상 1회 조회로 끝난다(불필요한 트래픽 0).
 * 실패해도 화면을 막지 않는다(안내는 부가 정보 — retry 1회 후 조용히 포기).
 */
export function useProcessingState() {
  const client = useApiClient();
  return useQuery<ProcessingState>({
    queryKey: systemKeys.processingState,
    queryFn: () => getProcessingState(client),
    refetchInterval: (query) => pollIntervalMs(query.state.data),
    retry: 1,
    staleTime: 10_000,
  });
}

/**
 * 정지 → 해제 전이 시 1회 토스트.
 *
 * 요구사항의 "작업을 시작할 수 있을 때 알림"에 해당한다. 푸시 알림이 아니라 **앱이 열려 있을 때의
 * 인앱 통지**다(FCM/APNs는 별도 슬라이스) — 그래서 앱을 처음 열었을 때는 울리지 않도록
 * 이전 값이 실제로 `true`였던 경우에만 발화한다.
 */
export function useHoldReleaseToast(state: ProcessingState | undefined): void {
  const wasHolding = useRef(false);
  useEffect(() => {
    if (shouldAnnounceRelease(wasHolding.current, state)) {
      showToast('영상 처리가 시작되었습니다.');
    }
    wasHolding.current = Boolean(state?.enabled && state.holding);
    // `state` 객체 전체를 deps에 넣지 않는다: `shouldAnnounceRelease`가 읽는 것은 `enabled`·`holding`
    // 둘뿐인데(processing-hold.ts), 폴링이 매번 새 객체를 만들어 내려주므로 객체를 deps에 넣으면
    // 값이 그대로여도 매 응답마다 이펙트가 재실행된다. 아래 두 값이 실질적으로 완전한 의존이다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.enabled, state?.holding]);
}
