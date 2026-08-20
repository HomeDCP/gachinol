import { canTransition, nextStates } from '../common/state-machine';
import { CONTENT_STATUS_TRANSITIONS, ContentStatus } from './workflow';

/**
 * ★ 미구동 계약 레지스트리 (NOT_WIRED) — EXEC-DECISIONS #29 1계층.
 *
 * 왜 있는가: 이 리포는 계약(전이맵·enum·JobType)이 구현보다 앞선다. 계약과 구현이 **둘 다 코드**라
 * 서로 구분되지 않고, 다음 작업자가 계약을 "동작하는 기능"의 증거로 읽어 그 위에 UI·문구·설정을
 * 얹는 결함이 반복됐다(배관 공백 22건, 대장 #98~#107). 이 파일은 **"아직 안 만든 것"을 표현하는
 * 자리**다 — 전이맵(`CONTENT_STATUS_TRANSITIONS`)은 "무엇이 합법인가"를, 이 레지스트리는
 * "그중 무엇이 실제로 구동되는가"를 말한다. 전이맵은 이 파일 때문에 바뀌지 않는다.
 *
 * 무엇이 등재되는가: 판정 기준은 "구현됐는가"가 아니라 **"테스트가 밟는가"**다(#29 ③).
 * api 단위 스위트 실행 중 `ContentWorkflowService.applyHop`(콘텐츠 전이의 단일 관문)을 통과한
 * 엣지를 런타임 계측이 수집하고, `전이맵 전체 − 관측된 엣지`가 이 목록과 **양방향 정확 일치**해야
 * 한다(불일치 시 api 스위트가 레드). 그래서 목록은 stale될 수 없다:
 *   · 미관측인데 등재 안 됨 → 레드("구현했으면 테스트를 쓰고, 안 했으면 등재하라")
 *   · 등재됐는데 관측됨     → 레드("구현됐으니 목록에서 빼라")
 * 정적 grep으로 대체할 수 없다 — 전이 실행 인자 대부분이 변수다(#29 ②).
 *
 * 두 종류를 담는다(`kind`) — 판정 기준이 "테스트가 밟는가"라서 필연이다:
 *   · `unimplemented` — 그 엣지를 실행하는 프로덕션 코드가 **없다**. 사용자에게 보이는 판정
 *     (UI 자동 진행 여부 등)은 **이쪽만** 파생 대상이다.
 *   · `untested`      — 실행 코드는 있으나 api **단위** 스위트가 밟지 않는다(e2e 전용 경로 등).
 *     구동되므로 UI 판정에 영향을 주지 않는다. 드러나 있는 것 자체가 이득이다.
 *
 * 한계(무설명 승격 금지): 이 축은 **열거 가능한 계약**(전이 엣지)에만 걸린다. "이 함수가 실제로
 * 호출되는가" 같은 일반 문제는 여전히 사람 조사 몫이다(#29 ⑥).
 *
 * ★ 한계 ② — **stale될 수 없는 것은 멤버십뿐이다** (대장 #125에서 실증, T-W2-27에서 명시):
 * 위 "목록은 stale될 수 없다"가 보증하는 범위는 **어떤 엣지가 등재돼 있는가**까지다. 각 항목의
 * `reason`(사람이 쓴 사유 문구)은 아무것도 검증하지 않는다 — `not-wired.spec.ts`가 보는 것은
 * `kind`가 열거값인지와 사유 길이가 10자를 넘는지뿐이다.
 * 실제 사례: `published→archived`의 사유가 인용한 사실("api src 전체에 문자열 archived 참조 0건")은
 * T-W2-10이 `content-workflow.service.ts`에 보관 후 훅을 추가하면서 **거짓이 됐는데도**, 멤버십 판정은
 * 여전히 정확해서(전용 구동부는 지금도 없다) 스위트는 계속 그린이었다 — 자동 검증이 구조적으로
 * 잡을 수 없는 종류의 결함이다.
 * 따라서 사람 몫으로 남는 두 가지: ① 사유에 **검증 가능한 사실**("참조 0건", "파일:줄 번호")을
 * 인용할수록 stale 위험이 커진다 — 인용하려면 그 사실이 지금도 참인지 확인한 뒤 적는다.
 * ② 코드를 고칠 때는 그 코드를 인용하고 있는 사유가 있는지 함께 훑는다(정정을 코드에만 반영하고
 * 그것을 설명하는 문구를 안 고치는 것이 이 리포의 반복 결함이다).
 */

