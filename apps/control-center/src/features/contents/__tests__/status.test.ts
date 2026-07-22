import { ContentStatus, ProgramCategory } from '@gachinol/shared';
import { CATEGORY_LABEL } from '../labels';
import { STATUS_DESCRIPTION_CENTER, statusBadge } from '../status';

describe('STATUS_BADGE_CENTER — 23종 전수', () => {
  const all = Object.values(ContentStatus);

  test('상태 23종', () => {
    expect(all).toHaveLength(23);
  });

  test.each(all)('%s — 라벨·톤·설명 존재·비어있지 않음', (status) => {
    expect(statusBadge(status).label.length).toBeGreaterThan(0);
    expect(statusBadge(status).tone.length).toBeGreaterThan(0);
    expect(STATUS_DESCRIPTION_CENTER[status].length).toBeGreaterThan(0);
  });

  test('needsCenterAction 정확히 7종 (awaiting_center_review + 6 *_failed)', () => {
    const flagged = all.filter((s) => statusBadge(s).needsCenterAction === true).sort();
    expect(flagged).toEqual(
      [
        'awaiting_center_review',
        'upload_failed',
        'processing_failed',
        'analysis_failed',
        'preview_failed',
        'regeneration_failed',
        'publish_failed',
      ].sort(),
    );
  });
});

describe('CATEGORY_LABEL — 6종 전수', () => {
  test.each(Object.values(ProgramCategory))('%s 라벨 존재', (category) => {
    expect(CATEGORY_LABEL[category].length).toBeGreaterThan(0);
  });
});
