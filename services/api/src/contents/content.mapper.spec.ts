import { v7 as uuidv7 } from 'uuid';
import { contentRow, sceneJson } from '../test-support/fixtures';
import { toContent, toContentDetail, toContentSummary } from './content.mapper';

describe('content.mapper — row → shared wire', () => {
  it('toContent — ISO 변환·scenes zod 재검증·null/undefined 규약', () => {
    const sid = uuidv7();
    const row = contentRow({
      scenes: [sceneJson(0, sid)],
      publishedAt: new Date('2026-07-20T10:00:00.000Z'),
      cultureTopics: [],
      description: null,
    });
    const content = toContent(row);

    expect(content.scenes[0]?.id).toBe(sid);
    expect(content.publishedAt).toBe('2026-07-20T10:00:00.000Z');
    expect(content.approvedAt).toBeNull(); // 엔티티 규약: 부재는 null
    expect(content.description).toBeUndefined(); // 옵셔널 규약: 부재는 키 탈락
    expect(content.cultureTopics).toBeUndefined(); // 빈 배열 → undefined
    expect(content.durationSec).toBeNull();
  });

  it('toContent — scenes JSONB가 계약 위반이면 예외 (읽기 경계 재검증)', () => {
    const row = contentRow({ scenes: [{ broken: true }] as never });
    expect(() => toContent(row)).toThrow();
  });

  it('toContentSummary — 비정규화 이름 채움, live_vod는 reporterName null', () => {
    const summary = toContentSummary({
      ...contentRow(),
      station: { name: '애월 마을방송국' },
      reporter: { name: '애월 기자' },
    });
    expect(summary.stationName).toBe('애월 마을방송국');
    expect(summary.reporterName).toBe('애월 기자');

    const vod = toContentSummary({
      ...contentRow({ origin: 'live_vod', reporterId: null }),
      station: { name: '제주방송센터' },
      reporter: null,
    });
    expect(vod.reporterId).toBeNull();
    expect(vod.reporterName).toBeNull();
  });

  it('toContentDetail — assets/publications 빈 배열, analysis undefined (미도입 테이블)', () => {
    const detail = toContentDetail(contentRow(), []);
    expect(detail.assets).toEqual([]);
    expect(detail.publications).toEqual([]);
    expect(detail.analysis).toBeUndefined();
    expect(detail.revisions).toEqual([]);
  });
});
