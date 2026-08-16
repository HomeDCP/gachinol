import { StationStatus, toId } from '@gachinol/shared';
import type { StationId, StationSummary } from '@gachinol/shared';
import { findStationFor, resolveStationContact, toTelHref } from '../contact';

const station = (over: Partial<StationSummary> = {}): StationSummary => ({
  id: toId<StationId>('01920000-0000-7000-8000-000000000001'),
  name: '애월 마을방송국',
  region: '제주시 애월읍',
  status: StationStatus.Dormant,
  ...over,
});

const AEWOL = station({ supportTel: '064-000-0000', youtubeUrl: 'https://youtube.com/@aewol' });
const JEJU = station({
  id: toId<StationId>('01920000-0000-7000-8000-000000000002'),
  name: '제주시 마을방송국',
  region: '제주시',
  supportTel: '064-000-0001',
});

describe('toTelHref — 서버가 준 원본 번호를 tel: href로', () => {
  it('숫자·하이픈은 그대로 tel:에 붙는다', () => {
    expect(toTelHref('064-000-0000')).toBe('tel:064-000-0000');
  });

  it('공백·괄호는 제거한다(다이얼러가 못 읽는 문자 금지)', () => {
    expect(toTelHref(' (064) 000 0000 ')).toBe('tel:0640000000');
  });

  it.each([null, undefined, '', '   '])('값이 없으면 null: %p', (value) => {
    expect(toTelHref(value)).toBeNull();
  });
});

describe('findStationFor — 연락 채널의 원천이 될 지사 고르기', () => {
  it('stationId가 있으면 id로 찾는다', () => {
    expect(findStationFor([AEWOL, JEJU], { stationId: JEJU.id })).toBe(JEJU);
  });

  it('stationId가 목록에 없으면 null (이름으로 넘어가지 않는다)', () => {
    const missing = toId<StationId>('01920000-0000-7000-8000-0000000000ff');
    expect(
      findStationFor([AEWOL, JEJU], { stationId: missing, stationName: '애월 마을방송국' }),
    ).toBeNull();
  });

  it('stationId가 없으면 이름 정확 일치로 찾는다(PlaybackInfo에 id가 없는 경우)', () => {
    expect(findStationFor([AEWOL, JEJU], { stationName: '애월 마을방송국' })).toBe(AEWOL);
  });

  it('동명 지사가 2곳 이상이면 null — 엉뚱한 지사로 전화 걸리느니 경로를 숨긴다', () => {
    const twin = station({ id: toId<StationId>('01920000-0000-7000-8000-0000000000aa') });
    expect(findStationFor([AEWOL, twin], { stationName: '애월 마을방송국' })).toBeNull();
  });

  it.each([
    ['목록 미도착(undefined)', undefined],
    ['빈 목록', [] as readonly StationSummary[]],
  ])('%s이면 null', (_label, stations) => {
    expect(findStationFor(stations, { stationName: '애월 마을방송국' })).toBeNull();
  });

  it('참조가 비어 있으면 null(라이브처럼 지사를 특정할 수 없는 화면)', () => {
    expect(findStationFor([AEWOL, JEJU], {})).toBeNull();
    expect(findStationFor([AEWOL, JEJU], { stationName: '  ' })).toBeNull();
  });
});

describe('resolveStationContact — 서버 값 우선, env 폴백, 없으면 null', () => {
  it('서버 값이 있으면 env보다 우선한다(지사별 값이 빌드 전역 값을 이긴다)', () => {
    const contact = resolveStationContact({
      station: AEWOL,
      envSupportTelHref: 'tel:1670-9999',
      envYoutubeUrl: 'https://youtube.com/@center',
    });
    expect(contact.supportTelHref).toBe('tel:064-000-0000');
    expect(contact.youtubeUrl).toBe('https://youtube.com/@aewol');
  });

  it('서버 값이 없으면 env로 폴백한다(지사를 못 찾은 화면의 최후 수단)', () => {
    const contact = resolveStationContact({
      station: null,
      envSupportTelHref: 'tel:1670-9999',
      envYoutubeUrl: 'https://youtube.com/@center',
    });
    expect(contact.supportTelHref).toBe('tel:1670-9999');
    expect(contact.youtubeUrl).toBe('https://youtube.com/@center');
  });

  it('지사가 일부만 설정했으면 그 항목만 서버 값, 나머지는 env', () => {
    const contact = resolveStationContact({
      station: JEJU, // youtubeUrl 미설정
      envSupportTelHref: 'tel:1670-9999',
      envYoutubeUrl: 'https://youtube.com/@center',
    });
    expect(contact.supportTelHref).toBe('tel:064-000-0001');
    expect(contact.youtubeUrl).toBe('https://youtube.com/@center');
  });

  it('서버·env 둘 다 없으면 null — 화면은 그 대체 경로를 숨긴다', () => {
    const contact = resolveStationContact({
      station: station(),
      envSupportTelHref: null,
      envYoutubeUrl: null,
    });
    expect(contact).toEqual({ supportTelHref: null, youtubeUrl: null });
  });

  it('서버가 공백만 흘려도 "설정됨"으로 치지 않는다(env가 있으면 env, 없으면 null)', () => {
    const blank = station({ supportTel: '   ', youtubeUrl: '\t' });
    expect(
      resolveStationContact({ station: blank, envSupportTelHref: null, envYoutubeUrl: null }),
    ).toEqual({ supportTelHref: null, youtubeUrl: null });
    expect(
      resolveStationContact({
        station: blank,
        envSupportTelHref: 'tel:1670-9999',
        envYoutubeUrl: null,
      }).supportTelHref,
    ).toBe('tel:1670-9999');
  });
});
