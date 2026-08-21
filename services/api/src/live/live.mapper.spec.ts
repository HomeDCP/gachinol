import { chatMessageRow, liveCommentRow, liveSessionRow } from '../test-support/fixtures';
import {
  toChatMessage,
  toLiveComment,
  toLiveSession,
  toLiveSessionPublic,
  toProductCards,
} from './live.mapper';

describe('live.mapper', () => {
  describe('toLiveSessionPublic (화이트리스트 투영)', () => {
    it('내부 필드(streamKeyRef·rtmpIngestUrl·createdByUserId·targetChannelAccountIds)를 구조적 차단', () => {
      const row = liveSessionRow({
        status: 'live',
        streamKeyRef: 'live:secret',
        rtmpIngestUrl: 'rtmp://ingest/live-1',
        hlsPlaybackUrl: 'https://hls/live-1/index.m3u8',
        targetChannelAccountIds: ['ch-x'],
      });
      const pub = toLiveSessionPublic(row, 42) as unknown as Record<string, unknown>;
      expect(pub.streamKeyRef).toBeUndefined();
      expect(pub.rtmpIngestUrl).toBeUndefined();
      expect(pub.createdByUserId).toBeUndefined();
      expect(pub.targetChannelAccountIds).toBeUndefined();
      expect(pub.announcerUserId).toBeUndefined();
      expect(pub.hlsUrl).toBe('https://hls/live-1/index.m3u8');
      expect(pub.viewerCount).toBe(42);
      expect(pub.status).toBe('live');
    });

    it('hlsPlaybackUrl 부재 → hlsUrl=null', () => {
      const pub = toLiveSessionPublic(liveSessionRow({ hlsPlaybackUrl: null }), 0);
      expect(pub.hlsUrl).toBeNull();
    });
  });

  describe('toLiveSession (센터 전체)', () => {
    it('streamKeyRef(참조 이름만)는 그대로 투영', () => {
      const s = toLiveSession(liveSessionRow({ streamKeyRef: 'live:live-1' }));
      expect(s.streamKeyRef).toBe('live:live-1');
      expect(s.createdByUserId).toBe('u-center');
    });
  });

  describe('toLiveComment', () => {
    it('optional 필드는 존재 시에만 세팅(isQuestion=true·promptedAt)', () => {
      const c = toLiveComment(
        liveCommentRow({ isQuestion: true, promptedAt: new Date('2026-07-25T10:00:00Z'), status: 'prompted' }),
      );
      expect(c.isQuestion).toBe(true);
      expect(c.promptedAt).toBe('2026-07-25T10:00:00.000Z');
      expect(c.status).toBe('prompted');
    });

    it('isQuestion=false면 필드 생략(shared optional)', () => {
      const c = toLiveComment(liveCommentRow({ isQuestion: false })) as unknown as Record<string, unknown>;
      expect(c.isQuestion).toBeUndefined();
    });
  });

  describe('toChatMessage', () => {
    it('visibility·moderatedByUserId 투영', () => {
      const m = toChatMessage(chatMessageRow({ visibility: 'hidden', moderatedByUserId: 'u-center' }));
      expect(m.visibility).toBe('hidden');
      expect(m.moderatedByUserId).toBe('u-center');
    });
  });

  describe('toProductCards (JSONB 방어적 파싱 — T-W2-11)', () => {
    const good = {
      id: 'pc-1',
      name: '한라봉 5kg',
      url: 'https://smartstore.naver.com/x/1',
      imageUrl: 'https://cdn.test/a.jpg',
      priceLabel: '25,000원',
    };

    it('정상 카드를 그대로 투영한다', () => {
      expect(toProductCards([good])).toEqual([good]);
    });

    it('계약 밖 항목은 버리고 나머지를 살린다 — 한 카드가 깨져도 방송은 보여야 한다', () => {
      const cards = toProductCards([
        good,
        { id: 'pc-2', name: '이름만 있고 url 없음' },
        { id: '', name: 'id 빈 문자열', url: 'https://x.test/1' },
        { id: 'pc-3', name: '', url: 'https://x.test/2' },
        null,
        'not-an-object',
        { ...good, id: 'pc-4', name: '두 번째 정상' },
      ]);

      expect(cards.map((c) => c.id)).toEqual(['pc-1', 'pc-4']);
    });

    it('읽기 시점에도 URL을 재검증한다 — 쓰기 검증 전에 들어간 값의 공개 경로를 끊는다(fail-closed)', () => {
      const cards = toProductCards([
        { id: 'pc-x', name: 'XSS', url: 'javascript:alert(1)' },
        { id: 'pc-y', name: 'data', url: 'data:text/html,<script>' },
      ]);
      expect(cards).toEqual([]);
    });

    it('부적격 imageUrl은 카드를 버리지 않고 이미지만 뺀다', () => {
      const card = toProductCards([{ ...good, imageUrl: 'javascript:alert(1)' }])[0]!;
      expect(card.imageUrl).toBeUndefined();
      expect(card.name).toBe('한라봉 5kg');
    });

    it('배열이 아니면 빈 배열(구버전 행·null 방어)', () => {
      expect(toProductCards(null)).toEqual([]);
      expect(toProductCards({})).toEqual([]);
      expect(toProductCards(undefined)).toEqual([]);
    });

    it('공개 투영에 상품 카드가 포함된다 — 이 필드가 없어 구독자 화면이 비어 있었다', () => {
      const pub = toLiveSessionPublic(liveSessionRow({ productCards: [good] }), 0);
      expect(pub.productCards).toEqual([good]);
    });
  });
});
