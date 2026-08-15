import type { ContentStatus } from '@gachinol/shared';

export type StatusTone = 'neutral' | 'info' | 'progress' | 'success' | 'warning' | 'danger';

export interface StatusBadge {
  label: string;
  tone: StatusTone;
  /**
   * 센터의 조치가 필요한 상태 — 정확히 9종 (테스트로 고정):
   * awaiting_center_review(결정) + 6개 *_failed(재시도) + revision_requested·regenerating(대장 #98).
   * 후자 둘은 auto_edit 워커 부재로 나가는 코드가 0건인 정지 상태다(actions.ts manualTransitionTargets는
   * revision_requested에서만 채워진다 — regenerating은 앱 내 탈출구가 아예 없다).
   * "조치 필요"는 "앱에 버튼이 있다"가 아니라 "사람이 인지해야 한다"는 뜻이다 — regenerating처럼
   * 인앱 액션이 없어도, 강조하지 않으면 아무도 발견하지 못한 채 영구히 묻힌다(그게 더 나쁘다).
   * 보드 하이라이트·"확인 필요" 라벨의 근거.
   */
  needsCenterAction?: true;
}

/** 23종 전수를 컴파일 타임 강제 — 상태 추가 시 tsc가 즉시 잡음. 센터 관점 라벨/톤 */
export const STATUS_BADGE_CENTER = {
  draft: { label: '작성 중(지사)', tone: 'neutral' },
  uploading: { label: '업로드 중', tone: 'progress' },
  upload_failed: { label: '업로드 실패', tone: 'danger', needsCenterAction: true },
  uploaded: { label: '처리 대기', tone: 'info' },
  processing: { label: '자동편집 중', tone: 'progress' },
  processing_failed: { label: '편집 실패', tone: 'danger', needsCenterAction: true },
  analyzing: { label: 'AI 분석 중', tone: 'progress' },
  analysis_failed: { label: '분석 실패', tone: 'danger', needsCenterAction: true },
  preview_generating: { label: '프리뷰 생성 중', tone: 'progress' },
  preview_failed: { label: '프리뷰 실패', tone: 'danger', needsCenterAction: true },
  awaiting_reporter_review: { label: '기자 확인 대기', tone: 'info' },
  // needsCenterAction 추가(대장 #98) — 유일한 진행 수단이 센터의 수동 전이라 보드에서 놓치면
  // 콘텐츠가 영구 정지한다(위 헤더 주석).
  revision_requested: { label: '수정 요청됨', tone: 'warning', needsCenterAction: true },
  // 라벨·톤 정정 + needsCenterAction 추가(대장 #98 보강) — 이 상태를 세팅하는 콘텐츠 도메인 코드가
  // 없어(auto_edit 미구현) 'progress'(진행 중) 톤은 거짓이었다. 센터의 수동 전이로 처음 도달
  // 가능해진 상태이고, 앱 내 탈출구가 전혀 없다(shared 전이맵 실측: regenerating→{analyzing,
  // preview_generating, regeneration_failed}뿐, canceled 없음) — revision_requested보다 더 심한
  // 정지 상태라 보드 강조가 더더욱 필요하다(위 헤더 주석).
  regenerating: { label: '재생성 대기 중', tone: 'warning', needsCenterAction: true },
  regeneration_failed: { label: '재생성 실패', tone: 'danger', needsCenterAction: true },
  reporter_approved: { label: '기자 승인 처리 중', tone: 'progress' },
  awaiting_center_review: { label: '센터 검토 대기', tone: 'warning', needsCenterAction: true },
  center_approved: { label: '송출 대기', tone: 'info' },
  publishing: { label: '송출 중', tone: 'progress' },
  publish_failed: { label: '송출 실패', tone: 'danger', needsCenterAction: true },
  published: { label: '송출 완료', tone: 'success' },
  rejected: { label: '반려됨', tone: 'danger' },
  canceled: { label: '취소됨', tone: 'neutral' },
  archived: { label: '보관됨', tone: 'neutral' },
} as const satisfies Record<ContentStatus, StatusBadge>;

/** 상태별 안내 문구 — 상세 화면 상태 카드 (센터 시점) */
export const STATUS_DESCRIPTION_CENTER = {
  draft: '지사 기자가 작성 중인 초안입니다.',
  uploading: '지사에서 원본 영상을 업로드하고 있습니다.',
  upload_failed: '업로드에 실패했습니다. 재시도할 수 있습니다.',
  uploaded: '원본 저장이 완료되어 처리 대기 중입니다.',
  processing: '자동편집(트랜스코딩)이 진행 중입니다.',
  processing_failed: '자동편집에 실패했습니다. 재시도할 수 있습니다.',
  analyzing: 'AI가 화면과 텍스트를 분석하고 있습니다.',
  analysis_failed: 'AI 분석에 실패했습니다. 재시도하거나 분석을 생략하고 진행합니다.',
  preview_generating: '저화질 프리뷰를 생성하고 있습니다.',
  preview_failed: '프리뷰 생성에 실패했습니다. 재시도할 수 있습니다.',
  awaiting_reporter_review: '담당 기자의 프리뷰 확인을 기다리고 있습니다. 센터는 대기합니다.',
  revision_requested:
    '수정이 요청되었습니다. 기자가 초안을 수정해도 자동으로 진행되지 않습니다 — 아래에서 재생성으로 수동 전이하거나 취소하세요.',
  regenerating:
    '자동으로 진행하는 처리가 없어 재생성 상태에 멈춰 있습니다. 이 앱에서는 더 이상 조작할 수 없는 상태입니다 — 필요하면 관리자에게 직접 처리를 요청하세요.',
  regeneration_failed: '재생성에 실패했습니다. 재시도할 수 있습니다.',
  reporter_approved: '기자 승인이 처리되고 있습니다. 잠시 후 센터 검토로 넘어옵니다.',
  awaiting_center_review: '센터 검토 대기입니다. 승인·수정요청·반려를 결정하세요.',
  center_approved: '센터 승인이 완료되어 송출을 기다리고 있습니다.',
  publishing: '지정된 채널로 송출하고 있습니다.',
  publish_failed: '송출에 실패했습니다. 재시도할 수 있습니다.',
  published: '송출이 완료되었습니다.',
  rejected: '반려되어 종결되었습니다. 재작업은 새 콘텐츠로 진행합니다.',
  canceled: '취소되어 종결되었습니다.',
  archived: '보관 처리되었습니다.',
} as const satisfies Record<ContentStatus, string>;

export const statusBadge = (s: ContentStatus): StatusBadge => STATUS_BADGE_CENTER[s];

/** 종결 상태 3종 */
export const TERMINAL_STATUSES: readonly ContentStatus[] = ['rejected', 'canceled', 'archived'];

export const isTerminalStatus = (s: ContentStatus): boolean => TERMINAL_STATUSES.includes(s);

/**
 * 자동 진행 상태 — 상세 화면 15s 폴링 대상 (WS 미도입 MVP의 대안, reporter와 동일 목록).
 * regenerating 제외(대장 #98 보강) — 그 상태를 진행시키는 코드가 없어(auto_edit 미구현)
 * 15s마다 영원히 폴링만 하고 값이 바뀌지 않는다. "자동 진행"이 아니라 "정지" 상태다.
 */
export const AUTO_PROGRESS_STATUSES: readonly ContentStatus[] = [
  'uploading',
  'uploaded',
  'processing',
  'analyzing',
  'preview_generating',
  'publishing',
  'reporter_approved',
];

export const isAutoProgressStatus = (s: ContentStatus): boolean =>
  AUTO_PROGRESS_STATUSES.includes(s);
