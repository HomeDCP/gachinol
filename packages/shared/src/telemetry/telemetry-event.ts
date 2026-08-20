/* ══════════════════════════════════════════════════════════════════════════
 * 계측 이벤트 계약 — 이름 카탈로그 + 송신자가 지켜야 하는 봉투 상한. shared 단일 원천.
 *
 * ★ 왜 shared인가 (T-W2-29, 대장 #128 ⓐ)
 *   T-W1-08이 이 카탈로그를 api 내부(`services/api/src/telemetry/telemetry.service.ts`)에 두었다 —
 *   당시 판단은 "앱과 프로세스 경계를 넘지 않는 REST 계약"이었으나, 실제로는 기자 웹
 *   (`apps/reporter/src/telemetry/`)이 **같은 이름 6개를 문자열 리터럴로 재타이핑**해 쓰고 있었다.
 *   서버는 카탈로그 밖 이름을 400으로 거부하지 않고 **조용히 무시+카운트**하므로(아래 참조),
 *   양쪽 이름이 어긋나도 아무도 실패하지 않고 **관측만 영구 유실**된다. 게다가 앱 테스트가 같은
 *   리터럴을 자기참조로 단언해, "클라와 테스트를 함께 바꾸는 커밋"(= 실제 drift의 형태)은 무검출이었다.
 *   T-W2-25a가 `ResidentUploadStatus`를 같은 이유로 승격한 선례를 따른다 —
 *   **서버 내부에 둔 계약을 앱이 소비하기 시작하면 그것은 공유 계약이다**
 *   (리포 CLAUDE.md §10 "공용 타입은 반드시 packages/shared에").
 *
 * ★ 여기 없는 것 (의도적)
 *   - zod 스키마(`zTelemetryEvent`)·`TelemetryEventBatchDto`: shared는 **런타임 의존성 0**이 규약이라
 *     zod를 들일 수 없다(package.json dependencies 없음). 봉투 파싱은 계속 api 로컬이다.
 *   - `TELEMETRY_MAX_ROLLUP_KEYS`: 서버 인메모리 롤업의 내부 용량이라 송신자가 알 필요가 없다.
 *   - `TELEMETRY_RATE_LIMIT_*`: **IP 단위** 방어 정책이다. 지사 NAT 공유 IP에서는 한 클라이언트가
 *     자기 몫을 계산할 수 없으므로(같은 IP를 몇 명이 쓰는지 클라가 모른다) 공유해도 클라가 옳게
 *     쓸 수 없다. 클라는 "요청 수를 줄인다"(배치)로만 대응하고, 서버 정책값은 서버에 남긴다.
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * 4트랙 이벤트 이름 카탈로그 — 02 §E-16 원문 3트랙(소비·업로드퍼널·모드선택)
 * **+ §E-19 라이브커머스 링크아웃**(T-W2-11·12에서 추가)의 단일 원천.
 *
 * ⚠️ 카탈로그에 있다고 해서 누군가 보내고 있다는 뜻은 아니다(2026-08-21 실측):
 *   - 기자 웹이 실제로 보내는 것: `upload_wizard_step_*`·`upload_start`·`upload_resume`·`upload_complete` 5종
 *   - **구독자 웹**이 보내는 것: `commerce_linkout_click` 1종 — 구독자 앱 **최초의 계측 발신자**다
 *     (그 전까지 `apps/subscriber`에 계측 코드가 0줄이었다 — 대장 #131)
 *   - 아무도 보내지 않는 것: `playback_start`·`playback_progress`·`large_caption_mode_toggle`
 *     (구독자 웹 **소비** 트랙은 여전히 미배선 — 대장 #131의 잔여분, T-W1-07a/Wave 12 소유)
 *   `mode_selected`는 한때 발신이 제거돼 있었다(대장 #123 — 간단 모드가 정밀 모드와 항등이라
 *   존재하지 않는 선택지의 채택률을 재고 있었다). **T-W2-34가 간단 모드를 실제로 구현하면서 재도입했다**
 *   (2026-08-16) — 이제 기자 웹이 다시 보내며 KPI도 의미를 갖는다. payload 값(`'simple'`/`'precise'`)은
 *   여기 계약이 아니라 **api 롤업의 분기와 앱 로컬 상수**가 짝을 이룬다(승격 시 양쪽을 함께 옮길 것).
 */