export const NotWiredKind = {
  /** 이 엣지를 실행하는 프로덕션 코드가 없다 — UI 판정 파생 대상 */
  Unimplemented: 'unimplemented',
  /** 실행 코드는 있으나 api 단위 스위트가 밟지 않는다 — UI 판정에 영향 없음 */
  Untested: 'untested',
} as const;
export type NotWiredKind = (typeof NotWiredKind)[keyof typeof NotWiredKind];

export interface NotWiredContentTransition {
  readonly from: ContentStatus;
  readonly to: ContentStatus;
  readonly kind: NotWiredKind;
  /** 사람이 읽는 사유 — 대장/EXEC 번호를 인용한다 */
  readonly reason: string;
}

/**
 * 등재 전문 — **계측 결과를 그대로 옮긴 것**이다(임의 판단으로 넣거나 뺀 항목 0).
 * 멤버십은 계측이 정하고, `kind`·`reason`만 사람이 근거와 함께 적는다.
 * 초기 등재(2026-08-16): 전이맵 47엣지 중 관측 21 · 미관측 26.
 *
 * 갱신 이력(계측이 시킨 것만 적는다 — 사람이 임의로 넣고 뺀 항목은 0이어야 한다):
 *  · T-W2-24(2026-08-16): `processing→analyzing` **삭제**. 주민 업로드 검수 게이트를
 *    `ContentWorkflowService.applyHop`에 배선하면서 "게이트는 파이프라인 진입 문턱에서만 묻는다"를
 *    고정하는 단위 테스트(content-workflow.service.spec.ts)가 이 엣지를 실 applyHop으로 밟게 됐다.
 *    구동부(PipelineService.onCompleted(transcode))는 원래 실재했고 `untested`였을 뿐이라 이 삭제는
 *    "구현이 늘었다"가 아니라 "단위 커버리지가 생겼다"는 뜻이다(관측 21→22 · 등재 26→25).
 *  · T-W2-31(2026-08-16): `uploaded→canceled` **삭제**. 주민 업로드 검수 반려가 연결된 Content를
 *    종결시키도록 배선하면서(대장 #112, `ResidentReviewsService.reject` →
 *    `ContentWorkflowService.cancelBySystem`) 그 반려 스위트가 이 엣지를 실 applyHop으로 밟게 됐다.
 *    ★ 앞 항목과 성격이 다르다: 이건 "구현이 늘었다"이다. 舊 사유는 이 엣지의 구동부를 `cancel()`
 *    이라고 적었는데 **거짓이었다** — 이 엣지에 도달하는 `uploaded` 콘텐츠의 실사용 원천은
 *    `origin='resident_link'`(무주, `reporterId=null`)이고, `cancel()`은 소유 기자 또는 센터 액터를
 *    요구해 그 콘텐츠에는 애초에 적용될 수 없었다. 즉 12건을 한 문장으로 묶어 쓴 사유가 이 한 건에
 *    대해서는 틀렸고, 멤버십 판정만 정확했다(헤더 "한계 ②"의 사례가 하나 더 늘었다).
 *    (관측 22→23 · 등재 25→24).
 *  · auto_edit Phase 1(2026-08-20): `regenerating→{analyzing, preview_generating, regeneration_failed}`
 *    **3건 삭제**. 대장 #98이 닫혔다 — 구동부는 media-worker `processors/auto-edit.ts`(기계편집:
 *    음량 정규화·렌디션·faststart, **AI 호출 0회**) + api `enqueueAutoEdit` +
 *    `PipelineService.onCompleted('auto_edit')`이며, `content-workflow.service.spec.ts`의
 *    "재생성 루프" 스위트가 3엣지를 실 applyHop으로 밟는다.
 *    진입 엣지 `revision_requested→regenerating`은 원래 목록 밖이었으나(범용 수동 전이로 관측)
 *    이제 전용 구동부 `ContentWorkflowService.regenerate()`가 생겼다 — 멤버십 변화는 없다.
 *    ⇒ `STALLED_AUTOMATION_CONTENT_STATUSES`가 **빈 배열**이 되어 3앱의 "정지 상태" 경고 톤이
 *    자동으로 사라진다(#29 ④가 예고한 대로 사람이 되돌릴 것을 기억할 필요가 없다).
 *
 * 재산출: `GACHINOL_WIRING_REPORT=1 pnpm --filter @gachinol/api test`
 * (services/api/test/wiring/global-teardown.ts가 관측·미관측 전문을 출력한다).
 *
 * ── `kind` 판정 규칙(일관 적용) ────────────────────────────────────────
 * **범용 수동 전이(`POST /v1/contents/:id/transitions`)는 "구동"으로 세지 않는다.**
 * 그 엔드포인트는 전이맵상 합법인 모든 엣지를 실행할 수 있어서(워커 부재기 운영 복구용 탈출구),
 * 그것을 구현으로 세면 47엣지 전부가 자동으로 "구현됨"이 되어 이 레지스트리가 공허해진다.
 * 따라서 `untested`는 **그 엣지를 위한 전용 코드 경로**(제품 액션·워커 이벤트 핸들러)가 실재할 때만
 * 붙이고, 그 경로가 없으면 `unimplemented`다.
 *
 * ── 알려진 한계 ────────────────────────────────────────────────────────
 * 멤버십이 계측이라, 단위 스위트가 **범용 수동 전이로** 밟은 엣지는 전용 구동부가 없어도 등재되지
 * 않는다(예: `revision_requested→regenerating`은 관측돼 목록 밖이지만 전용 구동부는 없다 —
 * 관제 앱이 바로 그 범용 전이를 탈출구로 노출한다, 대장 #98). 이 축은 "테스트가 밟는가"를 재는
 * 도구이고 "제품 기능이 있는가"를 완벽히 재지는 못한다.
 */
