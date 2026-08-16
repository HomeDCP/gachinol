import type { ContentStatus } from '@gachinol/shared';
import {
  AUTO_PROGRESS_CONTENT_STATUSES,
  isAutoProgressContentStatus,
  isStalledAutomationContentStatus,
} from '@gachinol/shared';

export type StatusTone = 'neutral' | 'info' | 'progress' | 'success' | 'warning' | 'danger';

export interface StatusBadge {
  label: string;
  tone: StatusTone;
  /** 담당 기자의 액션이 필요한 상태 — 정확히 3종 (테스트로 고정) */
  needsMyAction?: true;
}

/**
 * 23종 전수를 컴파일 타임 강제 — 상태 추가 시 tsc가 즉시 잡음.
 *
 * ⚠ 이 표를 **직접 읽지 말고 `statusBadge()`를 쓸 것**. 여기 적힌 `tone`은 "그 단계의 구동부가
 * 정상 동작할 때"의 얼굴이고, "구동부가 없어 멈춰 있다"는 판정과 그 결과(경고 톤)는
 * `statusBadge()`가 shared `NOT_WIRED` 레지스트리에서 파생한다(EXEC-DECISIONS #29 ④).
 * 그래서 auto_edit이 구현되면 UI가 자동으로 따라오고, 사람이 되돌릴 것을 기억할 필요가 없다.
 */
export const STATUS_BADGE = {
  draft: { label: '작성 중', tone: 'neutral' },
  uploading: { label: '업로드 중', tone: 'progress' },
  upload_failed: { label: '업로드 실패', tone: 'danger', needsMyAction: true },
  uploaded: { label: '처리 대기', tone: 'info' },
  processing: { label: '자동편집 중', tone: 'progress' },
  processing_failed: { label: '편집 실패 — 센터 확인 중', tone: 'danger' },
  analyzing: { label: 'AI 분석 중', tone: 'progress' },
  analysis_failed: { label: '분석 실패 — 센터 확인 중', tone: 'danger' },
  preview_generating: { label: '프리뷰 생성 중', tone: 'progress' },
  preview_failed: { label: '프리뷰 실패 — 센터 확인 중', tone: 'danger' },
  awaiting_reporter_review: { label: '내 확인 대기', tone: 'warning', needsMyAction: true },
  /**
   * needsMyAction 유지(대장 #98) — 초안 수정은 실제로 가능하고 의미 있는 조치다
   * (서버 EDITABLE_STATUSES에 draft·revision_requested 포함). 다만 수정해도 자동으로
   * 다음 단계로 넘어가지는 않는다 — STATUS_DESCRIPTION이 그 사실을 명시해 "확인 필요"가
   * "고치면 끝난다"로 오독되지 않게 한다.
   */
  revision_requested: { label: '수정 요청됨', tone: 'warning', needsMyAction: true },
  /**
   * 대장 #98 — auto_edit 미구현이라 이 상태는 지금 **멈춘다**. 그 판정은 여기 하드코딩돼 있지
   * 않다: shared `NOT_WIRED`가 `regenerating`의 출구 3엣지를 미구현으로 등재하고 있어
   * `statusBadge()`가 아래 'progress'를 'warning'으로 덮는다. auto_edit이 구현돼 그 엣지들이
   * 레지스트리에서 빠지면 덮개가 사라지고 'progress'가 그대로 나온다.
   * (문구는 사람 몫이라 자동 전환하지 않는다 — 그때 라벨·설명만 손보면 된다.)
   */
  regenerating: { label: '재생성 대기 중', tone: 'progress' },
  regeneration_failed: { label: '재생성 실패 — 센터 확인 중', tone: 'danger' },
  reporter_approved: { label: '승인 처리 중', tone: 'progress' },
  awaiting_center_review: { label: '센터 검토 대기', tone: 'info' },
  center_approved: { label: '송출 대기', tone: 'info' },
  publishing: { label: '송출 중', tone: 'progress' },
  publish_failed: { label: '송출 실패 — 센터 확인 중', tone: 'danger' },
  published: { label: '송출 완료', tone: 'success' },
  rejected: { label: '반려됨', tone: 'danger' },
  canceled: { label: '취소됨', tone: 'neutral' },
  archived: { label: '보관됨', tone: 'neutral' },
} as const satisfies Record<ContentStatus, StatusBadge>;