export const TelemetryEventName = {
  // ① 콘텐츠 소비
  PlaybackStart: 'playback_start',
  PlaybackProgress: 'playback_progress',
  // ② 업로드 퍼널
  WizardStepEnter: 'upload_wizard_step_enter',
  WizardStepExit: 'upload_wizard_step_exit',
  UploadStart: 'upload_start',
  UploadResume: 'upload_resume',
  UploadComplete: 'upload_complete',
  LargeCaptionToggle: 'large_caption_mode_toggle',
  // ③ 모드 선택 (발신 중단 — 위 주석 참고)
  ModeSelected: 'mode_selected',
  /**
   * ④ 라이브커머스 링크아웃 클릭 (T-W2-11·12, 02 §E-19)
   *
   * payload: `{ liveSessionId: string; productCardId: string }`
   * — `TelemetryEventEnvelope.contentId`는 VOD 콘텐츠용이라 라이브 세션을 담지 못해 payload로 보낸다.
   *
   * ⚠️ **이 이벤트는 사용자가 페이지를 떠나는 순간 발생한다** — 일반 `fetch`는 문서 언로드와 함께
   * 취소되어 조용히 유실된다. 송신자는 `navigator.sendBeacon` 또는 `fetch(..., {keepalive:true})`를
   * 써야 한다(구독자 앱 `src/telemetry/send-events.ts`가 그 경로다).
   * 05 §A-1의 2단계 트리거("링크아웃 GMV" / "전환 손실 계측 입증")가 이 수치를 근거로 삼으므로,
   * 유실은 지표 부정확이 아니라 **사업 판단의 근거 상실**이다.
   */
  CommerceLinkoutClick: 'commerce_linkout_click',
} as const;
export type TelemetryEventName = (typeof TelemetryEventName)[keyof typeof TelemetryEventName];

/**
 * 카탈로그 전수 배열 — `Object.values`로 파생하므로 이름 목록 사본이 생기지 않는다
 * (카탈로그에 항목을 추가하면 이 배열도 자동으로 늘어난다). 테스트가 "카탈로그 전 이름이 서버에서
 * known으로 처리되는가"를 전수 검증하는 데 쓴다 — 새 이름을 추가하고 서버 배선을 잊으면 그 테스트가 깨진다.
 */
export const TELEMETRY_EVENT_NAMES: readonly TelemetryEventName[] = Object.values(TelemetryEventName);

const TELEMETRY_EVENT_NAME_SET: ReadonlySet<string> = new Set<string>(TELEMETRY_EVENT_NAMES);

/** 임의 문자열이 카탈로그 이름인지 — 수신측(관용 파싱)이 known/unknown을 가르는 데 쓴다 */
export function isTelemetryEventName(value: unknown): value is TelemetryEventName {
  return typeof value === 'string' && TELEMETRY_EVENT_NAME_SET.has(value);
}

/**
 * `POST /v1/telemetry/events` 배치 상한 — 초과 시 요청 전체 400(구조 위반).
 * **송신자가 지켜야 하는 값이라 공유한다**(어기면 배치 전체가 버려진다 = 조용한 유실이 아니라 확정 유실).
 * env 미도입(고정 상수로 충분한 규모).
 */
export const TELEMETRY_MAX_BATCH_SIZE = 100;

/**
 * 개별 이벤트 payload 직렬화 크기 상한(바이트, UTF-8). 초과 시 요청 전체 400.
 * 위와 같은 이유로 송신자에게도 공유한다. 실제 카탈로그 payload(percent 숫자·enabled 불리언·
 * step 문자열)는 수십 바이트 수준이라 4KB는 충분히 여유롭다. env 미도입.
 */
export const TELEMETRY_MAX_PAYLOAD_BYTES = 4096;

/**
 * **송신자용** 이벤트 봉투 — `name`이 카탈로그로 좁혀져 있어, 카탈로그 밖 문자열을 쓰면 tsc가 거부한다.
 * (수신측은 이 타입을 쓰지 않는다: 서버는 클라이언트 버전 스큐로 들어온 낯선 이름을 파싱 단계에서
 * 거부하면 안 되므로 `name: string`인 관용 타입으로 받고 런타임에 `isTelemetryEventName`으로 가른다.
 * 엄격한 송신 타입 ↔ 관용적인 수신 타입의 비대칭은 의도된 설계다.)
 */
export interface TelemetryEventEnvelope {
  name: TelemetryEventName;
  /** 세션 상관자 — 서버 KPI(위저드 완주율·재개 성공률·자막 활성 비율)는 이 값 없이는 집계 불가 */
  sessionId?: string;
  contentId?: string;
  /** 클라이언트 보고 시각(ISO 8601). 배치 전송은 **큐 적재 시각**을 여기 적어야 한다(전송 시각 아님) */
  occurredAt?: string;
  payload?: Record<string, unknown>;
}

/** `POST /v1/telemetry/events` 응답 — 배치 전체를 거부하지 않고 known/unknown 건수로 알린다 */
export interface TelemetryIngestResult {
  /** 카탈로그에 있는 이벤트로 처리된 건수 */
  accepted: number;
  /** 카탈로그 밖 이름이라 무시된 건수(배치 자체는 거부되지 않음) — 0이 아니면 곧 클라이언트 drift 신호 */
  unknownEventCount: number;
}
