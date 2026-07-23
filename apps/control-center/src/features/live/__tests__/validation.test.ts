import type { ChannelAccountId } from '@gachinol/shared';
import { validateCreateLiveSession, TITLE_MAX_LEN } from '../validation';

const NO_CHANNELS: ChannelAccountId[] = [];

describe('validateCreateLiveSession', () => {
  test('정규 편성: 유효한 scheduledAt → ok + request 구성', () => {
    const r = validateCreateLiveSession({
      type: 'news',
      title: '  주간뉴스  ',
      scheduledAt: '2026-07-25T20:00:00.000Z',
      targetChannelAccountIds: NO_CHANNELS,
    });
    expect(r.ok).toBe(true);
    expect(r.request).toEqual({
      type: 'news',
      title: '주간뉴스', // trim 반영
      scheduledAt: '2026-07-25T20:00:00.000Z',
      targetChannelAccountIds: [],
    });
  });

  test('불변식: 긴급 + scheduledAt 지정 → scheduledAt 에러', () => {
    const r = validateCreateLiveSession({
      type: 'emergency',
      title: '긴급 재난 방송',
      scheduledAt: '2026-07-25T20:00:00.000Z',
      targetChannelAccountIds: NO_CHANNELS,
    });
    expect(r.ok).toBe(false);
    expect(r.errors.scheduledAt).toBeDefined();
  });

  test('긴급 + scheduledAt=null → ok, request.scheduledAt=null', () => {
    const r = validateCreateLiveSession({
      type: 'emergency',
      title: '긴급 재난 방송',
      scheduledAt: null,
      targetChannelAccountIds: NO_CHANNELS,
    });
    expect(r.ok).toBe(true);
    expect(r.request?.scheduledAt).toBeNull();
  });

  test('정규 편성 + scheduledAt=null → 편성 시각 에러', () => {
    const r = validateCreateLiveSession({
      type: 'news',
      title: '주간뉴스',
      scheduledAt: null,
      targetChannelAccountIds: NO_CHANNELS,
    });
    expect(r.ok).toBe(false);
    expect(r.errors.scheduledAt).toBeDefined();
  });

  test('정규 편성 + 잘못된 날짜 형식 → 형식 에러', () => {
    const r = validateCreateLiveSession({
      type: 'news',
      title: '주간뉴스',
      scheduledAt: 'not-a-date',
      targetChannelAccountIds: NO_CHANNELS,
    });
    expect(r.ok).toBe(false);
    expect(r.errors.scheduledAt).toBeDefined();
  });

  test('빈 제목 → title 에러, 초과 길이 → title 에러', () => {
    expect(
      validateCreateLiveSession({
        type: 'emergency',
        title: '   ',
        scheduledAt: null,
        targetChannelAccountIds: NO_CHANNELS,
      }).errors.title,
    ).toBeDefined();
    expect(
      validateCreateLiveSession({
        type: 'emergency',
        title: 'x'.repeat(TITLE_MAX_LEN + 1),
        scheduledAt: null,
        targetChannelAccountIds: NO_CHANNELS,
      }).errors.title,
    ).toBeDefined();
  });
});
