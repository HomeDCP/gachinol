import { Injectable } from '@nestjs/common';
import type { Content as ContentRow, ChannelAccount as ChannelAccountRow } from '@prisma/client';
import { DomainException } from '../common/errors/domain.exception';
import { PrismaService } from '../prisma/prisma.service';

/**
 * 송출 대상 채널 해석 — 우선순위: body override > content.targetChannelAccountIds > 지사 기본 kakao.
 * connected 아니거나 vod_publish 미보유 채널은 제외. 0건이면 conflict(송출 대상 없음).
 */
@Injectable()
export class ChannelAccountsService {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string): Promise<ChannelAccountRow | null> {
    return this.prisma.channelAccount.findUnique({ where: { id } });
  }

  async findByIds(ids: readonly string[]): Promise<Map<string, ChannelAccountRow>> {
    if (ids.length === 0) return new Map();
    const rows = await this.prisma.channelAccount.findMany({ where: { id: { in: [...ids] } } });
    return new Map(rows.map((r) => [r.id, r]));
  }

  /**
   * 송출 가능 채널 해석. 반환은 항상 connected + vod_publish 채널만(그 외 조용히 배제).
   * @throws conflict 해석 결과 0건
   */
  async resolveTargets(
    content: ContentRow,
    overrideIds?: readonly string[],
  ): Promise<ChannelAccountRow[]> {
    const candidates = await this.candidateRows(content, overrideIds);
    const usable = candidates.filter(
      (c) => c.status === 'connected' && c.capabilities.includes('vod_publish'),
    );
    if (usable.length === 0) {
      throw new DomainException('conflict', '송출 대상 채널이 없습니다', {
        contentId: content.id,
      });
    }
    // (혹시 모를) 중복 제거 — 같은 채널 이중 송출 방지
    return dedupeById(usable);
  }

  private async candidateRows(
    content: ContentRow,
    overrideIds?: readonly string[],
  ): Promise<ChannelAccountRow[]> {
    // ① body override 우선
    if (overrideIds && overrideIds.length > 0) {
      const map = await this.findByIds(overrideIds);
      // 명시 지정한 채널이 부재하면 조용히 제외(존재분만)
      return overrideIds.map((id) => map.get(id)).filter((r): r is ChannelAccountRow => r != null);
    }
    // ② content.targetChannelAccountIds
    if (content.targetChannelAccountIds.length > 0) {
      const map = await this.findByIds(content.targetChannelAccountIds);
      return content.targetChannelAccountIds
        .map((id) => map.get(id))
        .filter((r): r is ChannelAccountRow => r != null);
    }
    // ③ 기본 규칙 — 콘텐츠 소속 지사의 connected kakao(vod_publish) 채널
    return this.prisma.channelAccount.findMany({
      where: {
        stationId: content.stationId,
        platform: 'kakao',
        status: 'connected',
      },
    });
  }
}

const dedupeById = (rows: readonly ChannelAccountRow[]): ChannelAccountRow[] => {
  const seen = new Set<string>();
  const out: ChannelAccountRow[] = [];
  for (const r of rows) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(r);
  }
  return out;
};
