import {
  TELEMETRY_MAX_PAYLOAD_BYTES,
  TELEMETRY_MAX_BATCH_SIZE,
  TelemetryEventName,
  type TelemetryIngestResult,
} from '@gachinol/shared';
import { Injectable, Logger } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/* ══════════════════════════════════════════════════════════════════════════
 * 콘텐츠 소비 + 업로드 퍼널 계측 집계 (T-W1-08, 02 §E-16 서버분 · 03 KPI 3행의 유일한 측정 원천)
 *
 * ── 저장 매체 (조율자 확정 설계 제약) ────────────────────────────────────────
 * 구조화 로그(이 파일의 Logger 호출 — 이벤트 1건당 1줄 JSON) + 인메모리 롤업(이 클래스의 카운터·Set·Map).
 * Prisma 마이그레이션·Redis·`packages/shared` 전부 무변경. 계측은 KPI 관측용이라 유실 허용 등급이고,
 * 프로세스 재시작 시 롤업이 소실되는 것도 허용한다(구조화 로그가 durable 원천, 롤업은 빠른 조회 캐시).
 *
 * ── 이벤트 이름 카탈로그·봉투 상한의 위치: `@gachinol/shared` (T-W2-29, 대장 #128 ⓐ) ──────────
 * T-W1-08은 카탈로그를 이 파일에 두었다("앱과 프로세스 경계를 넘지 않는 REST 계약"이라는 판단).
 * 그러나 기자 웹이 같은 이름을 리터럴로 재타이핑해 소비하고 있었고, 서버가 카탈로그 밖 이름을
 * 조용히 무시하므로(아래) 이름이 어긋나면 아무도 실패하지 않고 관측만 유실됐다 →
 * `TelemetryEventName`·`TELEMETRY_MAX_BATCH_SIZE`·`TELEMETRY_MAX_PAYLOAD_BYTES`·`TelemetryIngestResult`는
 * **shared가 단일 원천**이고 이 파일은 소비만 한다(사본 금지). zod 스키마·DTO는 여전히 api 로컬이다 —
 * shared는 런타임 의존성 0이 규약이라 zod를 들일 수 없다.
 *
 * ── 미지의 이벤트 이름 처리: 무시 + 카운트 (400 거절 아님) ───────────────────
 * 봉투(이름·sessionId·contentId·occurredAt·payload)는 zod가 구조적으로 강제하되, `name`이 알려진
 * 카탈로그 밖이어도 배치 전체를 거부하지 않는다 — 계측은 "유실 허용 등급"이므로, 클라이언트 버전 스큐로
 * 낯선 이벤트 1건이 섞였다고 나머지 정상 이벤트까지 함께 버릴 이유가 없다. 대신 `unknownEventCount`로
 * 관측 가능하게 남긴다(무기록 실패 금지). 반대로 배치 크기 초과·봉투 형태 위반(예: name 누락)은 zod가
 * 요청 전체를 400(validation_failed)으로 거부한다 — 이건 클라이언트 버그 신호라 조용히 삼키면 안 된다.
 * ══════════════════════════════════════════════════════════════════════════ */

/*
 * `TelemetryEventName`(카탈로그)·`TELEMETRY_MAX_BATCH_SIZE`·`TELEMETRY_MAX_PAYLOAD_BYTES`는
 * `@gachinol/shared`(packages/shared/src/telemetry/telemetry-event.ts)가 단일 원천이다 —
 * 위 헤더 주석 참고. 여기서 재수출하지 않는다(소비처가 shared를 직접 import해야 사본이 안 생긴다).
 *
 * `TELEMETRY_MAX_PAYLOAD_BYTES`의 유래(대장 #79 조치②): `payload: z.record(...)`가 임의 키-값을
 * 허용해 배치 각 이벤트마다 거대한 payload를 실을 수 있던 취약점을 막는다. 초과 시 zod가 배치 전체를
 * 400(validation_failed)으로 거부한다 — 구조 위반이라 "미지의 이벤트 이름은 무시" 정책과 달리
 * 조용히 삼키지 않는다.
 */

