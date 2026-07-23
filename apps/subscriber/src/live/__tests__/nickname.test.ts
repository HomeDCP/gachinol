import { isValidNickname, NICKNAME_MAX_LEN, sanitizeNickname } from '../nickname';

describe('nickname', () => {
  test('sanitizeNickname: trim + 40자 컷 (서버 규칙과 동일)', () => {
    expect(sanitizeNickname('  해녀삼춘  ')).toBe('해녀삼춘');
    const long = 'x'.repeat(60);
    expect(sanitizeNickname(long)).toHaveLength(NICKNAME_MAX_LEN);
  });

  test('isValidNickname: 공백만/빈값=false, 내용 있으면 true', () => {
    expect(isValidNickname('')).toBe(false);
    expect(isValidNickname('   ')).toBe(false);
    expect(isValidNickname('ㅇ')).toBe(true);
    expect(isValidNickname('  a ')).toBe(true);
  });
});