export const NOT_WIRED_CONTENT_TRANSITIONS: readonly NotWiredContentTransition[] = [
  // ── unimplemented — 이 엣지를 실행하는 전용 코드가 없다 (UI 판정 파생 대상) ──
  {
    from: 'analysis_failed',
    to: 'preview_generating',
    kind: NotWiredKind.Unimplemented,
    reason:
      '"분석 생략 진행"(전이맵 주석의 센터 판단 경로)의 전용 구동부가 없다 — api 전체에서 이 엣지를 지정해 실행하는 코드 0건. retry()는 analysis_failed→analyzing만 간다(CONTENT_RETRY_TARGET). 범용 수동 전이가 유일 경로.',
  },
  {
    from: 'published',
    to: 'archived',
    kind: NotWiredKind.Unimplemented,
    reason:
      '보관(archive) **전용 서버 구동부**가 없다 — 이 엣지를 지정해 실행하는 전용 엔드포인트·스케줄러·워커가 0건이고, 범용 수동 전이(POST /v1/contents/:id/transitions)가 유일 경로다(레지스트리 규칙상 범용 수동 전이는 구동으로 세지 않는다 — `revision_requested→regenerating`도 같은 취급). api src에 archived 문자열은 있으나(content-workflow.service.ts transition()의 `to === "archived"` 분기 = T-W2-10의 공개 객체 제거 훅) 그것은 도달 **후** 부작용이지 전이를 일으키는 곳이 아니다. **관제 앱에는 T-W2-32(대장 #124)로 보관 버튼이 생겼다** — 그 버튼이 부르는 것도 범용 수동 전이라 멤버십은 그대로다. (사유 문구가 stale해진 것이 이번이 **두 번째**다: 舊①"api src 전체에 참조 0건"→T-W2-10이 반증(대장 #125), 舊②"제품 액션 0건"→T-W2-32가 반증. 멤버십 판정은 두 번 다 정확했다 — 헤더 "한계 ②" 참조. **사유에 "0건"류 전수 주장을 쓰면 반드시 stale된다**: 검증 불가능한 형태를 피하고 판정 근거만 적을 것.)',
  },

  // ── untested — 전용 구동부는 실재하나 api 단위 스위트가 밟지 않는다 ──
  // 취소 11건: ContentsController `POST /:id/cancel` → ContentWorkflowService.cancel().
  // from을 하드코딩하지 않고 전이맵이 판정하므로 코드는 단일하고, 상태별 커버리지만 없다.
  // (`uploaded→canceled`는 T-W2-31에서 빠졌다 — 아래 갱신 이력 참조. 그 엣지의 구동부는 cancel()이
  //  아니라 주민 업로드 반려 연쇄이며, 무주 콘텐츠라 cancel()로는 애초에 도달할 수 없었다.)
  {
    from: 'draft',
    to: 'canceled',
    kind: NotWiredKind.Untested,
    reason: 'cancel() 실재(POST /v1/contents/:id/cancel) — 이 from 상태를 밟는 단위 테스트만 없다.',
  },
  {
    from: 'upload_failed',
    to: 'canceled',
    kind: NotWiredKind.Untested,
    reason: 'cancel() 실재 — 이 from 상태를 밟는 단위 테스트만 없다.',
  },
  {
    from: 'processing',
    to: 'canceled',
    kind: NotWiredKind.Untested,
    reason: 'cancel() 실재 — 이 from 상태를 밟는 단위 테스트만 없다.',
  },
  {
    from: 'processing_failed',
    to: 'canceled',
    kind: NotWiredKind.Untested,
    reason: 'cancel() 실재 — 이 from 상태를 밟는 단위 테스트만 없다.',
  },
  {
    from: 'analyzing',
    to: 'canceled',
    kind: NotWiredKind.Untested,
    reason: 'cancel() 실재 — 이 from 상태를 밟는 단위 테스트만 없다.',
  },
  {
    from: 'analysis_failed',
    to: 'canceled',
    kind: NotWiredKind.Untested,
    reason: 'cancel() 실재 — 이 from 상태를 밟는 단위 테스트만 없다.',
  },
  {
    from: 'preview_failed',
    to: 'canceled',
    kind: NotWiredKind.Untested,
    reason: 'cancel() 실재 — 이 from 상태를 밟는 단위 테스트만 없다.',
  },
  {
    from: 'awaiting_reporter_review',
    to: 'canceled',
    kind: NotWiredKind.Untested,
    reason: 'cancel() 실재 — 이 from 상태를 밟는 단위 테스트만 없다.',
  },
  {
    from: 'revision_requested',
    to: 'canceled',
    kind: NotWiredKind.Untested,
    reason: 'cancel() 실재 — 이 from 상태를 밟는 단위 테스트만 없다.',
  },
  {
    from: 'regeneration_failed',
    to: 'canceled',
    kind: NotWiredKind.Untested,
    reason: 'cancel() 실재 — 이 from 상태를 밟는 단위 테스트만 없다.',
  },
  {
    from: 'publish_failed',
    to: 'canceled',
    kind: NotWiredKind.Untested,
    reason: 'cancel() 실재 — 이 from 상태를 밟는 단위 테스트만 없다.',
  },
  // 파이프라인 시스템 전이 5건: PipelineService가 실 큐 이벤트로 구동한다. 단위 스위트의
  // pipeline.service.spec.ts는 ContentWorkflowService를 목으로 대체해 applyHop까지 닿지 않고,
  // 실제 완주는 e2e(media/analysis/distribution-pipeline)가 담당한다 → 단위 관측 0.
  // (`processing→analyzing`은 T-W2-24에서 빠졌다 — 아래 갱신 이력 참조)
  {
    from: 'processing',
    to: 'preview_generating',
    kind: NotWiredKind.Untested,
    reason:
      '긴급(urgent)·AI 비활성 패스트트랙 실재(pipeline.service.ts:300) — 단위 미커버, media-pipeline e2e가 실증.',
  },
  {
    from: 'analyzing',
    to: 'preview_generating',
    kind: NotWiredKind.Untested,
    reason:
      'PipelineService.onAnalysisCompleted 실재(pipeline.service.ts:392) — 단위 미커버, analysis-pipeline e2e가 실증.',
  },
  {
    from: 'analyzing',
    to: 'analysis_failed',
    kind: NotWiredKind.Untested,
    reason: 'PipelineService.onAnalysisFailed 실재(pipeline.service.ts:418) — 단위 미커버.',
  },
  {
    from: 'preview_generating',
    to: 'preview_failed',
    kind: NotWiredKind.Untested,
    reason: 'PipelineService.onFailed(preview) 실재(pipeline.service.ts:356) — 단위 미커버.',
  },
  {
    from: 'publishing',
    to: 'publish_failed',
    kind: NotWiredKind.Untested,
    reason:
      'PipelineService.onPublishCompleted(일부 채널 실패)·onPublishFailed(잡 소진) 실재(pipeline.service.ts:461·492) — 단위 미커버, distribution-pipeline e2e가 실증.',
  },
  // 기자/센터 검토 결정 3건: 전용 엔드포인트 실재, from=awaiting_center_review 쪽만 단위 커버돼 있다.
  {
    from: 'awaiting_reporter_review',
    to: 'revision_requested',
    kind: NotWiredKind.Untested,
    reason:
      'requestRevision() 실재(POST /v1/contents/:id/request-revision) — 단위 스위트는 from=awaiting_center_review만 밟는다.',
  },
  {
    from: 'awaiting_reporter_review',
    to: 'rejected',
    kind: NotWiredKind.Untested,
    reason: 'reject() 실재(POST /v1/contents/:id/reject) — 이 from 상태를 밟는 단위 테스트만 없다.',
  },
  {
    from: 'awaiting_center_review',
    to: 'rejected',
    kind: NotWiredKind.Untested,
    reason: 'reject() 실재 — 이 from 상태를 밟는 단위 테스트만 없다.',
  },
];