/** UTF-8 직렬화 바이트 기준(문자 길이 아님) — 이모지·한글 등 멀티바이트 페이로드를 과소평가하지 않는다 */
const zTelemetryPayload = z
  .record(z.string(), z.unknown())
  .refine((payload) => Buffer.byteLength(JSON.stringify(payload), 'utf8') <= TELEMETRY_MAX_PAYLOAD_BYTES, {
    message: `payload는 직렬화 시 최대 ${TELEMETRY_MAX_PAYLOAD_BYTES}바이트까지 허용됩니다`,
  });

/**
 * 이벤트 봉투 — `name`만 구조적으로 강제하고, 트랙별 세부 필드는 느슨한 `payload` 레코드에 싣는다.
 * (이름별로 형태가 다른 discriminated union을 쓰면 낯선 이름 자체가 파싱 단계에서 배치 전체를
 * 400시킨다 — 위 "미지의 이벤트 이름 처리" 결정과 충돌하므로 의도적으로 피한다.)
 *
 * `contentId`는 브랜디드 UUID(`zId<ContentId>`)로 강제하지 않는다 — 익명 구독자 클라이언트가 보내는
 * 계측 신호를 형식 오류로 배치째 버리지 않기 위한 의도적 완화(위와 동일한 유실 허용 철학).
 */
export const zTelemetryEvent = z.object({
  name: z.string().min(1).max(64),
  sessionId: z.string().min(1).max(128).optional(),
  contentId: z.string().min(1).max(128).optional(),
  /** 클라이언트 보고 시각(ISO 8601) — 구조화 로그 상관용, 집계 로직은 수신 순서만 사용(아래 참조) */
  occurredAt: z.string().datetime().optional(),
  payload: zTelemetryPayload.optional(),
});
export type TelemetryEventInput = z.infer<typeof zTelemetryEvent>;

/** `POST /v1/telemetry/events` 바디 — 배열 그 자체(래핑 객체 아님), 배치 수신 */
export const zTelemetryEventBatch = z
  .array(zTelemetryEvent)
  .min(1, '이벤트가 최소 1건 필요합니다')
  .max(TELEMETRY_MAX_BATCH_SIZE, `배치는 최대 ${TELEMETRY_MAX_BATCH_SIZE}건까지 허용됩니다`);

export class TelemetryEventBatchDto extends createZodDto(zTelemetryEventBatch) {}

const PROGRESS_MILESTONES = [25, 50, 75, 100] as const;
type ProgressMilestone = (typeof PROGRESS_MILESTONES)[number];
const PROGRESS_MILESTONE_KEY: Record<ProgressMilestone, 'p25' | 'p50' | 'p75' | 'p100'> = {
  25: 'p25',
  50: 'p50',
  75: 'p75',
  100: 'p100',
};