/** 상태별 안내 문구 — 상세 화면 상태 카드 */
export const STATUS_DESCRIPTION = {
  draft: '작성 중인 초안입니다. 내용을 수정하거나 업로드를 시작할 수 있습니다.',
  uploading: '원본 영상을 업로드하고 있습니다.',
  upload_failed: '업로드에 실패했습니다. 재시도하거나 취소할 수 있습니다.',
  uploaded: '원본 저장이 완료되어 처리 대기 중입니다.',
  processing: '자동편집(트랜스코딩)이 진행 중입니다.',
  processing_failed: '자동편집에 실패했습니다. 센터에서 재시도를 진행합니다.',
  analyzing: 'AI가 화면과 텍스트를 분석하고 있습니다.',
  analysis_failed: 'AI 분석에 실패했습니다. 센터에서 재시도하거나 분석을 생략하고 진행합니다.',
  preview_generating: '저화질 프리뷰를 생성하고 있습니다.',
  preview_failed: '프리뷰 생성에 실패했습니다. 센터에서 재시도를 진행합니다.',
  awaiting_reporter_review: '프리뷰가 준비되었습니다. 확인 후 승인·수정요청·반려를 선택하세요.',
  revision_requested:
    '수정이 요청되었습니다. 초안은 수정할 수 있지만 자동으로 반영·재생성되지 않습니다 — 이후 진행은 센터가 결정합니다.',
  regenerating: '재생성 상태입니다. 자동으로 진행하는 처리가 아직 없어 여기서 멈춰 있습니다. 센터 확인이 필요합니다.',
  regeneration_failed: '재생성에 실패했습니다. 센터에서 재시도를 진행합니다.',
  reporter_approved: '승인이 처리되고 있습니다. 잠시 후 자동으로 다음 단계로 넘어갑니다.',
  awaiting_center_review: '센터 검토를 기다리고 있습니다.',
  center_approved: '센터 승인이 완료되어 송출을 기다리고 있습니다.',
  publishing: '지정된 채널로 송출하고 있습니다.',
  publish_failed: '송출에 실패했습니다. 센터에서 재시도를 진행합니다.',
  published: '송출이 완료되었습니다.',
  rejected: '반려되어 종결되었습니다. 재작업은 새 콘텐츠로 진행합니다.',
  canceled: '취소되어 종결되었습니다.',
  archived: '보관 처리되었습니다.',
} as const satisfies Record<ContentStatus, string>;

/**
 * ★ 배지 조회 — 표(사람이 쓴 문구·톤) 위에 **레지스트리 파생 판정**을 얹는다(EXEC-DECISIONS #29 ④).
 * 자동 진행하기로 된 단계인데 구동부가 없어 멈춘 상태면 '진행 중' 톤을 쓰지 않는다.
 * 판정은 shared `isStalledAutomationContentStatus`(= NOT_WIRED 파생) 하나뿐 — 상태 이름 하드코딩 0.
 */
export const statusBadge = (s: ContentStatus): StatusBadge =>
  isStalledAutomationContentStatus(s) ? { ...STATUS_BADGE[s], tone: 'warning' } : STATUS_BADGE[s];

/** 종결 상태 3종 */
export const TERMINAL_STATUSES: readonly ContentStatus[] = ['rejected', 'canceled', 'archived'];

export const isTerminalStatus = (s: ContentStatus): boolean => TERMINAL_STATUSES.includes(s);

/**
 * 자동 진행 상태 — 상세 화면 15s 폴링 대상 (WS 미도입 MVP의 대안).
 * **shared 파생**(`SYSTEM_DRIVEN_CONTENT_STATUSES` 중 NOT_WIRED에 구현된 출구가 남아 있는 것) —
 * 목록도 제외 규칙도 여기 없다. `regenerating`이 빠지는 이유는 auto_edit 엣지가 미구동으로
 * 등재돼 있기 때문이고, 구현되는 순간 이 목록에 자동 복귀한다(#29 ④).
 * 관제 앱과 같은 원천을 쓰므로 두 앱이 어긋날 수 없다.
 */
export const AUTO_PROGRESS_STATUSES: readonly ContentStatus[] = AUTO_PROGRESS_CONTENT_STATUSES;

export const isAutoProgressStatus = (s: ContentStatus): boolean => isAutoProgressContentStatus(s);
