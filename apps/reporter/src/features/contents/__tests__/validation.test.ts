import { CultureTopic, ProgramCategory } from '@gachinol/shared';
import { UploadMode } from '../mode';
import {
  emptyClassifyForm,
  emptySceneForm,
  validateClassify,
  validateCreateDraft,
  validateLogin,
  validateRejectNote,
  validateRevisionNote,
  validateScenes,
} from '../validation';
import type { SceneFormValue } from '../validation';

const scene = (patch: Partial<SceneFormValue> = {}): SceneFormValue => ({
  ...emptySceneForm(),
  caption: '자막',
  ...patch,
});

describe('validateLogin', () => {
  test('정상 입력', () => {
    const r = validateLogin('a@b.co', 'pw');
    expect(r).toEqual({ ok: true, value: { email: 'a@b.co', password: 'pw' } });
  });
  test('이메일 형식·비밀번호 공백 거부', () => {
    expect(validateLogin('not-an-email', 'pw').ok).toBe(false);
    expect(validateLogin('a@b.co', '').ok).toBe(false);
  });
});

describe('validateClassify — title 경계 (0·1·200·201)', () => {
  const base = { ...emptyClassifyForm(), category: ProgramCategory.News };
  test.each([
    ['', false],
    ['가', true],
    ['가'.repeat(200), true],
    ['가'.repeat(201), false],
  ])('title %#', (title, ok) => {
    expect(validateClassify({ ...base, title }).ok).toBe(ok);
  });
});

