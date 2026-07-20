import { Injectable } from '@nestjs/common';
import type { StationStatus, User } from '@gachinol/shared';
import { canTransition, nextStates, STATION_STATUS_TRANSITIONS } from '@gachinol/shared';
import type { Station as StationRow } from '@prisma/client';
import { v7 as uuidv7 } from 'uuid';
import { DomainException } from '../common/errors/domain.exception';
import { PrismaService } from '../prisma/prisma.service';

/**
 * 지사 상태 전이 — shared STATION_STATUS_TRANSITIONS가 유일한 진실 + CAS + 감사 로그.
 * dormant→operating이 MVP "애월·제주시 부활"의 실체.
 * (ContentWorkflowService와 골격이 같지만 제네릭 추출은 과설계 — 3번째 엔티티에서 공용화 검토)
 */
@Injectable()
export class StationWorkflowService {
  constructor(private readonly prisma: PrismaService) {}

  async transition(
    stationId: string,
    to: StationStatus,
    actor: User,
    note?: string,
  ): Promise<StationRow> {
    const station = await this.prisma.station.findUnique({ where: { id: stationId } });
    if (!station) throw new DomainException('not_found', '지사를 찾을 수 없습니다');

    const from = station.status as StationStatus;
    if (!canTransition(STATION_STATUS_TRANSITIONS, from, to)) {
      throw new DomainException(
        'invalid_transition',
        `허용되지 않는 지사 상태 전이: ${from} → ${to}`,
        {
          from,
          to,
          allowed: nextStates(STATION_STATUS_TRANSITIONS, from),
        },
      );
    }

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      // 낙관적 CAS — affected 0이면 동시 경합
      const res = await tx.station.updateMany({
        where: { id: stationId, status: from },
        data: {
          status: to,
          // 상태별 효과: dormant 진입 시각 토글
          dormantSince: to === 'dormant' ? now : null,
        },
      });
      if (res.count === 0) {
        throw new DomainException('conflict', '동시 전이 경합 — 재조회 후 재시도하세요', {
          from,
          to,
        });
      }
      await tx.statusTransitionLog.create({
        data: {
          id: uuidv7(),
          entityType: 'station',
          entityId: stationId,
          fromStatus: from,
          toStatus: to,
          actorType: 'user',
          actorUserId: actor.id,
          jobId: null,
          note: note ?? null,
          at: now,
        },
      });
    });

    return this.prisma.station.findUniqueOrThrow({ where: { id: stationId } });
  }
}
