import { Injectable } from '@nestjs/common';
import type { Paginated, Station } from '@gachinol/shared';
import { Prisma } from '@prisma/client';
import { DomainException } from '../common/errors/domain.exception';
import { newId } from '../common/ids';
import { toPaginated, toSkipTake } from '../common/pagination/pagination.util';
import { PrismaService } from '../prisma/prisma.service';
import type {
  CreateStationDto,
  StationListQueryDto,
  UpdateStationDto,
} from './schemas/station.schemas';
import { toStation } from './station.mapper';

@Injectable()
export class StationsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: StationListQueryDto): Promise<Paginated<Station>> {
    const where: Prisma.StationWhereInput = {
      ...(query.kind ? { kind: query.kind } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const [totalCount, rows] = await this.prisma.$transaction([
      this.prisma.station.count({ where }),
      this.prisma.station.findMany({
        where,
        orderBy: { sortOrder: 'asc' }, // "한 화면에서 전 지사 나열" 기본 정렬
        ...toSkipTake(query),
      }),
    ]);
    return toPaginated(rows.map(toStation), totalCount, query);
  }

  async get(id: string): Promise<Station> {
    const row = await this.prisma.station.findUnique({ where: { id } });
    if (!row) throw new DomainException('not_found', '지사를 찾을 수 없습니다');
    return toStation(row);
  }

  async create(dto: CreateStationDto): Promise<Station> {
    try {
      const row = await this.prisma.station.create({
        data: {
          id: newId(),
          code: dto.code,
          name: dto.name,
          kind: dto.kind,
          status: 'planned', // 신규 지사는 설립 예정부터 — planned→operating 전이로 개국
          region: dto.region,
          description: dto.description ?? null,
          thumbnailUrl: dto.thumbnailUrl ?? null,
          sortOrder: dto.sortOrder,
          foundedAt: dto.foundedAt ? new Date(dto.foundedAt) : null,
        },
      });
      return toStation(row);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        // code 중복 또는 단일 센터 partial unique index 위반
        throw new DomainException('conflict', '지사 code 중복 또는 센터 중복입니다');
      }
      throw e;
    }
  }

  async update(id: string, dto: UpdateStationDto): Promise<Station> {
    const existing = await this.prisma.station.findUnique({ where: { id } });
    if (!existing) throw new DomainException('not_found', '지사를 찾을 수 없습니다');

    const row = await this.prisma.station.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.region !== undefined ? { region: dto.region } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.thumbnailUrl !== undefined ? { thumbnailUrl: dto.thumbnailUrl } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
        ...(dto.foundedAt !== undefined ? { foundedAt: new Date(dto.foundedAt) } : {}),
      },
    });
    return toStation(row);
  }
}
