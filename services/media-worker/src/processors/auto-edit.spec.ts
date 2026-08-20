import { buildTimeline } from './auto-edit';

/**
 * 타임라인 매핑 — api가 `Scene.startSec/endSec`를 배포본 기준으로 재기입할 때 쓴다.
 * Phase 1은 컷이 없어 **항등**이어야 한다. 항등이 깨지면 구독자 앱의 자막 오버레이가 밀린다.
 */
describe('buildTimeline', () => {
  test('컷 없음 — 항등 매핑 1건 (Phase 1의 실경로)', () => {
    expect(buildTimeline([], 117.9, 117.9)).toEqual([
      { sourceStartSec: 0, sourceEndSec: 117.9, outputStartSec: 0, outputEndSec: 117.9 },
    ]);
  });

  test('컷 없음 — 출력 길이를 우선 쓴다(인코딩으로 미세하게 달라질 수 있다)', () => {
    const [m] = buildTimeline([], 63.8, 63.9);
    expect(m.sourceEndSec).toBe(63.9);
    expect(m.outputEndSec).toBe(63.9);
  });

  test('컷 없음 — 길이를 모르면 빈 배열(api가 재기입을 건너뛴다)', () => {
    expect(buildTimeline([], undefined, undefined)).toEqual([]);
  });

  test('컷 있음 — 구간을 배열 순서대로 이어붙인 누적 오프셋', () => {
    const segments = [
      { startSec: 10, endSec: 25 },
      { startSec: 40, endSec: 55 },
      { startSec: 80, endSec: 95 },
    ];
    expect(buildTimeline(segments, 117.9, 45)).toEqual([
      { sourceStartSec: 10, sourceEndSec: 25, outputStartSec: 0, outputEndSec: 15 },
      { sourceStartSec: 40, sourceEndSec: 55, outputStartSec: 15, outputEndSec: 30 },
      { sourceStartSec: 80, sourceEndSec: 95, outputStartSec: 30, outputEndSec: 45 },
    ]);
  });

  test('컷 있음 — 원본 순서를 벗어나도 배열 순서가 출력 순서다', () => {
    const segments = [
      { startSec: 80, endSec: 90 },
      { startSec: 10, endSec: 20 },
    ];
    const t = buildTimeline(segments, 117.9, 20);
    expect(t.map((m) => m.outputStartSec)).toEqual([0, 10]);
    expect(t.map((m) => m.sourceStartSec)).toEqual([80, 10]);
  });

  test('컷 있음 — 역전 구간은 길이 0으로 흡수(음수 누적 방지)', () => {
    const t = buildTimeline([{ startSec: 30, endSec: 20 }, { startSec: 0, endSec: 5 }], 60, 5);
    expect(t[0].outputEndSec).toBe(0);
    expect(t[1]).toEqual({
      sourceStartSec: 0,
      sourceEndSec: 5,
      outputStartSec: 0,
      outputEndSec: 5,
    });
  });
});
