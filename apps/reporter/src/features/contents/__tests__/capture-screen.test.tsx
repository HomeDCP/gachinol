import { render, fireEvent, waitFor } from '@testing-library/react-native';

/**
 * 신규 콘텐츠 촬영/선택 화면 렌더 테스트 (대장 #230 1차 수리).
 *
 * 배경: `[카메라로 촬영]`(`<input capture>` 경로)은 WebKit 미해결 버그
 * (bugs.webkit.org #197216 — OPEN, 2019~)로 iOS에서 저화질(360×480)만 만든다. 앱이 고칠 수
 * 없는 문제라, 이번 수리는 경로 신설이 아니라 **화면 순서·문구로 기자를 이미 고화질이 실증된
 * 갤러리 경로로 먼저 안내**하는 것이다.
 *
 * 고정하는 것:
 *  ① 갤러리 선택 버튼이 카메라 촬영 버튼보다 먼저(주 버튼으로) 나온다 — 舊 배치(카메라가 먼저)의
 *     회귀를 막는다.
 *  ② 갤러리 버튼을 누르면 여전히 `launchImageLibraryAsync`로 이어진다(기존 동작 무변경 확인).
 *  ③ 카메라 버튼을 누르면 여전히 촬영 화면(녹화 시작/닫기)으로 전환된다(기존 동작 무변경 확인).
 *  ④ 카메라 버튼 라벨에 화질이 낮다는 사실이 명시돼 있다 — 기자가 모르고 누르면 안 된다.
 *  ⑤ 화면 문구에 시니어 기자가 이해하기 어려운 기술 용어가 없다.
 *  ⑥ 두 버튼 모두 화면에 남아 있다 — 카메라 경로가 제거되지 않는다(네트워크 없는 현장 대비).
 *
 * 테스트는 `src/**` 아래에 둔다 — `app/` 아래 두면 expo-router의 `require.context`가 라우트로
 * 흡수해 프로덕션 번들이 오염된다(wizard-mode.test.tsx와 같은 근거).
 */

jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  useNavigation: () => ({ addListener: () => () => undefined }),
}));

jest.mock('expo-camera', () => ({
  CameraView: () => null,
  useCameraPermissions: () => [{ granted: true, canAskAgain: true }, jest.fn()],
  useMicrophonePermissions: () => [{ granted: true, canAskAgain: true }, jest.fn()],
}));

jest.mock('expo-file-system/legacy', () => ({
  getInfoAsync: jest.fn(),
}));

const mockLaunchImageLibraryAsync = jest.fn();
jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: (...args: unknown[]) => mockLaunchImageLibraryAsync(...args),
}));

import { DraftProvider } from '../draft-context';
import CaptureScreen from '../../../../app/(app)/contents/new/index';

const GALLERY_LABEL = '휴대폰 카메라로 찍은 영상 올리기';
const CAMERA_LABEL = '여기서 바로 촬영 (화질 낮음)';
const FORBIDDEN_TERMS = ['해상도', '비트레이트', 'WebKit', 'capture', '360', '480'];

// 안내문 회귀 가드 (M3, 게이트② 무반응 수리) — 전문 완전일치는 사소한 다듬기마다 깨지므로
// "기자가 무엇을 해야 하는지"를 담은 행동 지시 핵심 구절만 검사한다. 舊 문구
// ("현장 영상을 촬영하거나 촬영해 둔 영상을 선택하세요.")는 이 핵심 구절이 없어 되돌리면
// 아래 존재 검사가 즉시 빨간불이 된다. 舊 문구 부재도 함께 확인해 이중으로 잡는다.
const GUIDANCE_CORE_PHRASE = '휴대폰 기본 카메라 앱으로 먼저 찍고';
const OLD_GUIDANCE_PHRASE = '현장 영상을 촬영하거나 촬영해 둔 영상을 선택하세요';

// ⚠️ @testing-library/react-native 14.x의 render()는 AsyncFunction이다(React 19 대응) —
// await 없이 결과를 쓰면 Promise가 그대로 잡혀 `.toJSON is not a function`으로 실패한다
// (실측: 이 파일 작성 중 직접 부딪힘). 반드시 await한다.
async function renderScreen() {
  return render(
    <DraftProvider>
      <CaptureScreen />
    </DraftProvider>,
  );
}

describe('신규 콘텐츠 촬영 화면 — 갤러리 경로가 주 버튼이다 (대장 #230)', () => {
  beforeEach(() => {
    mockLaunchImageLibraryAsync.mockReset();
    mockLaunchImageLibraryAsync.mockResolvedValue({ canceled: true });
  });

  it('① 갤러리 버튼이 카메라 버튼보다 먼저(주 버튼으로) 나온다', async () => {
    const utils = await renderScreen();
    const tree = JSON.stringify(utils.toJSON());
    const galleryIdx = tree.indexOf(GALLERY_LABEL);
    const cameraIdx = tree.indexOf(CAMERA_LABEL);
    expect(galleryIdx).toBeGreaterThan(-1);
    expect(cameraIdx).toBeGreaterThan(-1);
    expect(galleryIdx).toBeLessThan(cameraIdx);
  });

  it('② 갤러리 버튼은 여전히 launchImageLibraryAsync로 이어진다 (기존 동작 무변경)', async () => {
    const utils = await renderScreen();
    await fireEvent.press(utils.getByText(GALLERY_LABEL));
    expect(mockLaunchImageLibraryAsync).toHaveBeenCalledTimes(1);
  });

  it('③ 카메라 버튼은 여전히 촬영 화면으로 전환된다 (기존 동작 무변경)', async () => {
    const utils = await renderScreen();
    await fireEvent.press(utils.getByText(CAMERA_LABEL));
    await waitFor(() => expect(utils.getByText('녹화 시작')).toBeTruthy());
  });

  it('④ 카메라 버튼 라벨에 화질이 낮다는 사실이 명시돼 있다', async () => {
    const utils = await renderScreen();
    expect(utils.getByText(CAMERA_LABEL)).toBeTruthy();
    expect(CAMERA_LABEL).toContain('화질 낮음');
  });

  it('⑤ 화면 문구에 기술 용어가 없다', async () => {
    const utils = await renderScreen();
    const tree = JSON.stringify(utils.toJSON());
    for (const term of FORBIDDEN_TERMS) {
      expect(tree).not.toContain(term);
    }
  });

  it('⑥ 두 버튼 모두 화면에 남아 있다', async () => {
    const utils = await renderScreen();
    expect(utils.getByText(GALLERY_LABEL)).toBeTruthy();
    expect(utils.getByText(CAMERA_LABEL)).toBeTruthy();
  });

  it('⑦ 안내문이 갤러리 경로 유도 핵심 구절을 담고 있고, 舊 문구로 되돌아가지 않았다', async () => {
    const utils = await renderScreen();
    const tree = JSON.stringify(utils.toJSON());
    expect(tree).toContain(GUIDANCE_CORE_PHRASE);
    expect(tree).not.toContain(OLD_GUIDANCE_PHRASE);
  });
});