export interface TelemetrySummary {
  generatedAt: string;
  totalEventsReceived: number;
  unknownEventCount: number;
  consumption: {
    playbackStartCount: number;
    progressMilestoneCounts: Record<'p25' | 'p50' | 'p75' | 'p100', number>;
    /** "조회 집계" — contentId별 playback_start 수신 건수 */
    viewCountsByContent: Record<string, number>;
  };
  uploadFunnel: {
    wizardStepEnterCount: number;
    wizardStepExitCount: number;
    uploadStartCount: number;
    uploadResumeCount: number;
    uploadCompleteCount: number;
    /**
     * KPI "업로드 위저드 완주율" — (위저드 진입 세션 ∩ 업로드 완료 세션) / 위저드 진입 세션.
     * `sessionId` 미첨부 이벤트는 상관(correlate)할 수 없어 분모·분자 모두에서 제외한다
     * (세션 없이 완료 건수만으로 분자를 부풀리면 과대추정된다). 진입 세션 0건이면 null(관측 없음).
     */
    wizardCompletionRate: number | null;
    /** KPI "업로드 중단 후 재개 성공률" — (재개 세션 ∩ 완료 세션) / 재개 세션. 재개 세션 0건이면 null */
    resumeSuccessRate: number | null;
  };
  largeCaptionMode: {
    toggleOnEventCount: number;
    toggleOffEventCount: number;
    /**
     * KPI "큰 자막 모드 활성 비율" — 세션별 "가장 최근에 관측된 토글 상태"가 ON인 세션의 비율
     * (수신 순서 기준 최종 상태 — `occurredAt` 정렬은 하지 않는다, 단일 프로세스 인메모리 롤업이라
     * 수신 순서가 곧 관측 순서). 분모는 **`sessionId`가 있는 이벤트로 상관된 세션만**(아래
     * `anonymousToggleObservedCount` 참고 — 대장 #79 조치① 이후 익명 이벤트는 제외). 관측된 세션이
     * 0건이면 null.
     */
    activeRatio: number | null;
    /**
     * 대장 #79 조치① — `sessionId` 없는(상관 불가) 토글 이벤트 수. `__anon_${counter++}`로 매번
     * 새 세션 키를 발급해 세션 Map이 요청마다 무한 증가하던 취약점을 막기 위해, 익명 토글은 세션 Map에
     * 넣지 않고 이 스칼라 카운터로만 집계한다. `toggleOnEventCount`/`toggleOffEventCount`(원시 총계)
     * 에는 여전히 포함되지만 `activeRatio`(세션 기반 비율) 분모·분자에서는 제외된다 — 세션 상관이
     * 불가능한 관측을 세션인 것처럼 비율에 섞으면 부정확해지므로, 정확도를 위해 의도적으로 분리한다.
     */
    anonymousToggleObservedCount: number;
  };
  modeSelection: {
    simpleCount: number;
    preciseCount: number;
    /** 01 §C-7 간단 모드 채택률 실측 — simple / (simple + precise). 관측 0건이면 null */
    simpleAdoptionRate: number | null;
  };
  /**
   * 대장 #79 조치② — 세션 Set/Map·contentId Map 각각의 "상한 도달로 신규 키를 드롭한 횟수".
   * 0이면 관측이 완전하다(상한에 부딪히지 않음). 0보다 크면 해당 카테고리의 세션/콘텐츠 다양성이
   * `TELEMETRY_MAX_ROLLUP_KEYS`를 넘어섰다는 뜻이며, 그 카테고리의 세션 기반 KPI(완주율·재개
   * 성공률·자막 활성 비율)가 실제보다 과소추정될 수 있다는 신호다(과대추정은 없음 — 드롭된 세션은
   * 분자·분모 어디에도 들어가지 않는다). 원시 총계(카운터)는 상한과 무관하게 항상 정확하다.
   */
  /**
   * ④ 라이브커머스 링크아웃 (T-W2-12, 02 §E-19 서버분).
   *
   * ⚠️ **이것이 05 §A-1 2단계 트리거의 유일한 자체 측정치다.** 트리거는 "링크아웃 GMV 월 300만원
   * 3개월 연속" 또는 "전환 손실 계측 입증"인데, 우리는 거래 비당사자라 **GMV도 구매 완주도 볼 수 없다**
   * — 판매자가 외부 채널 실적을 알려줘야 그 절반이 채워진다. 여기서 나오는 클릭 수는 그 대조군이며,
   * 클릭 대비 실적이 판정의 재료다. 그래서 유실이 곧 판단 근거 상실이다(shared 카탈로그 주석 참조).
   */
  commerceLinkout: {
    clickCount: number;
    /** 상품 카드별 클릭 — 어떤 상품이 반응을 얻는지 */
    clickCountsByProductCard: Record<string, number>;
    /** 라이브 회차별 클릭 — 방송 성과 비교의 단위 */
    clickCountsByLiveSession: Record<string, number>;
  };
  capacityDrops: {
    viewCountsByContent: number;
    sessionsEnteredWizard: number;
    sessionsResumedUpload: number;
    sessionsCompletedUpload: number;
    captionSessionStates: number;
    linkoutClicksByProductCard: number;
    linkoutClicksByLiveSession: number;
  };
}

const ratio = (numerator: number, denominator: number): number | null =>
  denominator > 0 ? numerator / denominator : null;

const intersectionSize = (a: ReadonlySet<string>, b: ReadonlySet<string>): number => {
  let count = 0;
  for (const v of a) if (b.has(v)) count += 1;
  return count;
};