/**
 * 미구동 계약 레지스트리 — 소비자 진입점.
 * 지금은 콘텐츠 전이만 담는다. enum 값·JobType 등으로 넓힐 때 여기에 키를 더한다.
 */
export const NOT_WIRED = {
  /** 엣지 튜플 목록 (집합 연산용) */
  contentTransitions: NOT_WIRED_CONTENT_TRANSITIONS.map(
    (e) => [e.from, e.to] as readonly [ContentStatus, ContentStatus],
  ),
  /** 항목별 사유·종류 */
  contentTransitionEntries: NOT_WIRED_CONTENT_TRANSITIONS,
} as const satisfies {
  contentTransitions: readonly (readonly [ContentStatus, ContentStatus])[];
  contentTransitionEntries: readonly NotWiredContentTransition[];
};

/** 계측·대조·에러 메시지가 공유하는 엣지 키 (유일 표기 — 사본 금지) */
export const contentTransitionKey = (from: ContentStatus, to: ContentStatus): string =>
  `${from}→${to}`;

const notWiredKeys = new Set(NOT_WIRED_CONTENT_TRANSITIONS.map((e) => contentTransitionKey(e.from, e.to)));

const unimplementedKeys = new Set(
  NOT_WIRED_CONTENT_TRANSITIONS.filter((e) => e.kind === NotWiredKind.Unimplemented).map((e) =>
    contentTransitionKey(e.from, e.to),
  ),
);

