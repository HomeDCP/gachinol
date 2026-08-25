import type { Content, Scene } from '@gachinol/shared';
import type { ClassifyFormValue, SceneFormValue } from './validation';

/** 화면 전용 변환만 — 계약 재정의 금지 */

/** 서버 Scene → 편집 폼 값 (id·thumbnailUrl 제거 — PATCH는 SceneInput 배열 전송, id 미전송) */
export function toSceneFormValues(scenes: readonly Scene[]): SceneFormValue[] {
  return [...scenes]
    .sort((a, b) => a.order - b.order)
    .map((scene) => ({
      caption: scene.caption,
      description: scene.description ?? '',
      startSec: scene.startSec === null ? '' : String(scene.startSec),
      endSec: scene.endSec === null ? '' : String(scene.endSec),
    }));
}

/** 서버 Content → 분류 폼 값 (edit 프리필) */
export function toClassifyFormValue(content: Content): ClassifyFormValue {
  return {
    title: content.title,
    description: content.description ?? '',
    category: content.category,
    cultureTopics: content.cultureTopics ?? [],
    hasMinorSubject: content.hasMinorSubject,
  };
}