/**
 * 롤업 세션 Set/Map(진입·재개·완료 세션, 자막 세션 상태) + contentId Map 각각의 최대 엔트리 수 —
 * 대장 #79 조치③: 상한이 없으면 (레이트리밋 부재와 결합해) 인메모리 롤업이 무한 증가해 메모리
 * 고갈 벡터가 된다. 5000은 "동시 관측 세션/콘텐츠 다양성"으로 넉넉한 여유치(문자열 키 최대
 * 128바이트 × 5000 × 컬렉션 5개 ≈ 수백 KB~수 MB 규모로 유계)이며, 실사용 규모(제주 12개 지사) 대비
 * 과도하게 낮지 않다. 상한 도달 후 "새 키" 추가는 조용히 버리지 않고 `capacityDrops`로 노출한다
 * (기존 키 갱신은 세트/맵 크기를 늘리지 않으므로 상한과 무관하게 항상 허용). env 미도입.
 */
export const TELEMETRY_MAX_ROLLUP_KEYS = 5000;

/**
 * 순수 인메모리 롤업 — 프레임워크 무관(단위 테스트가 NestJS DI 없이 직접 구성 가능).
 * `TelemetryService`가 프로세스 생애주기 동안 단일 인스턴스를 보유한다(싱글턴 프로바이더).
 */
export class TelemetryRollup {
  /** 테스트가 작은 상한으로 드롭 동작을 빠르게 검증할 수 있도록 생성자 주입(운영 기본값=상수) */
  constructor(private readonly maxRollupKeys: number = TELEMETRY_MAX_ROLLUP_KEYS) {}

  private totalEventsReceived = 0;
  private unknownEventCount = 0;

  private playbackStartCount = 0;
  private readonly progressMilestoneCounts: Record<'p25' | 'p50' | 'p75' | 'p100', number> = {
    p25: 0,
    p50: 0,
    p75: 0,
    p100: 0,
  };
  private readonly viewCountsByContent = new Map<string, number>();
  private linkoutClickCount = 0;
  private readonly linkoutClicksByProductCard = new Map<string, number>();
  private readonly linkoutClicksByLiveSession = new Map<string, number>();
  private linkoutClicksByProductCardDropped = 0;
  private linkoutClicksByLiveSessionDropped = 0;
  private viewCountsByContentDropped = 0;

  private wizardStepEnterCount = 0;
  private wizardStepExitCount = 0;
  private uploadStartCount = 0;
  private uploadResumeCount = 0;
  private uploadCompleteCount = 0;
  private readonly sessionsEnteredWizard = new Set<string>();
  private readonly sessionsCompletedUpload = new Set<string>();
  private readonly sessionsResumedUpload = new Set<string>();
  private sessionsEnteredWizardDropped = 0;
  private sessionsCompletedUploadDropped = 0;
  private sessionsResumedUploadDropped = 0;

  private toggleOnEventCount = 0;
  private toggleOffEventCount = 0;
  private readonly latestCaptionStateBySession = new Map<string, boolean>();
  private captionSessionStatesDropped = 0;
  /** sessionId 없는(상관 불가) 토글 관측 수 — 세션 Map에는 절대 넣지 않는다(무한 키 발급 방지) */
  private anonymousToggleObservedCount = 0;

  private simpleCount = 0;
  private preciseCount = 0;

  /** contentId 등 카운트형 Map — 기존 키는 항상 갱신, 신규 키는 상한 도달 시 드롭+카운트 */
  private bumpCappedMapCount(map: Map<string, number>, key: string, onDrop: () => void): void {
    const existing = map.get(key);
    if (existing !== undefined) {
      map.set(key, existing + 1);
      return;
    }
    if (map.size >= this.maxRollupKeys) {
      onDrop();
      return;
    }
    map.set(key, 1);
  }

  /** 세션 Set — 이미 있는 값은 그대로(크기 불변), 신규 값만 상한 검사 */
  private addToCappedSet(set: Set<string>, value: string, onDrop: () => void): void {
    if (set.has(value)) return;
    if (set.size >= this.maxRollupKeys) {
      onDrop();
      return;
    }
    set.add(value);
  }

  /** 세션별 최신 상태 Map — 기존 세션의 상태 갱신은 상한과 무관하게 항상 허용, 신규 세션만 상한 검사 */
  private setCappedSessionState(
    map: Map<string, boolean>,
    key: string,
    value: boolean,
    onDrop: () => void,
  ): void {
    if (!map.has(key) && map.size >= this.maxRollupKeys) {
      onDrop();
      return;
    }
    map.set(key, value);
  }

  /** 카탈로그 밖 이름이면 'unknown'(카운트만 증가), 아니면 트랙별 카운터 갱신 후 'known' */
  record(event: TelemetryEventInput): 'known' | 'unknown' {
    this.totalEventsReceived += 1;

