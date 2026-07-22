import {
  validateLogin,
  validateRejectNote,
  validateRevisionNote,
  validateSceneNote,
} from '../validation';

describe('validateLogin', () => {
  test('정상 입력', () => {
    expect(validateLogin('a@b.co', 'pw')).toEqual({
      ok: true,
      value: { email: 'a@b.co', password: 'pw' },
    });
  });
  test('이메일 형식·비밀번호 공백 거부', () => {
    expect(validateLogin('not-an-email', 'pw').ok).toBe(false);
    expect(validateLogin('a@b.co', '').ok).toBe(false);
  });
});

describe('validateRevisionNote (1..2000)', () => {
  test('공백 거부·경계', () => {
    expect(validateRevisionNote(' ').ok).toBe(false);
    expect(validateRevisionNote('가').ok).toBe(true);
    expect(validateRevisionNote('가'.repeat(2000)).ok).toBe(true);
    expect(validateRevisionNote('가'.repeat(2001)).ok).toBe(false);
  });
});

describe('validateRejectNote (1..2000)', () => {
  test('공백 거부·경계', () => {
    expect(validateRejectNote('').ok).toBe(false);
    expect(validateRejectNote('사유').ok).toBe(true);
    expect(validateRejectNote('가'.repeat(2000)).ok).toBe(true);
    expect(validateRejectNote('가'.repeat(2001)).ok).toBe(false);
  });
});

describe('validateSceneNote (1..1000)', () => {
  test('공백 거부·경계', () => {
    expect(validateSceneNote('').ok).toBe(false);
    expect(validateSceneNote('가'.repeat(1000)).ok).toBe(true);
    expect(validateSceneNote('가'.repeat(1001)).ok).toBe(false);
  });
});
