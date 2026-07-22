import type { CaptionCue } from '@gachinol/shared';

/**
 * 순수 셀렉터 — 현재 재생 시각 t(초)에 해당하는 활성 자막 큐를 고른다.
 * 구간은 반열림 [startSec, endSec) — 인접 큐 경계에서 두 개가 동시에 켜지지 않는다.
 * 큐가 겹치면 정의 순서상 먼저 매칭되는 것을 반환(겹침 방어). 없으면 null.
 * expo-video 등 네이티브 모듈에 의존하지 않아 단위테스트로 커버 가능하다.
 */
export function selectActiveCue(cues: readonly CaptionCue[], t: number): CaptionCue | null {
  for (const cue of cues) {
    if (t >= cue.startSec && t < cue.endSec) return cue;
  }
  return null;
}