describe('validateClassify — culture ⇔ cultureTopics', () => {
  test('culture 무토픽 거부', () => {
    const r = validateClassify({
      ...emptyClassifyForm(),
      title: '제목',
      category: ProgramCategory.Culture,
      cultureTopics: [],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.cultureTopics).toBeDefined();
  });
  test('비culture + 토픽 거부 (방어적 — UI가 자동 클리어)', () => {
    const r = validateClassify({
      ...emptyClassifyForm(),
      title: '제목',
      category: ProgramCategory.News,
      cultureTopics: [CultureTopic.Reading],
    });
    expect(r.ok).toBe(false);
  });
  test('culture + 토픽 1개 통과', () => {
    const r = validateClassify({
      ...emptyClassifyForm(),
      title: '제목',
      category: ProgramCategory.Culture,
      cultureTopics: [CultureTopic.Festival],
    });
    expect(r.ok).toBe(true);
  });
});

describe('validateScenes', () => {
  test('caption 500 경계 (500 통과 / 501 거부)', () => {
    expect(validateScenes([scene({ caption: '가'.repeat(500) })]).ok).toBe(true);
    expect(validateScenes([scene({ caption: '가'.repeat(501) })]).ok).toBe(false);
  });
  test('scenes 0개 거부 (앱 정책 — 서버는 0 허용)', () => {
    const r = validateScenes([]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.scenes).toBeDefined();
  });
  test('scenes 201개 거부 (서버 max 200)', () => {
    const many = Array.from({ length: 201 }, () => scene());
    expect(validateScenes(many).ok).toBe(false);
  });
  test('startSec 음수 거부', () => {
    expect(validateScenes([scene({ startSec: '-1' })]).ok).toBe(false);
  });
  test('end ≤ start 거부 (앱 정책 — 서버 미검증)', () => {
    expect(validateScenes([scene({ startSec: '10', endSec: '10' })]).ok).toBe(false);
    expect(validateScenes([scene({ startSec: '10', endSec: '5' })]).ok).toBe(false);
    expect(validateScenes([scene({ startSec: '10', endSec: '11' })]).ok).toBe(true);
  });
  test('order 자동 연속 부여 (0부터, 인덱스 파생)', () => {
    const r = validateScenes([
      scene({ caption: 'A' }),
      scene({ caption: 'B' }),
      scene({ caption: 'C' }),
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.map((s) => s.order)).toEqual([0, 1, 2]);
  });
  test('빈칸 초는 null로', () => {
    const r = validateScenes([scene({ startSec: '', endSec: '' })]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value[0]?.startSec).toBeNull();
      expect(r.value[0]?.endSec).toBeNull();
    }
  });
});

describe('validateCreateDraft — 정상 입력 → CreateContentDraftRequest 형태', () => {
  test('합성 성공', () => {
    const r = validateCreateDraft(
      {
        title: '애월 감귤밭 소식',
        description: '수확 현장',
        category: ProgramCategory.Culture,
        cultureTopics: [CultureTopic.Farmer, CultureTopic.Producer],
      },
      [scene({ caption: '인트로', startSec: '0', endSec: '12' }), scene({ caption: '인터뷰' })],
      UploadMode.Precise,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toEqual({
        title: '애월 감귤밭 소식',
        description: '수확 현장',
        category: 'culture',
        cultureTopics: ['farmer', 'producer'],
        scenes: [
          { order: 0, caption: '인트로', startSec: 0, endSec: 12 },
          { order: 1, caption: '인터뷰', startSec: null, endSec: null },
        ],
      });
    }
  });
  test('분류·장면 에러 병합', () => {
    const r = validateCreateDraft({ ...emptyClassifyForm() }, [], UploadMode.Precise);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.title).toBeDefined();
      expect(r.errors.category).toBeDefined();
      expect(r.errors.scenes).toBeDefined();
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * ★ 간단 모드가 정밀 모드와 **실제로 다르다** (T-W2-34, 대장 #123).
 *
 * T-W1-07b는 이 지점에서 "간단 모드가 항등함수"라는 판정을 받았다 — 모드 선택이 자막 단계 뒤에
 * 있어서 어느 모드를 골라도 결과가 같았다. 아래 단정들이 그 회귀를 고정한다: **같은 입력**에
 * 모드만 바꿔 넣었을 때 결과가 달라야 한다.
 * ══════════════════════════════════════════════════════════════════════════ */
describe('validateCreateDraft — 모드 분기', () => {
  const classify = {
    title: '애월 해녀 물질',
    description: '',
    category: ProgramCategory.News,
    cultureTopics: [],
  };

  test('간단 모드는 자막 없이도 통과하고 scenes를 빈 배열로 저장한다', () => {
    // 자막 화면을 거치지 않은 상태 그대로 = 빈 카드 1장(위저드 초기값)
    const r = validateCreateDraft(classify, [emptySceneForm()], UploadMode.Simple);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.scenes).toEqual([]);
  });

  test('정밀 모드는 같은 입력을 거부한다 — 두 모드가 같은 함수가 아니라는 증거', () => {
    const r = validateCreateDraft(classify, [emptySceneForm()], UploadMode.Precise);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors['scenes.0.caption']).toBe('자막을 입력해 주세요');
  });

  test('간단 모드는 입력된 자막까지 버린다 — 자막 단계를 아예 거치지 않았다는 뜻', () => {
    const filled = [scene({ caption: '버려질 자막' })];
    const simple = validateCreateDraft(classify, filled, UploadMode.Simple);
    const precise = validateCreateDraft(classify, filled, UploadMode.Precise);
    expect(simple.ok && precise.ok).toBe(true);
    if (simple.ok && precise.ok) {
      expect(simple.value.scenes).toEqual([]);
      expect(precise.value.scenes).toHaveLength(1);
      // 항등함수였다면 이 둘이 같아야 한다
      expect(simple.value).not.toEqual(precise.value);
    }
  });

  test('간단 모드여도 분류 검증은 그대로다 — 생략되는 것은 자막뿐', () => {
    const r = validateCreateDraft(emptyClassifyForm(), [], UploadMode.Simple);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.title).toBeDefined();
      expect(r.errors.category).toBeDefined();
      expect(r.errors.scenes).toBeUndefined(); // 자막 오류는 나오지 않는다
    }
  });
});

describe('note 검증 (1..2000)', () => {
  test('revision note 필수·경계', () => {
    expect(validateRevisionNote('').ok).toBe(false);
    expect(validateRevisionNote('가'.repeat(2000)).ok).toBe(true);
    expect(validateRevisionNote('가'.repeat(2001)).ok).toBe(false);
  });
  test('reject note 필수', () => {
    expect(validateRejectNote(' ').ok).toBe(false);
    expect(validateRejectNote('사유').ok).toBe(true);
  });
});