/** 전이맵 전체 엣지 (선언 순서 보존) */
export const allContentTransitionEdges = (): readonly (readonly [ContentStatus, ContentStatus])[] =>
  (Object.keys(CONTENT_STATUS_TRANSITIONS) as ContentStatus[]).flatMap((from) =>
    nextStates(CONTENT_STATUS_TRANSITIONS, from).map(
      (to) => [from, to] as readonly [ContentStatus, ContentStatus],
    ),
  );

/** 합법이면서 구동되는(=테스트가 밟는) 엣지인가 */
export const isContentTransitionWired = (from: ContentStatus, to: ContentStatus): boolean =>
  canTransition(CONTENT_STATUS_TRANSITIONS, from, to) && !notWiredKeys.has(contentTransitionKey(from, to));

/**
 * 합법이면서 **구현된** 엣지인가 — `untested`는 구현된 것으로 센다.
 * 사용자에게 보이는 판정(UI)은 이 술어에서 파생한다(미검증은 실제로 동작하므로 UI를 바꾸면 안 된다).
 */
export const isContentTransitionImplemented = (from: ContentStatus, to: ContentStatus): boolean =>
  canTransition(CONTENT_STATUS_TRANSITIONS, from, to) &&
  !unimplementedKeys.has(contentTransitionKey(from, to));

