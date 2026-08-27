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

  it('toContent — hasMinorSubject 투영 (T-W2-36: 리마인더 메타데이터, 확인 필드 없음)', () => {
    expect(toContent(contentRow()).hasMinorSubject).toBe(false);
    expect(toContent(contentRow({ hasMinorSubject: true })).hasMinorSubject).toBe(true);
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

  it('toContentSummary — hasMinorSubject 투영(가시성 전용, T-W2-36) · 확인 필드 미존재', () => {
    const flagged = toContentSummary({
      ...contentRow({ hasMinorSubject: true }),
      station: { name: '애월 마을방송국' },
      reporter: { name: '애월 기자' },
    });
    expect(flagged.hasMinorSubject).toBe(true);
    expect(
      (flagged as unknown as Record<string, unknown>).minorConsentConfirmedAt,
    ).toBeUndefined();
    expect(
      (flagged as unknown as Record<string, unknown>).minorConsentConfirmedByUserId,
    ).toBeUndefined();
  });

  it('toContentDetail — assets/publications 빈 배열, analysis undefined (미도입 테이블)', () => {
    const detail = toContentDetail(contentRow(), []);
    expect(detail.assets).toEqual([]);
    expect(detail.publications).toEqual([]);
    expect(detail.analysis).toBeUndefined();
    expect(detail.revisions).toEqual([]);
  });
});
