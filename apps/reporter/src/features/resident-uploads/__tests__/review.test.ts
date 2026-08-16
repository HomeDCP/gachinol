import { isConsentMissing } from '../review';

describe('isConsentMissing — 07 §3-15 ⓑ 이용허락 클릭동의 판정', () => {
  test('null이면 동의 없이 접수된 건 — true', () => {
    expect(isConsentMissing(null)).toBe(true);
  });

  test('시각이 있으면 false', () => {
    expect(isConsentMissing('2026-08-16T00:00:00.000Z')).toBe(false);
  });
});
