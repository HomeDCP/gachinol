import { ContentStatus, ProgramCategory } from '@gachinol/shared';
import type { ContentSummary } from '@gachinol/shared';
import { BOARD_VIEWS } from '../board-views';
import { minorSubjectBadge } from '../status';

/**
 * ★ T-W2-36 — 동의서 판단 게이트 해체 (촬영자 책임 모델, 사용자 결정 2026-08-27).
 *
 * 앱은 동의서 수취 여부를 판단하지 않는다. 관제에 남는 것은 **가시성**(미성년 등장 표시)뿐이며,
 * 판단 장치(동의 확인 대기 뷰·확인/철회 액션)는 존재하지 않아야 한다.
 */

const summary = (over: Partial<ContentSummary> = {}): ContentSummary =>
  ({
    id: 'c-1',
    stationId: 's-aewol',
    reporterId: 'u-reporter',
    title: '애월 포구 아침',
    category: ProgramCategory.News,
    status: ContentStatus.AwaitingCenterReview,
    priority: 'normal',
    reviewPolicy: 'center_required',
    generation: 1,
    durationSec: null,
    thumbnailUrl: null,
    hasMinorSubject: false,
    createdAt: '2026-08-28T00:00:00.000Z',
    publishedAt: null,
    ...over,
  }) as unknown as ContentSummary;

describe('T-W2-36 — 판단 UI 소멸', () => {
  it('검토 보드에 "동의 확인 대기" 뷰가 없다 (판단 축 자체가 사라졌다)', () => {
    expect(BOARD_VIEWS.map((v) => v.label)).not.toContain('동의 확인 대기');
  });

  it('★ 미성년 등장 정보 배지는 남는다 — minorSubjectBadge(가시성, 판단 아님)', () => {
    expect(minorSubjectBadge(summary({ hasMinorSubject: true }))?.label).toContain('미성년');
    expect(minorSubjectBadge(summary({ hasMinorSubject: false }))).toBeNull();
  });
});
