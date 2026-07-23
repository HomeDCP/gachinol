import { chatMessageRow, liveCommentRow, liveSessionRow } from '../test-support/fixtures';
import { toChatMessage, toLiveComment, toLiveSession, toLiveSessionPublic } from './live.mapper';

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
});
