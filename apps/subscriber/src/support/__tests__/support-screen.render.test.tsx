import { Linking } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import { FAQ_ITEMS } from '../faq-data';

/**
 * `expo-router/head`는 jest 안에서 `@react-navigation/native`(ESM)를 끌고 와 파싱에 실패한다 —
 * pnpm isolated 경로(`node_modules/.pnpm/@react-navigation+native@…/node_modules/@react-navigation/…`)
 * 때문에 jest.config의 transformIgnorePatterns 화이트리스트가 안 걸린다. OG 메타는 이 테스트의
 * 관심사가 아니고 실제 웹 빌드(Metro)에서는 정상 동작하므로(같은 import를 쓰는
 * `app/(tabs)/stations.tsx`가 배포 중) 여기서는 렌더만 통과시킨다. jest.config는 형제 태스크와
 * 공유하는 파일이라 건드리지 않는다.
 */
jest.mock('expo-router/head', () => ({ __esModule: true, default: () => null }));

import SupportScreen from '../../../app/support';

/**
 * 문의하기 화면(app/support.tsx) 렌더 테스트 — T-W1-09 · 정본 06 §F-6.
 *
 * 고정하는 불변식:
 *  ① 값이 설정된 조건에서 **4요소가 전부 렌더된다**(`tel:` · 카카오톡 채널 · **대표 이메일** · FAQ).
 *     02 §E-17은 3요소만 인용한 축약이라 대표 이메일이 빠지는데, 06 정본이 판정 기준이다.
 *  ② 각 항목을 누르면 그 채널의 href로 실제로 연결된다(`Linking.openURL`).
 *  ③ **값이 없는 항목은 아예 렌더되지 않는다** — 흐린 버튼으로도 남기지 않는다(Wave 8a 결함).
 *  ④ 연락처가 하나도 없어도 FAQ는 그대로 남고 빈 화면이 되지 않는다.
 *
 * 테스트를 `src/**\/__tests__/`에 두는 이유: expo-router의 require.context가 `app/` 아래 파일을
 * 라우트로 흡수하므로 여기 두지 않으면 프로덕션 번들이 오염된다(리포 선례 동일).
 */

const ENV_KEYS = [
  'EXPO_PUBLIC_SUPPORT_TEL',
  'EXPO_PUBLIC_KAKAO_CHANNEL_URL',
  'EXPO_PUBLIC_SUPPORT_EMAIL',
] as const;
const ORIGINAL = ENV_KEYS.map((key) => [key, process.env[key]] as const);

function setAllContacts(): void {
  process.env.EXPO_PUBLIC_SUPPORT_TEL = '1670-0000';
  process.env.EXPO_PUBLIC_KAKAO_CHANNEL_URL = 'https://pf.kakao.com/_center';
  process.env.EXPO_PUBLIC_SUPPORT_EMAIL = 'help@example.org';
}

beforeEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

afterAll(() => {
  for (const [key, value] of ORIGINAL) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('문의하기 화면 — 06 §F-6 4요소', () => {
  it('연락처가 설정되면 4요소(전화·카톡·이메일·FAQ)가 모두 렌더된다', async () => {
    setAllContacts();
    const { getByText } = await render(<SupportScreen />);

    // ① tel: 링크
    expect(getByText('전화로 문의하기')).toBeTruthy();
    expect(getByText('1670-0000')).toBeTruthy();
    // ② 카카오톡 채널 링크
    expect(getByText('카카오톡으로 문의하기')).toBeTruthy();
    expect(getByText('https://pf.kakao.com/_center')).toBeTruthy();
    // ③ 대표 이메일 링크 (02 §E-17 축약본에는 없는 요소)
    expect(getByText('이메일로 문의하기')).toBeTruthy();
    expect(getByText('help@example.org')).toBeTruthy();
    // ④ FAQ — 정본 카테고리 5종의 뼈대 문항이 전건 렌더된다
    expect(getByText('자주 묻는 질문')).toBeTruthy();
    for (const item of FAQ_ITEMS) expect(getByText(item.question)).toBeTruthy();
  });

  it('전화를 누르면 tel: 로 연결된다', async () => {
    setAllContacts();
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    const { getByText } = await render(<SupportScreen />);

    await fireEvent.press(getByText('전화로 문의하기'));
    expect(openURL).toHaveBeenCalledWith('tel:1670-0000');
  });

  it('카카오톡을 누르면 채널 URL로 연결된다', async () => {
    setAllContacts();
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    const { getByText } = await render(<SupportScreen />);

    await fireEvent.press(getByText('카카오톡으로 문의하기'));
    expect(openURL).toHaveBeenCalledWith('https://pf.kakao.com/_center');
  });

  it('이메일을 누르면 mailto: 로 연결된다', async () => {
    setAllContacts();
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    const { getByText } = await render(<SupportScreen />);

    await fireEvent.press(getByText('이메일로 문의하기'));
    expect(openURL).toHaveBeenCalledWith('mailto:help@example.org');
  });

  it('대표 이메일이 아직 개통 전(미설정)이면 그 항목만 사라진다 — 나머지는 그대로', async () => {
    setAllContacts();
    delete process.env.EXPO_PUBLIC_SUPPORT_EMAIL;
    const { getByText, queryByText } = await render(<SupportScreen />);

    expect(queryByText('이메일로 문의하기')).toBeNull();
    expect(getByText('전화로 문의하기')).toBeTruthy();
    expect(getByText('카카오톡으로 문의하기')).toBeTruthy();
  });

  it('연락처가 하나도 설정되지 않으면 세 항목 모두 렌더되지 않는다 (흐린 버튼도 없다)', async () => {
    const { queryByText } = await render(<SupportScreen />);

    expect(queryByText('전화로 문의하기')).toBeNull();
    expect(queryByText('카카오톡으로 문의하기')).toBeNull();
    expect(queryByText('이메일로 문의하기')).toBeNull();
  });

  it('연락처가 하나도 없어도 빈 화면이 아니다 — 안내 문구 + FAQ는 남는다', async () => {
    const { getByText } = await render(<SupportScreen />);

    expect(
      getByText('연락처를 준비하고 있습니다. 아래 자주 묻는 질문을 먼저 확인해 주세요.'),
    ).toBeTruthy();
    for (const item of FAQ_ITEMS) expect(getByText(item.question)).toBeTruthy();
  });
});