    switch (event.name) {
      case TelemetryEventName.PlaybackStart:
        this.playbackStartCount += 1;
        if (event.contentId) {
          this.bumpCappedMapCount(
            this.viewCountsByContent,
            event.contentId,
            () => (this.viewCountsByContentDropped += 1),
          );
        }
        return 'known';

      case TelemetryEventName.PlaybackProgress: {
        const percent = event.payload?.percent;
        if (typeof percent === 'number' && PROGRESS_MILESTONES.includes(percent as ProgressMilestone)) {
          this.progressMilestoneCounts[PROGRESS_MILESTONE_KEY[percent as ProgressMilestone]] += 1;
        }
        return 'known';
      }

      case TelemetryEventName.WizardStepEnter:
        this.wizardStepEnterCount += 1;
        if (event.sessionId) {
          this.addToCappedSet(
            this.sessionsEnteredWizard,
            event.sessionId,
            () => (this.sessionsEnteredWizardDropped += 1),
          );
        }
        return 'known';

      case TelemetryEventName.WizardStepExit:
        this.wizardStepExitCount += 1;
        return 'known';

      case TelemetryEventName.UploadStart:
        this.uploadStartCount += 1;
        return 'known';

      case TelemetryEventName.UploadResume:
        this.uploadResumeCount += 1;
        if (event.sessionId) {
          this.addToCappedSet(
            this.sessionsResumedUpload,
            event.sessionId,
            () => (this.sessionsResumedUploadDropped += 1),
          );
        }
        return 'known';

      case TelemetryEventName.UploadComplete:
        this.uploadCompleteCount += 1;
        if (event.sessionId) {
          this.addToCappedSet(
            this.sessionsCompletedUpload,
            event.sessionId,
            () => (this.sessionsCompletedUploadDropped += 1),
          );
        }
        return 'known';

      case TelemetryEventName.LargeCaptionToggle: {
        const enabled = event.payload?.enabled;
        if (typeof enabled === 'boolean') {
          if (enabled) this.toggleOnEventCount += 1;
          else this.toggleOffEventCount += 1;

          if (event.sessionId) {
            this.setCappedSessionState(
              this.latestCaptionStateBySession,
              event.sessionId,
              enabled,
              () => (this.captionSessionStatesDropped += 1),
            );
          } else {
            // sessionId 없음 = 세션 상관 불가 — 과거엔 `__anon_${counter++}`로 매번 새 키를
            // 세션 Map에 발급해 요청 1건당 1엔트리씩 영구 누적됐다(대장 #79 조치①). 세션 Map에는
            // 절대 넣지 않고 별도 스칼라로만 집계한다(무한 키 발급 자체를 구조적으로 차단).
            this.anonymousToggleObservedCount += 1;
          }
        }
        return 'known';
      }

      // 발신은 대장 #123으로 한때 제거됐다가(간단 모드가 정밀 모드와 항등이라 채택률 KPI가
      // 무의미했다) **T-W2-34가 간단 모드를 실제로 구현하며 재도입**했다(2026-08-16). 이제 유효한 지표다.
      // ⚠️ 아래 'simple'|'precise' 리터럴은 앱(reporter `features/contents/mode.ts`)과 짝을 이루는데
      // shared에 payload 계약이 없어 **타입으로 묶여 있지 않다** — 한쪽만 바꾸면 조용히 집계가 0이 된다.
      case TelemetryEventName.ModeSelected: {
        const mode = event.payload?.mode;
        if (mode === 'simple') this.simpleCount += 1;
        else if (mode === 'precise') this.preciseCount += 1;
        return 'known';
      }

      // 링크아웃 클릭(02 §E-19). payload = { liveSessionId, productCardId }.
      // ⚠️ 원시 총계(clickCount)는 **payload 유무와 무관하게** 올린다 — 상관자가 없어도 "클릭이
      // 일어났다"는 사실 자체가 2단계 트리거 판정의 분자다. 상관 가능한 것만 Map에 넣는다.
      case TelemetryEventName.CommerceLinkoutClick: {
        this.linkoutClickCount += 1;
        const cardId = event.payload?.productCardId;
        if (typeof cardId === 'string' && cardId.length > 0) {
          this.bumpCappedMapCount(
            this.linkoutClicksByProductCard,
            cardId,
            () => (this.linkoutClicksByProductCardDropped += 1),
          );
        }
        const sessionId = event.payload?.liveSessionId;
        if (typeof sessionId === 'string' && sessionId.length > 0) {
          this.bumpCappedMapCount(
            this.linkoutClicksByLiveSession,
            sessionId,
            () => (this.linkoutClicksByLiveSessionDropped += 1),
          );
        }
        return 'known';
      }

      default:
        this.unknownEventCount += 1;
        return 'unknown';
    }
  }

