// apps/subscriber/src/pwa/__web_tests__/register-service-worker.test.ts
//
// 해소 판정 A(QUEUE 2-2, 대장 #178) — 접미사 없는 import(from '../register-service-worker')가
// 웹 jest 프로젝트(jest.web.config.js, test:web 스크립트)에서 register-service-worker.web.ts로
// 해석되는 것을 실행으로 증명한다. 명시 경로(from '../register-service-worker.web')를 쓰면
// 플랫폼 해석이 여전히 ios인 채로도 통과해버려 판정을 충족하지 못한다 — 그래서 아래 import는
// 반드시 접미사가 없다.
//
// ── 구별 신호를 고르는 이유 ──────────────────────────────────────────────────────
// 네이티브 구현(register-service-worker.ts)은 인자·전역과 무관하게 항상 return null만 한다
// (document를 단 한 번도 건드리지 않는다). 웹 구현은 window/document/navigator.serviceWorker가
// 있으면 document.querySelectorAll('script[src]')를 호출하고(빌드 해시 스캔), 해시를 찾으면
// workbox-window의 Workbox를 생성해 register()까지 부른다. 그래서 "document.querySelectorAll이
// 호출됐는가"와 "Workbox 생성자가 호출됐는가"는 네이티브 경로에서는 원리적으로 발생할 수 없는
// 신호이며, 두 구현이 우연히 같은 결과를 내서 오검출될 여지가 없다.

// workbox-window를 목으로 대체 — 실 Workbox 내부가 navigator.serviceWorker의 실 브라우저 API
// (register/getRegistration 등)를 필요로 해 jsdom만으로는 완주할 수 없다(jsdom은 Service Worker
// API를 구현하지 않는다). 이 목은 "register-service-worker.web.ts가 Workbox를 올바른 인자로
// 생성하고 register()를 호출하는가"만 검증한다 — Workbox 자신의 내부 동작은 검증 범위가 아니다
// (그건 workbox-window 패키지 자신의 책임).
jest.mock('workbox-window', () => ({
  Workbox: jest.fn().mockImplementation(() => ({
    addEventListener: jest.fn(),
    register: jest.fn().mockResolvedValue(undefined),
    messageSkipWaiting: jest.fn(),
  })),
}));

// ⚠️ 접미사 없음 — 네이티브 jest.config.js에서는 register-service-worker.ts(no-op)로, 이 웹
// jest.web.config.js에서는 register-service-worker.web.ts로 해석돼야 한다.
import { registerServiceWorker } from '../register-service-worker';

const { Workbox } = jest.requireMock('workbox-window') as { Workbox: jest.Mock };

const HASHED_SCRIPT_SRC = '/_expo/static/js/web/entry-683b097fb9f4b20ca849cac1bd7b5f25.js';

function stubServiceWorkerContainer(): void {
  // jsdom은 Service Worker API를 구현하지 않는다 — 'serviceWorker' in navigator 가드를
  // 통과시키기 위한 최소 스텁만 둔다(register-service-worker.web.ts는 이 스텁의 메서드를
  // 직접 부르지 않는다 — 전부 workbox-window 목이 대신 받는다).
  Object.defineProperty(navigator, 'serviceWorker', {
    value: {},
    configurable: true,
    writable: true,
  });
}

function clearServiceWorkerContainer(): void {
  // no-explicit-any는 이 워크스페이스 eslint 프리셋에서 전역적으로 꺼져 있다(base.mjs) — disable
  // 주석을 넣으면 reportUnusedDisableDirectives가 잡는다.
  delete (navigator as any).serviceWorker;
}

beforeEach(() => {
  document.body.innerHTML = '';
  Workbox.mockClear();
});

afterEach(() => {
  clearServiceWorkerContainer();
});

test('[해소 판정 A / 직접 증거] require.resolve("../register-service-worker")가 실제로 .web.ts 절대경로를 반환한다', () => {
  // react-native/src/types/globals.d.ts의 NodeRequire는 `(id: string): any`만 선언한다(Metro
  // 런타임 제약 반영) — resolve가 타입에 없을 뿐 jest 실행 환경(Node)에는 실재한다.
  const resolved = (require as unknown as { resolve(id: string): string }).resolve(
    '../register-service-worker',
  );
  console.log(`[해소 판정 A] resolve("../register-service-worker") -> ${resolved}`);
  expect(resolved.endsWith('/register-service-worker.web.ts')).toBe(true);
});

test('serviceWorker 미지원 navigator에서는 document를 건드리지 않고 null — 네이티브와 겉으로 같아 보이지만 로직 경로는 구별된다', () => {
  clearServiceWorkerContainer();
  const spy = jest.spyOn(document, 'querySelectorAll');
  expect(registerServiceWorker()).toBeNull();
  // 가드에서 바로 반환 — 이 시나리오만으로는 네이티브와 구별되지 않는다(그래서 아래 테스트가
  // 필요하다). 여기서는 "querySelectorAll이 아직 호출 전"이라는 사실만 고정한다.
  expect(spy).not.toHaveBeenCalled();
  spy.mockRestore();
});

test('[해소 판정 A] 웹 축 고유 분기 — serviceWorker 지원 시 document.querySelectorAll(script[src])을 스캔한다(네이티브는 이 호출 자체가 없다)', () => {
  stubServiceWorkerContainer();
  const spy = jest.spyOn(document, 'querySelectorAll');

  // 해시 스크립트 태그가 없으면 buildId를 못 찾아 null로 끝난다 — 그래도 querySelectorAll 호출
  // 자체가 .web.ts 고유 증거다(네이티브 구현에는 이 줄이 아예 없다).
  const result = registerServiceWorker();

  expect(result).toBeNull();
  expect(spy).toHaveBeenCalledWith('script[src]');
  expect(Workbox).not.toHaveBeenCalled(); // buildId 없음 → Workbox까지 안 감(정직한 조기 종료)
  spy.mockRestore();
});

test('[해소 판정 A] 웹 축 고유 분기 — 해시 스크립트가 있으면 Workbox를 생성해 register()까지 호출한다', () => {
  stubServiceWorkerContainer();
  const script = document.createElement('script');
  script.src = HASHED_SCRIPT_SRC;
  document.body.appendChild(script);

  const controller = registerServiceWorker();

  expect(controller).not.toBeNull();
  // .web.ts 고유 경로 증거 — 네이티브 register-service-worker.ts에는 `import ... from
  // 'workbox-window'` 줄이 없다(실측: grep -n "from 'workbox-window'" register-service-worker.ts
  // → 0건. 주석에는 이 패키지 이름이 설명용으로 언급돼 있어 패키지명만으로 grep하면 오탐이 난다).
  expect(Workbox).toHaveBeenCalledTimes(1);
  const [scriptUrl, options] = Workbox.mock.calls[0] as [string, { updateViaCache?: string }];
  expect(scriptUrl).toBe('/sw.js?v=683b097fb9f4b20ca849cac1bd7b5f25');
  expect(options).toEqual({ updateViaCache: 'none' });

  const instance = Workbox.mock.results[0]?.value as { register: jest.Mock };
  expect(instance.register).toHaveBeenCalledTimes(1);

  // 컨트롤러 초기 상태 — sw-controller.ts의 INITIAL_SW_UPDATE_STATE와 동형(사본 검증 아님,
  // register-service-worker.web.ts가 그 값을 실제로 반환하는지만 확인).
  expect(controller?.getState()).toEqual({ status: 'idle', userAccepted: false });
});
