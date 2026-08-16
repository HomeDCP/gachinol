import type { Scene } from '@gachinol/shared';
import type { Content as ContentRow, Station as StationRow } from '@prisma/client';
import { scenesToCaptions, toFeedItem, toPlaybackInfo, toStationSummary } from './feed.mapper';
import type { FeedContentRow } from './feed.mapper';

/** published Content row 픽스처 — 내부 필드까지 포함해 화이트리스트 누락 검증 */
const contentRow = (over: Partial<ContentRow> = {}): ContentRow =>
  ({
    id: '01920000-0000-7000-8000-0000000000a1',
    stationId: '01920000-0000-7000-8000-000000000001',
    origin: 'live_vod',
    reporterId: 'reporter-secret',
    title: '제목',
    description: '내부 설명',
    category: 'news',
    cultureTopics: [],
    status: 'published',
    priority: 'normal',
    reviewPolicy: 'reporter_only',
    generation: 1,
    scenes: [],
    targetChannelAccountIds: ['ch-secret'],
    tags: ['t1'],
    remakeOfContentId: null,
    lastError: { message: 'boom', at: '2026-07-20T00:00:00.000Z' },
    durationSec: 100,
    approvedByUserId: 'approver-secret',
    approvedAt: new Date('2026-07-19T00:00:00.000Z'),
    publishedAt: new Date('2026-07-20T09:00:00.000Z'),
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
    updatedAt: new Date('2026-07-02T00:00:00.000Z'),
    ...over,
  }) as ContentRow;

const feedRow = (over: Partial<ContentRow> = {}): FeedContentRow => ({
  ...contentRow(over),
  station: { name: '애월 마을방송국' },
});

const INTERNAL_KEYS = [
  'reporterId',
  'reviewPolicy',
  'status',
  'generation',
  'origin',
  'priority',
  'targetChannelAccountIds',
  'tags',
  'lastError',
  'approvedByUserId',
  'approvedAt',
  'remakeOfContentId',
  'description',
  'scenes',
  'createdAt',
  'updatedAt',
];

describe('toFeedItem', () => {
  it('화이트리스트 필드만 — 내부 필드 키 부재', () => {
    const item = toFeedItem(feedRow(), { thumbnailUrl: 'https://x/thumb?sig=1', summary: '요약' });
    for (const k of INTERNAL_KEYS) {
      expect(item).not.toHaveProperty(k);
    }
    expect(Object.keys(item).sort()).toEqual(
      [
        'contentId',
        'title',
        'category',
        'stationId',
        'stationName',
        'durationSec',
        'publishedAt',
        'thumbnailUrl',
        'summary',
      ].sort(),
    );
  });

  it('durationSec null → 0 폴백', () => {
    expect(toFeedItem(feedRow({ durationSec: null }), {}).durationSec).toBe(0);
  });

  it('summary·thumbnail 부재 시 키 자체 생략', () => {
    const item = toFeedItem(feedRow(), {});
    expect(item).not.toHaveProperty('summary');
    expect(item).not.toHaveProperty('thumbnailUrl');
  });

  it('cultureTopics 비어있으면 생략, 있으면 노출', () => {
    expect(toFeedItem(feedRow({ cultureTopics: [] }), {})).not.toHaveProperty('cultureTopics');
    expect(toFeedItem(feedRow({ cultureTopics: ['food'] }), {}).cultureTopics).toEqual(['food']);
  });

  it('stationName은 join 값', () => {
    expect(toFeedItem(feedRow(), {}).stationName).toBe('애월 마을방송국');
  });
});

describe('scenesToCaptions', () => {
  const scene = (over: {
    id?: string;
    order?: number;
    caption?: string;
    startSec?: number | null;
    endSec?: number | null;
  }): Scene =>
    ({
      id: 's',
      order: 0,
      caption: '자막',
      startSec: 0,
      endSec: 5,
      ...over,
    }) as Scene;

  it('타이밍 있는 장면만 order 오름차순으로', () => {
    const scenes: Scene[] = [
      scene({ id: 's2', order: 2, caption: '셋', startSec: 10, endSec: 20 }),
      scene({ id: 's0', order: 0, caption: '하나', startSec: 0, endSec: 5 }),
      scene({ id: 's1', order: 1, caption: '타이밍 없음', startSec: null, endSec: null }),
    ];
    expect(scenesToCaptions(scenes)).toEqual([
      { startSec: 0, endSec: 5, text: '하나' },
      { startSec: 10, endSec: 20, text: '셋' },
    ]);
  });

  it('startSec/endSec 한쪽만 있으면 제외', () => {
    expect(scenesToCaptions([scene({ endSec: null })])).toEqual([]);
    expect(scenesToCaptions([scene({ startSec: null })])).toEqual([]);
  });

  it('공백 caption 제외', () => {
    expect(scenesToCaptions([scene({ caption: '   ' })])).toEqual([]);
  });
});