  toSummary(): TelemetrySummary {
    const captionStates = [...this.latestCaptionStateBySession.values()];

    return {
      generatedAt: new Date().toISOString(),
      totalEventsReceived: this.totalEventsReceived,
      unknownEventCount: this.unknownEventCount,
      consumption: {
        playbackStartCount: this.playbackStartCount,
        progressMilestoneCounts: { ...this.progressMilestoneCounts },
        viewCountsByContent: Object.fromEntries(this.viewCountsByContent),
      },
      uploadFunnel: {
        wizardStepEnterCount: this.wizardStepEnterCount,
        wizardStepExitCount: this.wizardStepExitCount,
        uploadStartCount: this.uploadStartCount,
        uploadResumeCount: this.uploadResumeCount,
        uploadCompleteCount: this.uploadCompleteCount,
        wizardCompletionRate: ratio(
          intersectionSize(this.sessionsEnteredWizard, this.sessionsCompletedUpload),
          this.sessionsEnteredWizard.size,
        ),
        resumeSuccessRate: ratio(
          intersectionSize(this.sessionsResumedUpload, this.sessionsCompletedUpload),
          this.sessionsResumedUpload.size,
        ),
      },
      largeCaptionMode: {
        toggleOnEventCount: this.toggleOnEventCount,
        toggleOffEventCount: this.toggleOffEventCount,
        activeRatio: ratio(captionStates.filter(Boolean).length, captionStates.length),
        anonymousToggleObservedCount: this.anonymousToggleObservedCount,
      },
      modeSelection: {
        simpleCount: this.simpleCount,
        preciseCount: this.preciseCount,
        simpleAdoptionRate: ratio(this.simpleCount, this.simpleCount + this.preciseCount),
      },
      commerceLinkout: {
        clickCount: this.linkoutClickCount,
        clickCountsByProductCard: Object.fromEntries(this.linkoutClicksByProductCard),
        clickCountsByLiveSession: Object.fromEntries(this.linkoutClicksByLiveSession),
      },
      capacityDrops: {
        viewCountsByContent: this.viewCountsByContentDropped,
        sessionsEnteredWizard: this.sessionsEnteredWizardDropped,
        sessionsResumedUpload: this.sessionsResumedUploadDropped,
        sessionsCompletedUpload: this.sessionsCompletedUploadDropped,
        captionSessionStates: this.captionSessionStatesDropped,
        linkoutClicksByProductCard: this.linkoutClicksByProductCardDropped,
        linkoutClicksByLiveSession: this.linkoutClicksByLiveSessionDropped,
      },
    };
  }
}

@Injectable()
export class TelemetryService {
  private readonly logger = new Logger(TelemetryService.name);
  private readonly rollup = new TelemetryRollup();

  /** 배치 수신 — 이벤트별 구조화 로그 1줄 + 인메모리 롤업 갱신. 부분 실패 없음(전 이벤트 처리 시도) */
  ingest(events: readonly TelemetryEventInput[]): TelemetryIngestResult {
    let accepted = 0;
    let unknown = 0;

    for (const event of events) {
      const outcome = this.rollup.record(event);
      if (outcome === 'known') {
        accepted += 1;
        this.logger.log(
          JSON.stringify({
            msg: 'telemetry_event',
            name: event.name,
            sessionId: event.sessionId,
            contentId: event.contentId,
            occurredAt: event.occurredAt,
          }),
        );
      } else {
        unknown += 1;
        this.logger.warn(JSON.stringify({ msg: 'telemetry_unknown_event', name: event.name }));
      }
    }

    return { accepted, unknownEventCount: unknown };
  }

  summary(): TelemetrySummary {
    return this.rollup.toSummary();
  }
}
