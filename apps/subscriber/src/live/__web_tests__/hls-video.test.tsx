// apps/subscriber/src/live/__web_tests__/hls-video.test.tsx
//
// 해소 판정 A(QUEUE 2-2, 대장 #178) — 접미사 없는 import(from '../hls-video')가 웹 jest 프로젝트
// (jest.web.config.js, test:web 스크립트)에서 hls-video.web.tsx로 해석되는 것을 실행으로
// 증명한다. 명시 경로(from '../hls-video.web')를 쓰면 플랫폼 해석이 여전히 ios인 채로도
// 통과해버려 판정을 충족하지 못한다 — 그래서 아래 import는 반드시 접미사가 없다.
//
// ── 렌더링 방식을 react-dom 직접 사용으로 고른 이유(버린 대안 포함) ─────────────────────
// @testing-library/react-native(이 앱의 유일한 렌더 테스트 도구, 기존 패턴)는 내부적으로
// react-test-renderer를 쓴다(실측: node_modules 내 소스에 react-dom require 0건) — 즉 실제
// DOM이 아니라 합성 트리를 만든다. hls-video.web.tsx는 `View`의 ref를 "실제 DOM 노드"로
// 캐스팅해 document.createElement('video')를 직접 appendChild한다(파일 자체 주석이 그 전제를
// 명시한다) — react-test-renderer로 렌더하면 ref가 테스트 인스턴스 핸들이라
// `container.appendChild is not a function`으로 즉시 깨진다(신규 의존 추가 없이 이 전제를
// 만족시키려면 실 DOM 렌더러가 필요하다). react-dom(19.1.0)은 이미 두 앱의 의존성이라(RNW 웹
// 타겟 자체가 요구) 신규 의존 없이 react-dom/client의 createRoot로 실제 DOM에 렌더한다 —
// jest.web.config.js의 testEnvironment=jsdom이 정확히 이 용도다.
import { act } from 'react';
import type { HlsVideoProps } from '../hls-video';

// react-dom/client는 @types/react-dom이 없어(이 앱은 RN/Expo 타입 체계라 신규 devDependency를
// 넣지 않는 한 `import { createRoot } from 'react-dom/client'`가 TS7016으로 막힌다) require()로
// 얻는다 — react-native/src/types/globals.d.ts의 NodeRequire가 `(id: string): any`라 require()의
// 반환값은 이미 any이므로 캐스팅만으로 타입이 선다(신규 의존 없이 해결).
interface ReactDomRoot {
  render(children: unknown): void;
  unmount(): void;
}
const { createRoot } = require('react-dom/client') as {
  createRoot: (container: Element) => ReactDomRoot;
};

// hls.js를 목으로 대체 — 실 MSE(MediaSource Extensions)는 jsdom에 없다. 이 목은
// "hls-video.web.tsx가 Hls를 생성해 loadSource/attachMedia를 올바른 인자로 호출하는가"만
// 검증한다(hls.js 자신의 재생 동작은 검증 범위가 아니다).
jest.mock('hls.js', () => {
  // jest.fn()을 생성자로 써야 .mock.instances가 채워진다(일반 class는 jest가 호출·인스턴스를
  // 추적하지 않는다). isSupported/Events는 컴포넌트가 정적 프로퍼티로 접근하므로 함수 객체에
  // 직접 얹는다.
  const ctor = jest.fn().mockImplementation(function (this: {
    on: jest.Mock;
    loadSource: jest.Mock;
    attachMedia: jest.Mock;
    destroy: jest.Mock;
  }) {
    this.on = jest.fn();
    this.loadSource = jest.fn();
    this.attachMedia = jest.fn();
    this.destroy = jest.fn();
  });
  Object.assign(ctor, { isSupported: jest.fn(() => true), Events: { ERROR: 'hlsError' } });
  return { __esModule: true, default: ctor };
});

// ⚠️ 접미사 없음 — 네이티브 jest.config.js에서는 hls-video.tsx(expo-video 기반)로, 이 웹
// jest.web.config.js에서는 hls-video.web.tsx(hls.js + 순수 DOM <video>)로 해석돼야 한다.
import { HlsVideo } from '../hls-video';

interface MockHlsInstance {
  loadSource: jest.Mock;
  attachMedia: jest.Mock;
}

const MockHls = (jest.requireMock('hls.js') as { default: jest.Mock }).default as jest.Mock & {
  isSupported: jest.Mock;
};

// React 19의 act()가 "DOM 렌더러 환경"으로 인식하려면 이 플래그가 필요하다(jsdom testEnvironment
// 가 기본으로 세팅해 주지 않는다) — 없어도 테스트 결과는 같지만 렌더마다 "act 환경 아님" 경고가
// 콘솔을 채운다.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: ReactDomRoot;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  (MockHls.isSupported as jest.Mock).mockClear();
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

function renderHlsVideo(props: HlsVideoProps): void {
  act(() => {
    root.render(<HlsVideo {...props} />);
  });
}

test('[해소 판정 A / 직접 증거] require.resolve("../hls-video")가 실제로 .web.tsx 절대경로를 반환한다', () => {
  // react-native/src/types/globals.d.ts의 NodeRequire는 `(id: string): any`만 선언한다(Metro
  // 런타임 제약 반영) — resolve가 타입에 없을 뿐 jest 실행 환경(Node)에는 실재한다.
  const resolved = (require as unknown as { resolve(id: string): string }).resolve(
    '../hls-video',
  );
  console.log(`[해소 판정 A] resolve("../hls-video") -> ${resolved}`);
  expect(resolved.endsWith('/hls-video.web.tsx')).toBe(true);
});

test('[해소 판정 A] 웹 축 고유 분기 — 실 DOM에 <video>를 생성하고 hls.js Hls 인스턴스를 연결한다(네이티브는 expo-video만 쓰고 hls.js를 아예 import하지 않는다)', () => {
  renderHlsVideo({ sourceUrl: 'https://example.test/live.m3u8' });

  // .web.tsx 고유 경로 증거 — 네이티브 hls-video.tsx는 <video> DOM 엘리먼트를 만들지 않고
  // expo-video의 VideoView를 렌더한다(react-test-renderer 트리에 실 <video> 태그가 없다).
  const videoEl = container.querySelector('video');
  expect(videoEl).not.toBeNull();
  expect(videoEl?.controls).toBe(true);
  expect(videoEl?.autoplay).toBe(true);

  // hls.js 고유 경로 증거 — 네이티브 구현은 hls.js를 import조차 하지 않는다.
  expect(MockHls.isSupported).toHaveBeenCalledTimes(1);
  expect(MockHls.mock.instances).toHaveLength(1);
  const instance = MockHls.mock.instances[0] as unknown as MockHlsInstance;
  expect(instance.loadSource).toHaveBeenCalledWith('https://example.test/live.m3u8');
  expect(instance.attachMedia).toHaveBeenCalledWith(videoEl);
});

test('sourceUrl이 바뀌면 이전 <video>를 정리하고 새로 만든다(cleanup 경로도 .web.tsx 전용 DOM 조작)', () => {
  renderHlsVideo({ sourceUrl: 'https://example.test/a.m3u8' });
  const firstVideo = container.querySelector('video');
  expect(firstVideo).not.toBeNull();

  renderHlsVideo({ sourceUrl: 'https://example.test/b.m3u8' });
  const videos = container.querySelectorAll('video');
  expect(videos).toHaveLength(1); // 이전 엘리먼트는 제거되고 새 엘리먼트 하나만 남는다
  expect(MockHls.mock.instances).toHaveLength(2); // sourceUrl 변경마다 새 Hls 인스턴스
});
