import type { CaptionCue } from '@gachinol/shared';
import { selectActiveCue } from '../captions';

const cues: readonly CaptionCue[] = [
  { startSec: 0, endSec: 2, text: '첫 자막' },
  { startSec: 2, endSec: 4, text: '둘째 자막' },
  { startSec: 6, endSec: 8, text: '셋째 자막' }, // 4~6 갭
];

describe('selectActiveCue', () => {
  test('구간 내 → 해당 큐', () => {
    expect(selectActiveCue(cues, 1)?.text).toBe('첫 자막');
    expect(selectActiveCue(cues, 3)?.text).toBe('둘째 자막');
    expect(selectActiveCue(cues, 7)?.text).toBe('셋째 자막');
  });

  test('시작 경계 포함 [start …', () => {
    expect(selectActiveCue(cues, 0)?.text).toBe('첫 자막');
    expect(selectActiveCue(cues, 2)?.text).toBe('둘째 자막');
    expect(selectActiveCue(cues, 6)?.text).toBe('셋째 자막');
  });

  test('끝 경계 제외 … end) — 인접 큐로 넘어가거나 null', () => {
    // t=4는 둘째(endSec 4) 제외, 셋째(6~)는 아직 → null
    expect(selectActiveCue(cues, 4)).toBeNull();
    // t=8은 셋째 endSec 제외 → null
    expect(selectActiveCue(cues, 8)).toBeNull();
  });

  test('첫 큐 이전·갭·마지막 이후 → null', () => {
    expect(selectActiveCue(cues, -1)).toBeNull();
    expect(selectActiveCue(cues, 5)).toBeNull();
    expect(selectActiveCue(cues, 100)).toBeNull();
  });

  test('빈 큐 배열 → null', () => {
    expect(selectActiveCue([], 3)).toBeNull();
  });

  test('겹침 방어 — 정의 순서상 먼저 매칭되는 큐', () => {
    const overlapping: readonly CaptionCue[] = [
      { startSec: 0, endSec: 5, text: 'A' },
      { startSec: 3, endSec: 8, text: 'B' },
    ];
    expect(selectActiveCue(overlapping, 4)?.text).toBe('A');
  });
});
