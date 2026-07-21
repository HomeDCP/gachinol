import { ContentStatus } from '@gachinol/shared';
import { STATUS_DESCRIPTION, statusBadge } from '../status';

describe('STATUS_BADGE — 23종 전수', () => {
  const all = Object.values(ContentStatus);

  test('상태 23종', () => {
    expect(all).toHaveLength(23);
  });

  test.each(all)('%s — 라벨·설명 존재·비어있지 않음', (status) => {
    expect(statusBadge(status).label.length).toBeGreaterThan(0);
    expect(statusBadge(status).tone.length).toBeGreaterThan(0);
    expect(STATUS_DESCRIPTION[status].length).toBeGreaterThan(0);
  });

  test('needsMyAction 정확히 3종 (upload_failed·awaiting_reporter_review·revision_requested)', () => {
    const flagged = all.filter((s) => statusBadge(s).needsMyAction === true).sort();
    expect(flagged).toEqual(
      ['awaiting_reporter_review', 'revision_requested', 'upload_failed'].sort(),
    );
  });
});
