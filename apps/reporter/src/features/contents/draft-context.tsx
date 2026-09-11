import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { MutableRefObject, PropsWithChildren } from 'react';
import type { ContentId } from '@gachinol/shared';
import { UploadMode } from './mode';
import { emptyClassifyForm, emptySceneForm } from './validation';
import type { ClassifyFormValue, SceneFormValue } from './validation';

/**
 * 신규 위저드 상태 — 세션 메모리에만 보관 (재시작 시 유실 — open question: 로컬 영속은 업로드 API 단계).
 * order는 배열 인덱스에서 파생 — 별도 필드 없음.
 */
export interface DraftMedia {
  uri: string;
  fileName: string;
  mimeType: string;
  /**
   * 실 업로드(대장 #173)가 전제라 0은 더 이상 무해하지 않다 — 서버 zod가 positive를 요구해
   * upload-url(①)이 400을 낸다. `src/capture/video-capture.ts`의 `assertRealCapturedVideo`가
   * 촬영 경로(카메라)에서 0을 미리 막고, `upload-service.ts`의 `assertRealVideoInput`이
   * 업로드 호출의 최종 관문에서 다시 막는다(갤러리 선택 경로처럼 여기 타입만으로는 강제되지
   * 않는 진입점 포함).
   */
  sizeBytes: number;
  durationSec?: number;
}

interface DraftContextValue {
  media: DraftMedia | null;
  /**
   * 작성 방식 (T-W2-34, 대장 #123) — 자막 단계 **앞**에서 결정된다.
   * 기본값이 `precise`인 것은 fail-safe다: 어떤 이유로든 모드 화면을 거치지 않고 분류에
   * 도달하면 기존(자막 필수) 흐름이 그대로 적용되고, 자막 생략은 **명시적 선택으로만** 일어난다.
   */
  mode: UploadMode;
  scenes: SceneFormValue[];
  classify: ClassifyFormValue;
  /** classify에서 초안 저장 성공 시 설정 — 이탈 확인 스킵 근거 */
  savedContentId: ContentId | null;
  isDirty: boolean;
  /**
   * isDirty의 동기 판독용 미러 — beforeRemove 리스너 전용.
   * markSaved 직후 같은 동기 흐름에서 router.replace가 실행되면 state 커밋 전이라
   * 리스너 클로저의 isDirty가 stale(true)이 된다 → ref는 markSaved가 즉시 false로 갱신.
   */
  isDirtyRef: MutableRefObject<boolean>;
  setMedia(media: DraftMedia | null): void;
  setMode(mode: UploadMode): void;
  setScenes(scenes: SceneFormValue[]): void;
  updateClassify(patch: Partial<ClassifyFormValue>): void;
  markSaved(contentId: ContentId): void;
}

const DraftContext = createContext<DraftContextValue | null>(null);

export function DraftProvider({ children }: PropsWithChildren): React.JSX.Element {
  const [media, setMedia] = useState<DraftMedia | null>(null);
  const [mode, setMode] = useState<UploadMode>(UploadMode.Precise);
  const [scenes, setScenes] = useState<SceneFormValue[]>([emptySceneForm()]);
  const [classify, setClassify] = useState<ClassifyFormValue>(emptyClassifyForm());
  const [savedContentId, setSavedContentId] = useState<ContentId | null>(null);

  const updateClassify = useCallback((patch: Partial<ClassifyFormValue>) => {
    setClassify((prev) => {
      const next = { ...prev, ...patch };
      // culture 이탈 시 topics 자동 클리어 (서버 불변식: 비culture면 cultureTopics 금지)
      if (patch.category !== undefined && patch.category !== 'culture') {
        next.cultureTopics = [];
      }
      return next;
    });
  }, []);

  const isDirtyRef = useRef(false);

  const markSaved = useCallback((contentId: ContentId) => {
    // ref를 먼저 동기 갱신 — setState 커밋 전에 실행되는 beforeRemove가 최신값을 보도록
    isDirtyRef.current = false;
    setSavedContentId(contentId);
  }, []);

  const isDirty = useMemo(() => {
    if (savedContentId) return false;
    return (
      media !== null ||
      classify.title.trim().length > 0 ||
      classify.description.trim().length > 0 ||
      classify.category !== undefined ||
      classify.hasMinorSubject ||
      scenes.some((s) => s.caption.trim() || s.description.trim() || s.startSec || s.endSec)
    );
  }, [media, scenes, classify, savedContentId]);

  // 렌더마다 미러 동기화 (markSaved의 즉시 갱신과 함께 항상 최신 보장)
  isDirtyRef.current = isDirty;

  const value = useMemo<DraftContextValue>(
    () => ({
      media,
      mode,
      scenes,
      classify,
      savedContentId,
      isDirty,
      isDirtyRef,
      setMedia,
      setMode,
      setScenes,
      updateClassify,
      markSaved,
    }),
    [media, mode, scenes, classify, savedContentId, isDirty, updateClassify, markSaved],
  );

  return <DraftContext.Provider value={value}>{children}</DraftContext.Provider>;
}

export function useDraft(): DraftContextValue {
  const ctx = useContext(DraftContext);
  if (!ctx) throw new Error('useDraft는 DraftProvider 안에서만 사용할 수 있습니다');
  return ctx;
}