/** 현재 상태에서 실제로 구현된 출구 목록 */
export const implementedNextStates = (from: ContentStatus): readonly ContentStatus[] =>
  nextStates(CONTENT_STATUS_TRANSITIONS, from).filter((to) =>
    isContentTransitionImplemented(from, to),
  );

/** 나가는 길이 하나라도 구현돼 있는가 — false면 그 상태는 "정지 상태"다 */
export const hasImplementedContentExit = (s: ContentStatus): boolean =>
  implementedNextStates(s).length > 0;

/**
 * 시스템 자동 진행 **후보** — "사람 입력 없이 서버·워커·자동 연쇄가 다음 상태로 옮기기로 되어 있는" 상태.
 * 이건 제품 지식이라 사람이 쓴다. **실제로 자동 진행하는지는 NOT_WIRED가 판정**한다(아래 파생).
 *
 * 후보 근거(전이맵 실측):
 *  · uploading→uploaded/upload_failed          — 업로드 완료 검증(UploadService)
 *  · uploaded→processing, processing→*         — media-worker 잡 이벤트(PipelineService)
 *  · analyzing→preview_generating              — 인프로세스 Analysis 워커
 *  · preview_generating→awaiting_*_review      — media-worker 프리뷰 완료
 *  · reporter_approved→*                       — 같은 트랜잭션 자동 연쇄(afterReporterApproval)
 *  · regenerating→*                            — auto_edit 워커 (대장 #98: 미구현)
 *  · publishing→published/publish_failed       — 인프로세스 송출 워커
 * 여기 없는 상태(draft·center_approved·실패 6종·검토 대기 2종·종결 3종)는 사람이 다음 홉을 지시한다.
 */
export const SYSTEM_DRIVEN_CONTENT_STATUSES: readonly ContentStatus[] = [
  ContentStatus.Uploading,
  ContentStatus.Uploaded,
  ContentStatus.Processing,
  ContentStatus.Analyzing,
  ContentStatus.PreviewGenerating,
  ContentStatus.ReporterApproved,
  ContentStatus.Regenerating,
  ContentStatus.Publishing,
];

/**
 * ★ 자동 진행 상태 — 후보 중 **구현된 출구가 하나라도 있는** 것만.
 * 클라이언트의 폴링·"진행 중" 표기 판정의 유일 원천. `regenerating`이 빠지는 이유는 여기에
 * 하드코딩돼 있지 않다 — auto_edit 엣지들이 NOT_WIRED에 등재돼 있어 파생 결과로 빠진다.
 * auto_edit 구현으로 그 엣지들이 목록에서 빠지는 순간 UI가 자동으로 따라온다(#29 ④).
 */
