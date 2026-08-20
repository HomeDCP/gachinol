import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { LiveIngestInfo, LiveSessionStatus, Paginated, User } from '@gachinol/shared';
import {
  canTransition,
  initialLiveStatus,
  LIVE_SESSION_STATUS_TRANSITIONS,
  nextStates,
  ProgramCategory,
} from '@gachinol/shared';
import type { LiveSession as LiveSessionRow, Prisma } from '@prisma/client';
import { v7 as uuidv7 } from 'uuid';
import { DomainException } from '../common/errors/domain.exception';
import { newId } from '../common/ids';
import { PrismaService } from '../prisma/prisma.service';
import type { Env } from '../config/env.schema';
import { LiveBroadcaster } from './live.broadcaster';
import type { CreateLiveSessionDto, LiveSessionListQueryDto } from './schemas/live.schemas';

/**
 * ★ live_sessions의 유일 DB 기록자. 상태 전이 규칙의 유일 원천은 shared
 * LIVE_SESSION_STATUS_TRANSITIONS(canTransition 검증·사본 금지) — 여기는 CAS(원자성)+감사 로그+브로드캐스트만.
 */
@Injectable()
export class LiveSessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
    private readonly broadcaster: LiveBroadcaster,
  ) {}

  /**
   * 생성 — 불변식 type='emergency' ⇔ scheduledAt=null. 초기 상태=initialLiveStatus(type)(긴급=preparing).
   * hostStationId 생략 시 센터. 전이 로그는 남기지 않는다(생성=진입점, content draft 선례).
   */
  async create(dto: CreateLiveSessionDto, user: User): Promise<LiveSessionRow> {
    const isEmergency = dto.type === ProgramCategory.Emergency;
    if (isEmergency && dto.scheduledAt !== null) {
      throw new DomainException(
        'validation_failed',
        "긴급(emergency) 라이브는 scheduledAt=null이어야 합니다",
        { type: dto.type },
      );
    }
    if (!isEmergency && dto.scheduledAt === null) {
      throw new DomainException(
        'validation_failed',
        '정규 편성 라이브는 scheduledAt이 필요합니다',
        { type: dto.type },
      );
    }

    const hostStationId = dto.hostStationId ?? (await this.centerStationId());
    const status = initialLiveStatus(dto.type);

    return this.prisma.liveSession.create({
      data: {
        id: newId(),
        type: dto.type,
        title: dto.title,
        status,
        hostStationId,
        scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : null,
        targetChannelAccountIds: [...dto.targetChannelAccountIds],
        productIds: dto.productIds ? [...dto.productIds] : [],
        // 카드 id는 **서버가 발급한다** — 클릭 계측의 상관자라 클라이언트가 정하면 중복·충돌 시
        // 과거 지표가 다른 상품에 붙는다(집계는 시간을 거슬러 정정되지 않는다).
        productCards: (dto.productCards ?? []).map((card) => ({ ...card, id: uuidv7() })),
        createdByUserId: user.id,
      },
    });
  }

  async findById(id: string): Promise<LiveSessionRow | null> {
    return this.prisma.liveSession.findUnique({ where: { id } });
  }

  async loadOr404(id: string): Promise<LiveSessionRow> {
    const row = await this.findById(id);
    if (!row) throw new DomainException('not_found', '라이브 세션을 찾을 수 없습니다');
    return row;
  }

  async list(query: LiveSessionListQueryDto): Promise<Paginated<LiveSessionRow>> {
    const where: Prisma.LiveSessionWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.hostStationId ? { hostStationId: query.hostStationId } : {}),
    };
    const [items, totalCount] = await Promise.all([
      this.prisma.liveSession.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.liveSession.count({ where }),
    ]);
    return { items, page: query.page, pageSize: query.pageSize, totalCount };
  }

  /** 공개 노출 상태 — 시청 룸 joinable 집합과 동일(interrupted=일시중단도 시청자에 정직) */
  private static readonly PUBLIC_STATUSES: readonly LiveSessionStatus[] = [
    'scheduled',
    'preparing',
    'live',
    'interrupted',
  ];

  /**
   * 공개 목록 정렬 우선순위 — 방송중(live) 최상단, 그다음 준비·일시중단, 예정 최하.
   * status는 text 컬럼이라 DB orderBy 'asc'는 사전순(interrupted<live<…)이 되어 방송중이 밀린다 →
   * 의미 순위를 애플리케이션단에서 부여한다.
   */
  private static readonly PUBLIC_STATUS_RANK: Partial<Record<LiveSessionStatus, number>> = {
    live: 0,
    preparing: 1,
    interrupted: 2,
    scheduled: 3,
  };

  /** GET /live/sessions — 공개 상태만(ended/canceled 제외). live 우선, 그다음 예정 시각순. */
  async listPublic(): Promise<LiveSessionRow[]> {
    // DB단 2차 정렬(예정 시각 오름차순, 생성 내림차순)로 안정 순서 확보 후,
    // 안정 정렬(Array.sort)로 status 의미 순위를 1차 키로 덮어씌운다(동순위는 DB 순서 유지).
    const rows = await this.prisma.liveSession.findMany({
      where: { status: { in: [...LiveSessionsService.PUBLIC_STATUSES] } },
      orderBy: [{ scheduledAt: 'asc' }, { createdAt: 'desc' }],
    });
    const rank = (status: string): number =>
      LiveSessionsService.PUBLIC_STATUS_RANK[status as LiveSessionStatus] ?? 99;
    return rows.sort((a, b) => rank(a.status) - rank(b.status));
  }

  /** GET /live/sessions/:id — 비공개 상태(ended/canceled)·부재는 404 */
  async getPublicOr404(id: string): Promise<LiveSessionRow> {
    const row = await this.findById(id);
    if (!row || !LiveSessionsService.PUBLIC_STATUSES.includes(row.status as LiveSessionStatus)) {
      throw new DomainException('not_found', '라이브 세션을 찾을 수 없습니다');
    }
    return row;
  }

  /** 룸 join 가능 여부 — 공개 상태 집합과 동일 */
  static isJoinable(status: string): boolean {
    return LiveSessionsService.PUBLIC_STATUSES.includes(status as LiveSessionStatus);
  }

  /** 관제 전용 — streamKey 실값이 실리는 유일한 장소(dev 플레이스홀더) */
  async getIngest(id: string): Promise<LiveIngestInfo> {
    const row = await this.loadOr404(id);
    const rtmpUrl = row.rtmpIngestUrl ?? this.rtmpUrl(id);
    const devKey = this.config.get('LIVE_DEV_STREAM_KEY', { infer: true });
    return {
      liveSessionId: row.id as never,
      rtmpUrl,
      streamKey: devKey ?? `dev-${id}`,
    };
  }

  // ── 라이프사이클(전부 CAS + shared 전이맵 검증 + 로그 + 브로드캐스트) ──────────

  prepare(id: string, user: User): Promise<LiveSessionRow> {
    return this.applyTransition(id, 'preparing', user, {
      rtmpIngestUrl: this.rtmpUrl(id),
      streamKeyRef: `live:${id}`,
    });
  }

  start(id: string, user: User): Promise<LiveSessionRow> {
    return this.applyTransition(id, 'live', user, {
      startedAt: new Date(),
      hlsPlaybackUrl: this.hlsUrl(id),
    });
  }

  interrupt(id: string, user: User): Promise<LiveSessionRow> {
    return this.applyTransition(id, 'interrupted', user, {});
  }

  resume(id: string, user: User): Promise<LiveSessionRow> {
    return this.applyTransition(id, 'live', user, {});
  }

  end(id: string, user: User): Promise<LiveSessionRow> {
    return this.applyTransition(id, 'ended', user, { endedAt: new Date() });
  }

  cancel(id: string, user: User): Promise<LiveSessionRow> {
    return this.applyTransition(id, 'canceled', user, {});
  }

  /**
   * 단일 전이 — 현 status를 from으로 CAS. 규칙은 shared 전이맵이 유일 원천(canTransition).
   * affected 0이면 동시 경합 → 409. 커밋 후 liveRoom+CONTROL_ROOM에 live.status_changed 브로드캐스트.
   */
  private async applyTransition(
    id: string,
    to: LiveSessionStatus,
    user: User,
    mutate: Prisma.LiveSessionUncheckedUpdateManyInput,
  ): Promise<LiveSessionRow> {
    const row = await this.loadOr404(id);
    const from = row.status as LiveSessionStatus;
    this.assertAllowed(from, to);

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.liveSession.updateMany({
        where: { id, status: from },
        data: { status: to, ...mutate },
      });
      if (res.count === 0) {
        throw new DomainException('conflict', '동시 전이 경합 — 재조회 후 재시도하세요', { from, to });
      }
      await tx.statusTransitionLog.create({
        data: {
          id: uuidv7(),
          entityType: 'live_session',
          entityId: id,
          fromStatus: from,
          toStatus: to,
          actorType: 'user',
          actorUserId: user.id,
          jobId: null,
          note: null,
          at: now,
        },
      });
    });

    this.broadcaster.emitLiveStatus({
      liveSessionId: id as never,
      from,
      to,
      at: now.toISOString(),
    });
    return this.loadOr404(id);
  }

  private assertAllowed(from: LiveSessionStatus, to: LiveSessionStatus): void {
    if (!canTransition(LIVE_SESSION_STATUS_TRANSITIONS, from, to)) {
      throw new DomainException('invalid_transition', `허용되지 않는 라이브 전이: ${from} → ${to}`, {
        from,
        to,
        allowed: nextStates(LIVE_SESSION_STATUS_TRANSITIONS, from),
      });
    }
  }

  private async centerStationId(): Promise<string> {
    const center = await this.prisma.station.findUnique({ where: { code: 'center' } });
    if (!center) {
      throw new DomainException('internal', '센터 지사(code=center)가 없습니다 — 시드 필요');
    }
    return center.id;
  }

  private rtmpUrl(id: string): string {
    const base = this.config.get('LIVE_RTMP_INGEST_URL', { infer: true }) ?? 'rtmp://live.local/ingest';
    return `${base}/${id}`;
  }

  private hlsUrl(id: string): string {
    const base = this.config.get('LIVE_HLS_PLAYBACK_URL', { infer: true }) ?? 'https://live.local/hls';
    return `${base}/${id}/index.m3u8`;
  }
}
