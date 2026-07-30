import type { ProcessingState } from '@gachinol/shared';
import {
  QUEUE_WAITING_STATUSES,
  formatHoldElapsed,
  holdBannerContent,
  isQueueWaitingStatus,
  pollIntervalMs,
  shouldAnnounceRelease,
  shouldShowHoldBanner,
  shouldShowHoldForContent,
} from '../processing-hold';

const state = (over: Partial<ProcessingState> = {}): ProcessingState => ({
  enabled: true,
  holding: false,
  reason: null,
  message: '처리 가능',
  dcp: null,
  lastCheckedAt: null,
  ...over,
});

const holding = (over: Partial<ProcessingState> = {}): ProcessingState =>
  state({
    holding: true,
    reason: 'dcp_busy',
    message: 'DCP 인코딩 작업 중(encoding) — 완료되면 자동으로 시작됩니다',
    dcp: { busy: true, stage: 'encoding', queued: 1, since: '2026-07-31T00:00:00.000Z' },
    ...over,
  });

describe('shouldShowHoldBanner', () => {
  it('정지 중이면 표시', () => {
    expect(shouldShowHoldBanner(holding())).toBe(true);
  });

  it('정지 아니면 미표시', () => {
    expect(shouldShowHoldBanner(state())).toBe(false);
  });

  // 게이트가 없는 배포(로컬·클라우드)에서 배너가 뜨면 안 된다
  it('게이트 비활성이면 holding이 참이어도 미표시', () => {
    expect(shouldShowHoldBanner(holding({ enabled: false }))).toBe(false);
  });

  it('아직 로딩 중(undefined)이면 미표시', () => {
    expect(shouldShowHoldBanner(undefined)).toBe(false);
  });
});

describe('shouldShowHoldForContent', () => {
  it.each(QUEUE_WAITING_STATUSES)('큐 대기 상태(%s)에서는 표시', (s) => {
    expect(shouldShowHoldForContent(holding(), s)).toBe(true);
  });

  // 큐와 무관한 상태에서 "대기 중"이라고 하면 오히려 혼란스럽다
  it.each(['draft', 'awaiting_reporter_review', 'published', 'rejected'] as const)(
    '큐와 무관한 상태(%s)에서는 미표시',
    (s) => {
      expect(shouldShowHoldForContent(holding(), s)).toBe(false);
    },
  );

  it('정지 중이 아니면 큐 대기 상태여도 미표시', () => {
    expect(shouldShowHoldForContent(state(), 'processing')).toBe(false);
  });
});

describe('isQueueWaitingStatus', () => {
  it('업로드 직후·트랜스코딩·프리뷰·재생성이 대상', () => {
    expect(QUEUE_WAITING_STATUSES).toEqual([
      'uploaded',
      'processing',
      'preview_generating',
      'regenerating',
    ]);
    expect(isQueueWaitingStatus('processing')).toBe(true);
    expect(isQueueWaitingStatus('draft')).toBe(false);
  });
});

describe('holdBannerContent', () => {
  it('서버 message를 그대로 쓴다(문구 원천은 서버)', () => {
    const s = holding();
    expect(holdBannerContent(s).detail).toBe(s.message);
  });

  // 조회 실패가 "서버 오류"로 읽히면 안 된다 — 사용자가 할 일이 없는 대기 상황
  it('dcp_unreachable은 앱 표현으로 보정한다', () => {
    const c = holdBannerContent(holding({ reason: 'dcp_unreachable', message: '확인 불가' }));
    expect(c.detail).toContain('자동으로 시작');
    expect(c.detail).not.toContain('오류');
  });

  it('제목은 항상 대기임을 알린다', () => {
    expect(holdBannerContent(holding()).title).toBe('처리 대기 중');
  });
});

describe('formatHoldElapsed', () => {
  const since = '2026-07-31T00:00:00.000Z';
  const at = (min: number) => Date.parse(since) + min * 60_000;

  it('1분 미만은 표시하지 않는다(깜빡임 방지)', () => {
    expect(formatHoldElapsed(since, at(0.5))).toBeNull();
  });

  it('분 단위', () => {
    expect(formatHoldElapsed(since, at(7))).toBe('7분째');
  });

  it('1시간 이상은 시간+분', () => {
    expect(formatHoldElapsed(since, at(95))).toBe('1시간 35분째');
  });

  it('since 없음·형식 오류는 null', () => {
    expect(formatHoldElapsed(null)).toBeNull();
    expect(formatHoldElapsed('언제였더라')).toBeNull();
  });
});

// 요구사항 ② "작업을 시작할 수 있을 때 알린다" — 전이에서만 울려야 한다
describe('shouldAnnounceRelease', () => {
  it('정지 → 해제 전이에서 울린다', () => {
    expect(shouldAnnounceRelease(true, state())).toBe(true);
  });

  it('앱을 막 열었을 때(이전 정지 아님)는 울리지 않는다', () => {
    expect(shouldAnnounceRelease(false, state())).toBe(false);
  });

  it('정지가 계속되는 동안은 울리지 않는다', () => {
    expect(shouldAnnounceRelease(true, holding())).toBe(false);
  });

  it('게이트 비활성이면 울리지 않는다', () => {
    expect(shouldAnnounceRelease(true, state({ enabled: false }))).toBe(false);
    expect(shouldAnnounceRelease(true, undefined)).toBe(false);
  });
});

describe('pollIntervalMs', () => {
  // 게이트가 없는 배포에서 불필요한 폴링이 돌면 안 된다
  it('게이트 비활성이면 폴링하지 않는다', () => {
    expect(pollIntervalMs(state({ enabled: false }))).toBe(false);
    expect(pollIntervalMs(undefined)).toBe(false);
  });

  it('정지 중에는 촘촘히(해제를 빨리 잡는다)', () => {
    expect(pollIntervalMs(holding())).toBe(15_000);
  });

  it('평시에는 느슨하게', () => {
    expect(pollIntervalMs(state())).toBe(60_000);
  });
});
