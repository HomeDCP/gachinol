import { zCreateStation, zUpdateStation } from './station.schemas';

/**
 * 지사 공개 연락 채널(T-W2-28 · 대장 #127) 쓰기 경계 검증.
 *
 * 이 두 값은 구독자 웹의 재생 실패 폴백에서 **누르는 순간 어딘가로 나가는 값**이라, 빈 값이
 * 저장되면 앱이 "설정됨"으로 오판해 목적지 없는 버튼을 그린다(Wave 8a에서 한 웨이브에 3번 나온
 * 결함 유형). 그래서 형식 검증을 쓰기 경계에 둔다 — 읽기(투영)의 `if (값)` 가드는 2차 방어다.
 */
const base = {
  code: 'aewol',
  name: '애월 마을방송국',
  kind: 'branch' as const,
  region: '제주시 애월읍',
  sortOrder: 1,
};

describe('zCreateStation — supportTel(공개 대표번호)', () => {
  it('미지정이 정상 — 옵셔널이라 통과한다(연락처 없는 지사가 정상 상태)', () => {
    const parsed = zCreateStation.parse({ ...base });
    expect(parsed.supportTel).toBeUndefined();
    expect(parsed.youtubeUrl).toBeUndefined();
  });

  it.each(['064-000-0000', '+82-64-000-0000', '15880000'])('유효 번호 통과: %s', (tel) => {
    expect(zCreateStation.parse({ ...base, supportTel: tel }).supportTel).toBe(tel);
  });

  it.each([
    ['빈 문자열', ''],
    ['공백만', '   '],
    ['탭·개행만', '\t\n'],
    ['문자 포함', '064-없음-0000'],
    ['하이픈만', '---'],
  ])('거부: %s', (_label, tel) => {
    expect(zCreateStation.safeParse({ ...base, supportTel: tel }).success).toBe(false);
  });

  it('앞뒤 공백은 trim 후 저장된다(공백이 섞인 값이 "설정됨"으로 남지 않게)', () => {
    expect(zCreateStation.parse({ ...base, supportTel: '  064-000-0000  ' }).supportTel).toBe(
      '064-000-0000',
    );
  });
});

describe('zCreateStation — youtubeUrl(공식 채널·라이브 URL)', () => {
  it.each([
    'https://www.youtube.com/@gachinol-demo-aewol',
    'https://youtu.be/abcdefghijk',
    'https://youtube.com/live/abc',
    'https://m.youtube.com/@demo',
  ])('유효 URL 통과: %s', (url) => {
    expect(zCreateStation.parse({ ...base, youtubeUrl: url }).youtubeUrl).toBe(url);
  });

  it.each([
    ['빈 문자열', ''],
    ['공백만', '  '],
    ['URL 아님', 'youtube'],
    ['http(비보안)', 'http://www.youtube.com/@demo'],
    ['유튜브가 아닌 호스트', 'https://example.com/watch'],
    ['호스트 위장(접미사만 유사)', 'https://notyoutube.com/@demo'],
  ])('거부: %s', (_label, url) => {
    expect(zCreateStation.safeParse({ ...base, youtubeUrl: url }).success).toBe(false);
  });
});

describe('zUpdateStation — 동일 규칙이 수정에도 적용된다', () => {
  it('유효 값은 통과', () => {
    const parsed = zUpdateStation.parse({
      supportTel: '064-000-0000',
      youtubeUrl: 'https://www.youtube.com/@gachinol-demo-aewol',
    });
    expect(parsed.supportTel).toBe('064-000-0000');
    expect(parsed.youtubeUrl).toBe('https://www.youtube.com/@gachinol-demo-aewol');
  });

  it('빈 값으로 "지우기"는 허용하지 않는다 — 400으로 막힌다(null 지우기 미지원 규약)', () => {
    expect(zUpdateStation.safeParse({ supportTel: '' }).success).toBe(false);
    expect(zUpdateStation.safeParse({ youtubeUrl: '' }).success).toBe(false);
  });
});
