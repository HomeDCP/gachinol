import { isMinorConsentPending } from '@gachinol/shared';
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

  it('toContent — 미성년자 동의 3필드 투영 (T-W2-23): 미확인은 전부 null/false', () => {
    const content = toContent(contentRow());
    expect(content.hasMinorSubject).toBe(false);
    expect(content.minorConsentConfirmedByUserId).toBeNull();
    expect(content.minorConsentConfirmedAt).toBeNull();
  });

  it('toContent — 미성년자 동의 확인 완료 상태를 그대로 투영', () => {
    const row = contentRow({
      hasMinorSubject: true,
      minorConsentConfirmedByUserId: 'u-center',
      minorConsentConfirmedAt: new Date('2026-08-10T00:00:00.000Z'),
    });
    const content = toContent(row);
    expect(content.hasMinorSubject).toBe(true);
    expect(content.minorConsentConfirmedByUserId).toBe('u-center');
    expect(content.minorConsentConfirmedAt).toBe('2026-08-10T00:00:00.000Z');
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

  /**
   * 대장 #118 — 목록 투영에 게이트 사실이 실리지 않으면 센터는 차단된 콘텐츠의 존재 자체를
   * 알 수 없다(reporter_only는 센터 검토를 안 거친다). 확인자 id는 상세에만(노출 최소화).
   */
  it('toContentSummary — 미성년자 동의 게이트 2필드 투영 (T-W2-27) · 확인자 id는 미노출', () => {
    const pending = toContentSummary({
      ...contentRow({ hasMinorSubject: true, minorConsentConfirmedAt: null }),
      station: { name: '애월 마을방송국' },
      reporter: { name: '애월 기자' },
    });
    expect(pending.hasMinorSubject).toBe(true);
    expect(pending.minorConsentConfirmedAt).toBeNull();
    expect(isMinorConsentPending(pending)).toBe(true);
    expect(
      (pending as unknown as Record<string, unknown>).minorConsentConfirmedByUserId,
    ).toBeUndefined();

    const confirmed = toContentSummary({
      ...contentRow({
        hasMinorSubject: true,
        minorConsentConfirmedByUserId: 'u-center',
        minorConsentConfirmedAt: new Date('2026-08-10T00:00:00.000Z'),
      }),
      station: { name: '애월 마을방송국' },
      reporter: { name: '애월 기자' },
    });
    expect(confirmed.minorConsentConfirmedAt).toBe('2026-08-10T00:00:00.000Z');
    expect(isMinorConsentPending(confirmed)).toBe(false);

    // 플래그가 꺼진 대다수는 이 축과 무관 — 대기열에 섞이면 안 된다
    const plain = toContentSummary({
      ...contentRow(),
      station: { name: '애월 마을방송국' },
      reporter: { name: '애월 기자' },
    });
    expect(plain.hasMinorSubject).toBe(false);
    expect(isMinorConsentPending(plain)).toBe(false);
  });

  it('toContentDetail — assets/publications 빈 배열, analysis undefined (미도입 테이블)', () => {
    const detail = toContentDetail(contentRow(), []);
    expect(detail.assets).toEqual([]);
    expect(detail.publications).toEqual([]);
    expect(detail.analysis).toBeUndefined();
    expect(detail.revisions).toEqual([]);
  });
});
