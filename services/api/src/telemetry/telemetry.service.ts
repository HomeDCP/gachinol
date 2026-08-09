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
 * ── 이벤트 DTO/zod 스키마 위치 ────────────────────────────────────────────
 * api 로컬(shared 금지) — `distribution/distribution-job.ts`가 워커 인프로세스라 shared를 쓰지 않은
 * 것과 동형: 이 모듈도 클라이언트(앱)와 별도 프로세스 경계를 넘지 않는 REST 계약일 뿐이다.
 *
 * ── 미지의 이벤트 이름 처리: 무시 + 카운트 (400 거절 아님) ───────────────────
 * 봉투(이름·sessionId·contentId·occurredAt·payload)는 zod가 구조적으로 강제하되, `name`이 알려진
 * 카탈로그 밖이어도 배치 전체를 거부하지 않는다 — 계측은 "유실 허용 등급"이므로, 클라이언트 버전 스큐로
 * 낯선 이벤트 1건이 섞였다고 나머지 정상 이벤트까지 함께 버릴 이유가 없다. 대신 `unknownEventCount`로
 * 관측 가능하게 남긴다(무기록 실패 금지). 반대로 배치 크기 초과·봉투 형태 위반(예: name 누락)은 zod가
 * 요청 전체를 400(validation_failed)으로 거부한다 — 이건 클라이언트 버그 신호라 조용히 삼키면 안 된다.
 * ══════════════════════════════════════════════════════════════════════════ */

/** 3트랙 이벤트 이름 카탈로그 — 02 §E-16 원문 3트랙(소비·업로드퍼널·모드선택)의 단일 원천 */
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
  // ③ 모드 선택
  ModeSelected: 'mode_selected',
} as const;
export type TelemetryEventName = (typeof TelemetryEventName)[keyof typeof TelemetryEventName];

/** 배치 상한 — 초과 시 요청 전체 400(구조 위반, zod 거부). env 미도입(고정 상수로 충분한 규모) */
export const TELEMETRY_MAX_BATCH_SIZE = 100;

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
  payload: z.record(z.string(), z.unknown()).optional(),
});
export type TelemetryEventInput = z.infer<typeof zTelemetryEvent>;

/** `POST /v1/telemetry/events` 바디 — 배열 그 자체(래핑 객체 아님), 배치 수신 */
export const zTelemetryEventBatch = z
  .array(zTelemetryEvent)
  .min(1, '이벤트가 최소 1건 필요합니다')
  .max(TELEMETRY_MAX_BATCH_SIZE, `배치는 최대 ${TELEMETRY_MAX_BATCH_SIZE}건까지 허용됩니다`);

export class TelemetryEventBatchDto extends createZodDto(zTelemetryEventBatch) {}

export interface TelemetryIngestResult {
  /** 카탈로그에 있는 이벤트로 처리된 건수 */
  accepted: number;
  /** 카탈로그 밖 이름이라 무시된 건수(배치 자체는 거부되지 않음) */
  unknownEventCount: number;
}

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
     * 수신 순서가 곧 관측 순서). `sessionId` 없는 이벤트는 각각 독립 세션으로 취급(집계에서 유실 방지).
     * 관측된 세션이 0건이면 null.
     */
    activeRatio: number | null;
  };
  modeSelection: {
    simpleCount: number;
    preciseCount: number;
    /** 01 §C-7 간단 모드 채택률 실측 — simple / (simple + precise). 관측 0건이면 null */
    simpleAdoptionRate: number | null;
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
 * 순수 인메모리 롤업 — 프레임워크 무관(단위 테스트가 NestJS DI 없이 직접 구성 가능).
 * `TelemetryService`가 프로세스 생애주기 동안 단일 인스턴스를 보유한다(싱글턴 프로바이더).
 */
export class TelemetryRollup {
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

  private wizardStepEnterCount = 0;
  private wizardStepExitCount = 0;
  private uploadStartCount = 0;
  private uploadResumeCount = 0;
  private uploadCompleteCount = 0;
  private readonly sessionsEnteredWizard = new Set<string>();
  private readonly sessionsCompletedUpload = new Set<string>();
  private readonly sessionsResumedUpload = new Set<string>();

  private toggleOnEventCount = 0;
  private toggleOffEventCount = 0;
  private readonly latestCaptionStateBySession = new Map<string, boolean>();
  private anonCaptionSessionCounter = 0;

  private simpleCount = 0;
  private preciseCount = 0;

  /** 카탈로그 밖 이름이면 'unknown'(카운트만 증가), 아니면 트랙별 카운터 갱신 후 'known' */
  record(event: TelemetryEventInput): 'known' | 'unknown' {
    this.totalEventsReceived += 1;

    switch (event.name) {
      case TelemetryEventName.PlaybackStart:
        this.playbackStartCount += 1;
        if (event.contentId) {
          this.viewCountsByContent.set(
            event.contentId,
            (this.viewCountsByContent.get(event.contentId) ?? 0) + 1,
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
        if (event.sessionId) this.sessionsEnteredWizard.add(event.sessionId);
        return 'known';

      case TelemetryEventName.WizardStepExit:
        this.wizardStepExitCount += 1;
        return 'known';

      case TelemetryEventName.UploadStart:
        this.uploadStartCount += 1;
        return 'known';

      case TelemetryEventName.UploadResume:
        this.uploadResumeCount += 1;
        if (event.sessionId) this.sessionsResumedUpload.add(event.sessionId);
        return 'known';

      case TelemetryEventName.UploadComplete:
        this.uploadCompleteCount += 1;
        if (event.sessionId) this.sessionsCompletedUpload.add(event.sessionId);
        return 'known';

      case TelemetryEventName.LargeCaptionToggle: {
        const enabled = event.payload?.enabled;
        if (typeof enabled === 'boolean') {
          if (enabled) this.toggleOnEventCount += 1;
          else this.toggleOffEventCount += 1;
          const key = event.sessionId ?? `__anon_${this.anonCaptionSessionCounter++}`;
          this.latestCaptionStateBySession.set(key, enabled);
        }
        return 'known';
      }

      case TelemetryEventName.ModeSelected: {
        const mode = event.payload?.mode;
        if (mode === 'simple') this.simpleCount += 1;
        else if (mode === 'precise') this.preciseCount += 1;
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
      },
      modeSelection: {
        simpleCount: this.simpleCount,
        preciseCount: this.preciseCount,
        simpleAdoptionRate: ratio(this.simpleCount, this.simpleCount + this.preciseCount),
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
