// apps/subscriber/src/upload/__web_tests__/uploader.test.ts
//
// 해소 판정 A(QUEUE 2-2, 대장 #178) — 접미사 없는 import(from '../uploader')가 웹 jest 프로젝트
// (jest.web.config.js, test:web 스크립트)에서 uploader.web.ts로 해석되는 것을 실행으로 증명한다.
// 명시 경로(from '../uploader.web')를 쓰면 플랫폼 해석이 여전히 ios인 채로도 통과해버려 판정을
// 충족하지 못한다 — 그래서 아래 import는 반드시 접미사가 없다.
//
// ── 구별 신호를 고르는 이유 ──────────────────────────────────────────────────────
// 네이티브 구현(uploader.ts)은 typeof document/typeof XMLHttpRequest와 무관하게 항상
// createUnsupportedUploader()(supported: false)를 반환한다. 웹 구현(uploader.web.ts)은
// document·XMLHttpRequest 전역이 있으면(jsdom은 둘 다 제공) createDomResidentUploader(...)
// (supported: true)로 위임한다. `supported` 값 자체가 두 구현이 원리적으로 다른 결과를 내는
// 지점이라 오검출 여지가 없다.
import { createResidentUploader } from '../uploader';

test('[해소 판정 A / 직접 증거] require.resolve("../uploader")가 실제로 .web.ts 절대경로를 반환한다', () => {
  // react-native/src/types/globals.d.ts의 NodeRequire는 `(id: string): any`만 선언한다(Metro
  // 런타임 제약 반영) — resolve가 타입에 없을 뿐 jest 실행 환경(Node)에는 실재한다.
  const resolved = (require as unknown as { resolve(id: string): string }).resolve('../uploader');
  console.log(`[해소 판정 A] resolve("../uploader") -> ${resolved}`);
  expect(resolved.endsWith('/uploader.web.ts')).toBe(true);
});

test('[해소 판정 A] jsdom(document·XMLHttpRequest 존재)에서 uploader.web.ts는 supported: true — 네이티브는 이 값이 항상 false다', () => {
  const uploader = createResidentUploader();
  expect(uploader.supported).toBe(true);
});

test('[해소 판정 A] pickVideo가 실제 document.createElement("input")을 만들어 클릭한다(dom-uploader.ts 로직 재사용 확인)', async () => {
  // 네이티브 createUnsupportedUploader().pickVideo()는 document를 절대 건드리지 않고 즉시
  // reject한다 — document.createElement 호출 자체가 웹 경로 고유 증거다.
  const createElementSpy = jest.spyOn(document, 'createElement');
  const appendChildSpy = jest.spyOn(document.body, 'appendChild');

  const uploader = createResidentUploader();
  const picked = uploader.pickVideo('library');

  // pickVideo는 change/cancel 이벤트를 기다리며 resolve되지 않는다 — 여기서는 DOM 조립까지만
  // 확인한다(전체 취소·선택 동작 검증은 dom-uploader.test.ts가 이미 담당).
  expect(createElementSpy).toHaveBeenCalledWith('input');
  const inputEl = appendChildSpy.mock.calls.at(-1)?.[0] as HTMLInputElement | undefined;
  expect(inputEl?.type).toBe('file');
  expect(inputEl?.accept).toBe('video/*');
  expect(inputEl?.hasAttribute('capture')).toBe(false); // 'library'는 capture를 안 붙인다

  // 대기 중인 Promise를 정리 — 실제 change 이벤트를 흉내내 취소값으로 안전하게 resolve시킨다
  inputEl?.dispatchEvent(new Event('cancel'));
  await expect(picked).resolves.toBeNull();

  createElementSpy.mockRestore();
  appendChildSpy.mockRestore();
});
