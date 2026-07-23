import { REVISION_NOTE_MAX_LEN, validateRecommendationRevisionNote } from '../validation';

describe('validateRecommendationRevisionNote — 서버 zRequestRecommendationRevision 미러(1..2000)', () => {
  test('빈 문자열 거부', () => {
    const r = validateRecommendationRevisionNote('');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.note).toBe('수정 요청 내용을 입력해 주세요');
  });

  test('공백만 있는 입력 거부', () => {
    expect(validateRecommendationRevisionNote('   \n\t ').ok).toBe(false);
  });

  test('1자 허용', () => {
    const r = validateRecommendationRevisionNote('가');
    expect(r).toEqual({ ok: true, value: '가' });
  });

  test('앞뒤 공백은 trim 후 전송값이 된다', () => {
    const r = validateRecommendationRevisionNote('  뉴스 꼭지를 3개로 줄여주세요  ');
    expect(r).toEqual({ ok: true, value: '뉴스 꼭지를 3개로 줄여주세요' });
  });

  test('2000자 허용', () => {
    const r = validateRecommendationRevisionNote('가'.repeat(REVISION_NOTE_MAX_LEN));
    expect(r.ok).toBe(true);
  });

  test('2001자 거부', () => {
    const r = validateRecommendationRevisionNote('가'.repeat(REVISION_NOTE_MAX_LEN + 1));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.note).toBe('수정 요청은 2000자 이내로 입력해 주세요');
  });

  test('trim 후 2000자면 허용 (공백 패딩은 길이에 포함하지 않는다)', () => {
    const r = validateRecommendationRevisionNote(`  ${'가'.repeat(REVISION_NOTE_MAX_LEN)}  `);
    expect(r.ok).toBe(true);
  });

  test('상한 상수는 서버 계약과 동일', () => {
    expect(REVISION_NOTE_MAX_LEN).toBe(2000);
  });
});
