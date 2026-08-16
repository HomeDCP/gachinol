/**
 * 업로드 작성 방식 (T-W2-34 — 대장 #123 · 정본 03 §C-4).
 *
 * ── 왜 이 파일이 생겼는가 ──────────────────────────────────────────────────
 * T-W1-07b에도 "간단 모드"라는 말은 있었지만 **동작이 정밀 모드와 완전히 같았다**. 위저드가
 * `촬영 → 자막 → 분류 → 업로드`인데 모드 선택 UI가 자막 단계 **뒤**에 있었고, 자막 화면이
 * 검증을 통과해야만 다음으로 갈 수 있어(`validateScenes`) 분류 단계에 도달한 시점에는 이미 모든
 * 장면에 자막이 채워져 있었다. 그래서 "빈 caption을 대체한다"던 로직은 **항상 항등함수**였고,
 * T-W1-07b는 그 사실을 인정하고 모드 선택 UI와 `mode_selected` 계측을 함께 제거했다.
 *
 * 이번에는 순서를 바꾼다: `촬영 → **모드 선택** → (정밀만 자막) → 분류 → 업로드`.
 * 모드가 자막 단계 **앞**에 있으므로 간단 모드는 자막 화면을 **아예 거치지 않고** `scenes: []`로
 * 저장된다 — 두 모드가 실제로 다른 결과를 만든다. 자막은 나중에 지사 담당자가 채운다
 * (서버 `PATCH /v1/contents/:id/captions`).
 *
 * ── 값(`'simple'`·`'precise'`)의 출처 ────────────────────────────────────
 * 서버 계측 롤업이 이 두 문자열로 채택률(`simpleAdoptionRate`)을 집계한다
 * (`services/api/src/telemetry/telemetry.service.ts` — `mode==='simple'` / `'precise'` 분기).
 * 이름(`mode_selected`)은 shared 카탈로그(`TelemetryEventName.ModeSelected`)가 원천이지만,
 * **payload 값은 아직 공유 계약이 아니다**(shared는 런타임 의존성 0 규약 아래 이벤트 이름만
 * 승격됐다 — T-W2-29). 값이 어긋나면 서버가 조용히 어느 쪽으로도 세지 않으므로, 여기 상수를
 * 유일 출처로 두고 화면·계측이 전부 이것만 참조한다(리터럴 재타이핑 금지).
 */
export const UploadMode = {
  /** 자막 없이 바로 분류·업로드 — 자막은 사후에 지사 담당자가 채운다 */
  Simple: 'simple',
  /** 장면별 자막·구간을 기자가 직접 기입 (기존 흐름) */
  Precise: 'precise',
} as const;
export type UploadMode = (typeof UploadMode)[keyof typeof UploadMode];

/** 모드 카드 문구 — 2종 전수 satisfies (모드가 늘면 tsc가 잡는다) */
export const UPLOAD_MODE_LABEL = {
  simple: '간단 — 자막 없이 바로 올리기',
  precise: '정밀 — 장면별 자막까지 기입',
} as const satisfies Record<UploadMode, string>;

export const UPLOAD_MODE_DESCRIPTION = {
  simple:
    '촬영하고 제목·분류만 고르면 끝납니다. 자막은 지사 담당자가 나중에 채웁니다 — 자막이 없어도 승인·송출은 그대로 진행됩니다.',
  precise: '장면을 나누고 자막·구간을 직접 기입합니다. 시간이 더 걸리지만 그대로 방송에 나갑니다.',
} as const satisfies Record<UploadMode, string>;
