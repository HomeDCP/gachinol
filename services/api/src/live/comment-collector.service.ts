import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ChannelAccount as ChannelAccountRow, Prisma } from '@prisma/client';
import { ChannelAccountsService } from '../distribution/channel-accounts.service';
import type { Env } from '../config/env.schema';
import { COMMENT_SOURCE_REGISTRY } from './live.constants';
import { CommentSourceRegistry } from './adapters/comment-source.registry';
import { LiveBroadcaster } from './live.broadcaster';
import { LiveCommentsService } from './live-comments.service';
import { LiveSessionsService } from './live-sessions.service';
import { toLiveComment } from './live.mapper';

/**
 * 댓글 수집 드라이버 — 인프로세스·이벤트-암드. start→arm/end→disarm, 활성 세션 0이면 타이머 0
 * (라이브 미기동 스위트에 타이머·열린핸들 0 = 회귀 안전). 폴링은 순수 compute+DB+WS(Redis 불요).
 * api=유일 DB 기록자. 다중 인스턴스 중복 폴링 방지는 MVP 단일 인스턴스 전제(확장점: BullMQ repeatable/락).
 */
@Injectable()
export class CommentCollectorService implements OnModuleDestroy {
  private readonly logger = new Logger(CommentCollectorService.name);
  private readonly active = new Set<string>();
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly sessions: LiveSessionsService,
    private readonly channels: ChannelAccountsService,
    private readonly comments: LiveCommentsService,
    private readonly broadcaster: LiveBroadcaster,
    @Inject(COMMENT_SOURCE_REGISTRY) private readonly registry: CommentSourceRegistry,
  ) {}

  /** start(preparing→live) 시 무장 — 첫 무장에서 인터벌 기동 */
  arm(liveSessionId: string): void {
    this.active.add(liveSessionId);
    if (!this.timer) {
      const interval = this.config.get('LIVE_COMMENT_POLL_INTERVAL_MS', { infer: true });
      this.timer = setInterval(() => void this.tick(), interval);
      // 프로세스 종료를 막지 않도록 unref(테스트 열린핸들 방지)
      this.timer.unref?.();
      this.logger.log(`댓글 수집 인터벌 기동 (${interval}ms)`);
    }
  }

  /** end/cancel 시 해제 — 활성 0이면 인터벌 정지 */
  disarm(liveSessionId: string): void {
    this.active.delete(liveSessionId);
    if (this.active.size === 0 && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      this.logger.log('활성 라이브 0 — 댓글 수집 인터벌 정지');
    }
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.active.clear();
  }

  private async tick(): Promise<void> {
    if (this.ticking) return; // 이전 tick 진행 중이면 스킵(중첩 방지)
    this.ticking = true;
    try {
      for (const id of [...this.active]) {
        await this.collectOnce(id).catch((e) =>
          this.logger.warn(`collectOnce 실패(${id}): ${e instanceof Error ? e.message : e}`),
        );
      }
    } finally {
      this.ticking = false;
    }
  }

  /**
   * 1회 수집 — E2E 직접 호출 공개(인터벌 비의존). 세션의 comment_read 대상 채널을 채널별 poll →
   * 정규화 → 멱등 영속 → 신규분(collected) 배치 프롬프터 푸시 → prompted 마킹. 반환=푸시한 신규 건수.
   */
  async collectOnce(liveSessionId: string): Promise<number> {
    const session = await this.sessions.findById(liveSessionId);
    if (!session || session.status !== 'live') return 0;

    const targets = await this.resolveCommentChannels(session.targetChannelAccountIds);
    const normalized: Prisma.LiveCommentCreateManyInput[] = [];

    for (const ch of targets) {
      const adapter = this.registry.get(ch.platform);
      if (!adapter) continue; // kakao/app 등 댓글수집 비대상 — 조용히 skip
      try {
        const { comments } = await adapter.poll({
          externalChannelId: ch.externalChannelId,
          credentialRef: ch.credentialRef,
        });
        for (const raw of comments) {
          normalized.push(
            this.comments.normalize(raw, {
              liveSessionId,
              channelAccountId: ch.id,
              platform: ch.platform,
            }),
          );
        }
      } catch (e) {
        // per-channel 실패는 흡수하고 계속(한 채널 장애가 전체 수집을 막지 않음)
        this.logger.warn(
          `채널 poll 실패 (${ch.platform}/${ch.externalChannelId}): ${e instanceof Error ? e.message : e}`,
        );
      }
    }

    await this.comments.persistMany(normalized);

    const unprompted = await this.comments.fetchUnprompted(liveSessionId);
    if (unprompted.length === 0) return 0;

    this.broadcaster.emitPrompterComments({
      liveSessionId: liveSessionId as never,
      comments: unprompted.map(toLiveComment),
    });
    await this.comments.markPrompted(unprompted.map((r) => r.id));
    return unprompted.length;
  }

  /** targetChannelAccountIds 중 comment_read capability 보유 채널만 */
  private async resolveCommentChannels(ids: readonly string[]): Promise<ChannelAccountRow[]> {
    if (ids.length === 0) return [];
    const map = await this.channels.findByIds(ids);
    const out: ChannelAccountRow[] = [];
    for (const id of ids) {
      const ch = map.get(id);
      if (ch && ch.capabilities.includes('comment_read')) out.push(ch);
    }
    return out;
  }
}
