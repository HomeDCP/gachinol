import { toId, type Station, type StationId } from '@gachinol/shared';
import {
  emptyStationForm,
  stationToFormValues,
  validateCreateStation,
  validateUpdateStation,
  type StationFormValues,
} from '../validation';

const form = (patch: Partial<StationFormValues> = {}): StationFormValues => ({
  ...emptyStationForm(),
  code: 'aewol',
  name: '애월 마을방송국',
  region: '제주시 애월읍',
  sortOrder: '1',
  ...patch,
});

describe('validateCreateStation — 필수 항목', () => {
  it('최소 입력이면 kind=branch·sortOrder 숫자로 DTO가 만들어진다', () => {
    const result = validateCreateStation(form());
    expect(result).toEqual({
      ok: true,
      value: {
        code: 'aewol',
        name: '애월 마을방송국',
        kind: 'branch',
        region: '제주시 애월읍',
        sortOrder: 1,
      },
    });
  });

  it('code는 소문자로 정규화된다', () => {
    const result = validateCreateStation(form({ code: '  AeWol  ' }));
    expect(result.ok && result.value.code).toBe('aewol');
  });

  it.each([['aewol_1'], ['애월'], ['ae wol']])('code %s는 거부된다', (code) => {
    const result = validateCreateStation(form({ code }));
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors.code).toBeTruthy();
  });

  it('빈 필수 항목은 모두 에러로 모인다', () => {
    const result = validateCreateStation({ ...emptyStationForm() });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.errors).sort()).toEqual(['code', 'name', 'region', 'sortOrder']);
  });

  it.each([['-1'], ['1.5'], ['둘']])('sortOrder %s는 거부된다 (0 이상 정수)', (sortOrder) => {
    const result = validateCreateStation(form({ sortOrder }));
    expect(result.ok).toBe(false);
  });

  it('sortOrder 0은 유효하다', () => {
    const result = validateCreateStation(form({ sortOrder: '0' }));
    expect(result.ok && result.value.sortOrder).toBe(0);
  });
});

describe('validateCreateStation — 선택 항목은 비면 키를 생략한다', () => {
  it('공백만 있는 선택 항목은 DTO에 아예 담기지 않는다 (서버가 빈 값을 거부한다)', () => {
    const result = validateCreateStation(
      form({ supportTel: '   ', youtubeUrl: '  ', description: '', foundedAt: ' ' }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect('supportTel' in result.value).toBe(false);
    expect('youtubeUrl' in result.value).toBe(false);
    expect('description' in result.value).toBe(false);
    expect('foundedAt' in result.value).toBe(false);
  });

  it('유효한 선택 항목은 trim되어 담긴다', () => {
    const result = validateCreateStation(
      form({
        supportTel: ' 064-000-0000 ',
        youtubeUrl: 'https://www.youtube.com/@aewol',
        thumbnailUrl: 'https://cdn.example.com/a.png',
        foundedAt: '2025-03-01',
        description: ' 애월 지사 ',
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.supportTel).toBe('064-000-0000');
    expect(result.value.youtubeUrl).toBe('https://www.youtube.com/@aewol');
    expect(result.value.thumbnailUrl).toBe('https://cdn.example.com/a.png');
    expect(result.value.foundedAt).toBe('2025-03-01');
    expect(result.value.description).toBe('애월 지사');
  });

  it.each([['010 1234 5678'], ['tel:064'], ['-']])('대표번호 %s는 거부된다', (supportTel) => {
    const result = validateCreateStation(form({ supportTel }));
    expect(result.ok).toBe(false);
  });

  it.each([
    ['http://youtube.com/@a'],
    ['https://vimeo.com/1'],
    ['https://notyoutube.com/@a'],
    ['youtube.com/@a'],
  ])('유튜브 주소 %s는 거부된다', (youtubeUrl) => {
    const result = validateCreateStation(form({ youtubeUrl }));
    expect(result.ok).toBe(false);
  });

  it.each([['https://youtu.be/abc'], ['https://m.youtube.com/@a'], ['https://youtube.com']])(
    '유튜브 주소 %s는 허용된다',
    (youtubeUrl) => {
      expect(validateCreateStation(form({ youtubeUrl })).ok).toBe(true);
    },
  );

  it.each([['2026-02-31'], ['2026-13-01'], ['20260301'], ['2026-3-1']])(
    '설립일 %s는 거부된다 (실존 날짜만)',
    (foundedAt) => {
      expect(validateCreateStation(form({ foundedAt })).ok).toBe(false);
    },
  );

  it('윤년 2024-02-29는 허용된다', () => {
    expect(validateCreateStation(form({ foundedAt: '2024-02-29' })).ok).toBe(true);
  });
});

describe('validateUpdateStation — code·kind·status는 대상이 아니다', () => {
  it('DTO에 code/kind/status 키가 없다', () => {
    const result = validateUpdateStation(form());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect('code' in result.value).toBe(false);
    expect('kind' in result.value).toBe(false);
    expect('status' in result.value).toBe(false);
    expect(result.value).toEqual({ name: '애월 마을방송국', region: '제주시 애월읍', sortOrder: 1 });
  });

  it('code가 비어 있어도 수정은 통과한다 (수정 대상이 아니므로)', () => {
    expect(validateUpdateStation(form({ code: '' })).ok).toBe(true);
  });
});

describe('stationToFormValues — 수정 폼 프리필', () => {
  const station: Station = {
    id: toId<StationId>('01234567-89ab-7def-8123-456789abcdef'),
    code: 'aewol',
    name: '애월 마을방송국',
    kind: 'branch',
    status: 'dormant',
    region: '제주시 애월읍',
    sortOrder: 2,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  it('미설정 선택 필드는 빈 문자열이 된다 (undefined가 TextInput에 새지 않게)', () => {
    expect(stationToFormValues(station)).toEqual({
      code: 'aewol',
      name: '애월 마을방송국',
      region: '제주시 애월읍',
      sortOrder: '2',
      description: '',
      thumbnailUrl: '',
      supportTel: '',
      youtubeUrl: '',
      foundedAt: '',
    });
  });

  it('프리필을 그대로 저장하면 값이 보존된다 (왕복 무손실)', () => {
    const filled: Station = {
      ...station,
      description: '애월 지사',
      supportTel: '064-000-0000',
      youtubeUrl: 'https://youtube.com/@aewol',
      foundedAt: '2025-03-01',
    };
    const result = validateUpdateStation(stationToFormValues(filled));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.supportTel).toBe('064-000-0000');
    expect(result.value.youtubeUrl).toBe('https://youtube.com/@aewol');
    expect(result.value.foundedAt).toBe('2025-03-01');
  });
});