export const AUTO_PROGRESS_CONTENT_STATUSES: readonly ContentStatus[] =
  SYSTEM_DRIVEN_CONTENT_STATUSES.filter(hasImplementedContentExit);

export const isAutoProgressContentStatus = (s: ContentStatus): boolean =>
  AUTO_PROGRESS_CONTENT_STATUSES.includes(s);

/**
 * ★ 정지 상태 — 자동 진행하기로 되어 있는데 **구동부가 없어 멈춘** 상태.
 * `SYSTEM_DRIVEN_CONTENT_STATUSES`의 여집합 분할이라 "자동 진행"과 "정지"는 서로 배타·전수다.
 *
 * 종결 상태(rejected·canceled·archived)나 `published`처럼 원래 사람이 다음 홉을 지시하는 상태는
 * 후보가 아니라 여기 들어오지 않는다 — "출구가 없다"와 "멈췄다"는 다르다.
 *
 * 현재: **비어 있다**(2026-08-20, auto_edit Phase 1). 마지막 항목이던 `regenerating`은 대장 #98이
 * 닫히면서 빠졌다 — 예고대로 UI 판정(경고 톤·조치 필요)이 사람 손 없이 자동으로 사라졌다(#29 ④).
 * 다시 채워지는 경우는 "자동 진행하기로 한 상태의 구동부를 만들지 않은 채 계약만 넣었을 때"뿐이며,
 * 그때 이 집합이 비지 않는 것 자체가 경보다.
 */
export const STALLED_AUTOMATION_CONTENT_STATUSES: readonly ContentStatus[] =
  SYSTEM_DRIVEN_CONTENT_STATUSES.filter((s) => !hasImplementedContentExit(s));

export const isStalledAutomationContentStatus = (s: ContentStatus): boolean =>
  STALLED_AUTOMATION_CONTENT_STATUSES.includes(s);

// ── 양방향 대조 (검증 하네스가 소비) ────────────────────────────────────

export interface WiringReconcileReport {
  /** 전이맵에 있으나 테스트가 밟지 않은 엣지 */
  readonly unobserved: readonly string[];
  /** 미관측인데 NOT_WIRED에 없음 → 레드 */
  readonly missingFromRegistry: readonly string[];
  /** NOT_WIRED에 있는데 관측됨 → 레드 */
  readonly staleInRegistry: readonly string[];
  /** NOT_WIRED에 있는데 전이맵에 없는 엣지 → 레드 */
  readonly unknownInRegistry: readonly string[];
  /** 관측됐으나 전이맵에 없는 엣지(계측 이상) → 레드 */
  readonly illegalObserved: readonly string[];
  readonly ok: boolean;
}

/**
 * 미관측 집합 == NOT_WIRED 양방향 정확 일치 판정 — 판정 규칙의 유일 원천.
 * @param observed 계측이 수집한 엣지 키 집합(`contentTransitionKey` 표기)
 */
export const reconcileContentWiring = (observed: Iterable<string>): WiringReconcileReport => {
  const observedSet = new Set(observed);
  const legal = new Set(allContentTransitionEdges().map(([from, to]) => contentTransitionKey(from, to)));

  const unobserved = [...legal].filter((k) => !observedSet.has(k));
  const missingFromRegistry = unobserved.filter((k) => !notWiredKeys.has(k));
  const staleInRegistry = [...notWiredKeys].filter((k) => observedSet.has(k));
  const unknownInRegistry = [...notWiredKeys].filter((k) => !legal.has(k));
  const illegalObserved = [...observedSet].filter((k) => !legal.has(k));

  return {
    unobserved,
    missingFromRegistry,
    staleInRegistry,
    unknownInRegistry,
    illegalObserved,
    ok:
      missingFromRegistry.length === 0 &&
      staleInRegistry.length === 0 &&
      unknownInRegistry.length === 0 &&
      illegalObserved.length === 0,
  };
};
