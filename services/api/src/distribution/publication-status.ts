import type { PublicationStatus } from '@gachinol/shared';
import { canTransition, PUBLICATION_STATUS_TRANSITIONS } from '@gachinol/shared';

/**
 * Publication 전이 판정 — shared PUBLICATION_STATUS_TRANSITIONS가 유일 원천(규칙 사본 금지).
 * PublicationsService의 모든 상태 변경은 이 헬퍼로 map-legal 검증 후 CAS한다.
 */
export const canTransitionPublication = (from: PublicationStatus, to: PublicationStatus): boolean =>
  canTransition(PUBLICATION_STATUS_TRANSITIONS, from, to);