describe('toPlaybackInfo', () => {
  it('화이트리스트 + 서명 URL·자막 조립', () => {
    const info = toPlaybackInfo(contentRow(), '애월 마을방송국', {
      hlsUrl: 'https://x/rendition?X-Amz-Signature=abc',
      posterUrl: 'https://x/thumb?X-Amz-Signature=def',
      captions: [{ startSec: 0, endSec: 5, text: '자막' }],
      durationSec: 100,
    });
    expect(Object.keys(info).sort()).toEqual(
      [
        'contentId',
        'title',
        'stationName',
        'hlsUrl',
        'posterUrl',
        'durationSec',
        'captions',
        'publishedAt',
      ].sort(),
    );
    for (const k of INTERNAL_KEYS) expect(info).not.toHaveProperty(k);
  });

  it('posterUrl 부재 시 키 생략', () => {
    const info = toPlaybackInfo(contentRow(), 's', {
      hlsUrl: 'u',
      captions: [],
      durationSec: 1,
    });
    expect(info).not.toHaveProperty('posterUrl');
  });
});

describe('toStationSummary', () => {
  const stationRow = (over: Partial<StationRow> = {}): StationRow =>
    ({
      id: '01920000-0000-7000-8000-000000000001',
      code: 'aewol',
      name: '애월 마을방송국',
      kind: 'branch',
      status: 'dormant',
      region: '제주시 애월읍',
      description: '내부 설명',
      thumbnailUrl: null,
      supportTel: null,
      youtubeUrl: null,
      sortOrder: 1,
      foundedAt: null,
      dormantSince: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      ...over,
    }) as StationRow;

  it('축약 — code·description·sortOrder 등 미노출', () => {
    const s = toStationSummary(stationRow());
    expect(Object.keys(s).sort()).toEqual(['id', 'name', 'region', 'status'].sort());
    expect(s).not.toHaveProperty('code');
    expect(s).not.toHaveProperty('description');
    expect(s).not.toHaveProperty('sortOrder');
  });

  it('thumbnailUrl 있으면 노출', () => {
    expect(toStationSummary(stationRow({ thumbnailUrl: 'https://cdn/x.jpg' })).thumbnailUrl).toBe(
      'https://cdn/x.jpg',
    );
  });

  // ── 공개 연락 채널 (T-W2-28 · 대장 #127) ────────────────────────────────
  // 이 투영이 유일한 공개 통로다 — 여기서 빠지면 구독자 웹의 "지사에 전화 / 유튜브에서 보기"
  // 대체 경로가 다시 앱 env(빌드 1개=값 1개)에만 의존하게 된다.
  it('supportTel·youtubeUrl이 있으면 익명 공개 응답에 실려 나간다(지사별 값의 유일한 공급원)', () => {
    const s = toStationSummary(
      stationRow({
        supportTel: '064-000-0000',
        youtubeUrl: 'https://www.youtube.com/@gachinol-demo-aewol',
      }),
    );
    expect(s.supportTel).toBe('064-000-0000');
    expect(s.youtubeUrl).toBe('https://www.youtube.com/@gachinol-demo-aewol');
    expect(Object.keys(s).sort()).toEqual(
      ['id', 'name', 'region', 'status', 'supportTel', 'youtubeUrl'].sort(),
    );
  });

  it('미설정(null)이면 키 자체가 없다 — 앱이 "설정됨"으로 오판해 죽은 버튼을 그리지 않게', () => {
    const s = toStationSummary(stationRow({ supportTel: null, youtubeUrl: null }));
    expect(s).not.toHaveProperty('supportTel');
    expect(s).not.toHaveProperty('youtubeUrl');
  });

  it('빈 문자열·공백만 있는 값도 키를 만들지 않는다(쓰기 zod 우회분에 대한 2차 방어)', () => {
    expect(toStationSummary(stationRow({ supportTel: '', youtubeUrl: '' }))).not.toHaveProperty(
      'supportTel',
    );
    const blank = toStationSummary(stationRow({ supportTel: '   ', youtubeUrl: '\t\n' }));
    expect(blank).not.toHaveProperty('supportTel');
    expect(blank).not.toHaveProperty('youtubeUrl');
  });
});
