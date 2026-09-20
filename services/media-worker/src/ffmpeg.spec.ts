import { gopFromFps } from './ffmpeg';

/**
 * `gopFromFps` — closed GOP 크기(YouTube 권장: fps÷2) 산출 순수 함수.
 *
 * ⚠️ 이 테스트만으로는 부족하다: "함수가 맞는 값을 낸다"와 "그 값이 실제 ffmpeg 인자
 * (`-g`/`-keyint_min`/`-sc_threshold`)에 들어간다"는 다른 명제다. 후자는
 * `processors.spec.ts`의 `describe('autoEdit — closed GOP')`가 ffprobe로 실측해 잡는다
 * (대장 #232 게이트② A6 무반응 수리 — 순수 함수 테스트 + 산출물 실측 두 겹).
 */
describe('gopFromFps', () => {
  test('실측 fps의 절반(반올림)을 반환한다', () => {
    expect(gopFromFps(24)).toBe(12);
    expect(gopFromFps(30)).toBe(15);
    expect(gopFromFps(60)).toBe(30);
  });

  test('분수 fps(29.97 등)도 반올림해 정수 GOP를 낸다', () => {
    expect(gopFromFps(29.97)).toBe(15);
  });

  test('fps 미상(undefined) — 30fps를 가정(GOP=15)', () => {
    expect(gopFromFps(undefined)).toBe(15);
  });

  test('fps가 0 이하로 들어와도(방어) 30fps 가정으로 폴백한다', () => {
    expect(gopFromFps(0)).toBe(15);
    expect(gopFromFps(-24)).toBe(15);
  });

  test('결과는 항상 1 이상이다(0 GOP 방지)', () => {
    expect(gopFromFps(1)).toBeGreaterThanOrEqual(1);
  });
});
