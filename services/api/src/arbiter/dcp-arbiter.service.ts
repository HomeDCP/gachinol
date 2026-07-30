import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ProcessingState } from '@gachinol/shared';
import type { Env } from '../config/env.schema';
import { MEDIA_QUEUE, type MediaQueue } from '../queue/queue.constants';
import {
  decideHold,
  describeHold,
  type DcpArbiterState,
  type HoldPolicy,
  type HoldReason,
} from './arbiter-policy';
import { DcpArbiterClient } from './dcp-arbiter.client';

// 앱에 노출하는 상태의 계약은 shared가 원천(`GET /v1/system/processing-state`).
export type { ProcessingState };

/**
 * DCP 상호배제 아비터 — 제온 호스트를 DCP 파이프라인과 공유하기 위한 게이트.
 *
 * DCP가 CPU를 쓰는 동안(`busy`) **미디어 큐를 전역 정지**한다. BullMQ `Queue.pause()`는
 * 전역이라 별도 프로세스인 media-worker도 새 잡을 집지 않고 **진행 중 1건만 마치고 대기**한다
 * (선점·중단 없음 → 사용자 요구인 "DCP 우선, 가치놀은 양보"와 정확히 일치).
 *
 * 갱신 트리거: SSE(`state_changed`·`snapshot`) + 폴백 폴링(SSE는 best-effort라 순단 시 누락).
 * DCP의 상태 분류는 그쪽이 소유하며(`busy` 불린만 소비) 우리는 재구현하지 않는다.
 *
 * DCP_ARBITER_URL 미설정 또는 REDIS_URL 미설정 시 **완전 비활성**(큐를 건드리지 않음) —
 * 제온 외 환경(로컬·클라우드)에서 그대로 부팅된다.
 */
@Injectable()
export class DcpArbiterService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DcpArbiterService.name);

  private timer: NodeJS.Timeout | null = null;
  private unsubscribe: (() => void) | null = null;
  private refreshing = false;
  private pending = false;

  private holding = false;
  private reason: HoldReason | null = null;
  private dcp: DcpArbiterState | null = null;
  private lastCheckedAt: string | null = null;

  constructor(
    @Inject(MEDIA_QUEUE) private readonly queue: MediaQueue,
    private readonly client: DcpArbiterClient,
    private readonly config: ConfigService<Env, true>,
  ) {}

  get enabled(): boolean {
    return this.client.baseUrl != null && this.queue != null;
  }

  private get policy(): HoldPolicy {
    return {
      holdOnImminent: this.config.get('DCP_ARBITER_HOLD_ON_IMMINENT', { infer: true }),
      failMode: this.config.get('DCP_ARBITER_FAIL_MODE', { infer: true }),
    };
  }

  get state(): ProcessingState {
    return {
      enabled: this.enabled,
      holding: this.holding,
      reason: this.reason,
      message: this.enabled ? describeHold(this.reason, this.dcp) : '처리 가능',
      dcp: this.dcp,
      lastCheckedAt: this.lastCheckedAt,
    };
  }

  async onModuleInit(): Promise<void> {
    if (!this.enabled) {
      this.logger.log(
        this.client.baseUrl == null
          ? 'DCP_ARBITER_URL 미설정 — DCP 상호배제 비활성(미디어 큐 상시 가동)'
          : 'REDIS_URL 미설정 — 제어할 미디어 큐가 없어 DCP 상호배제 비활성',
      );
      return;
    }
    this.logger.log(`DCP 상호배제 활성 — ${this.client.baseUrl}`);

    // BullMQ의 pause는 **Redis에 영속**된다. 이전 프로세스가 정지시킨 채 죽었으면 큐는 여전히 정지 상태다.
    // 로컬 holding(기본 false)으로 시작하면 applyGate가 "이미 재개됨"으로 오판해 resume을 건너뛰고
    // 큐가 영구 정지된다 → 실제 큐 상태에서 출발한다.
    this.holding = await this.queue!.isPaused().catch(() => false);
    if (this.holding) this.logger.warn('이전 기동이 남긴 큐 정지 상태를 확인 — 현재 DCP 상태로 재평가');

    // 부팅 시 1회 즉시 반영
    await this.refresh();

    this.unsubscribe = this.client.subscribe(() => void this.refresh());
    const pollMs = this.config.get('DCP_ARBITER_POLL_MS', { infer: true });
    this.timer = setInterval(() => void this.refresh(), pollMs);
    this.timer.unref?.(); // 테스트·종료 시 이벤트루프 잔류 방지
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.unsubscribe?.();
    // 정지 상태로 남기지 않는다 — 다음 기동(또는 아비터 없는 배포)에서 큐가 영구 정지되면 안 됨
    if (this.holding) await this.queue?.resume().catch(() => undefined);
  }

  /**
   * 상태 재조회 → 게이트 반영. 동시 호출은 합쳐진다(SSE 폭주 시 중복 조회 방지).
   * 어떤 예외도 밖으로 던지지 않는다(타이머·SSE 콜백에서 호출되므로).
   */
  async refresh(): Promise<void> {
    if (!this.enabled) return;
    if (this.refreshing) {
      this.pending = true; // 진행 중이면 끝난 뒤 한 번 더
      return;
    }
    this.refreshing = true;
    try {
      do {
        this.pending = false;
        const state = await this.client.fetchState();
        const { hold, reason } = decideHold(state, this.policy);
        this.dcp = state;
        this.lastCheckedAt = new Date().toISOString();
        await this.applyGate(hold, reason);
      } while (this.pending);
    } catch (e) {
      this.logger.warn(`아비터 갱신 실패(무시) — ${(e as Error).message}`);
    } finally {
      this.refreshing = false;
    }
  }

  /** 정지/재개는 상태가 바뀔 때만 호출(중복 pause/resume 억제) */
  private async applyGate(hold: boolean, reason: HoldReason | null): Promise<void> {
    this.reason = hold ? reason : null;
    if (hold === this.holding) return;
    try {
      if (hold) {
        await this.queue?.pause();
        this.holding = true;
        this.logger.warn(`미디어 큐 정지 — ${describeHold(reason, this.dcp)}`);
      } else {
        await this.queue?.resume();
        this.holding = false;
        this.logger.log('미디어 큐 재개 — DCP 유휴');
      }
    } catch (e) {
      // 큐 제어 실패 시 상태를 바꾸지 않는다(다음 주기에 재시도)
      this.logger.error(`미디어 큐 ${hold ? '정지' : '재개'} 실패 — ${(e as Error).message}`);
    }
  }
}
