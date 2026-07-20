import { Injectable } from '@nestjs/common';
import type { Paginated, User } from '@gachinol/shared';
import { Prisma } from '@prisma/client';
import * as argon2 from 'argon2';
import { ARGON2_OPTIONS } from '../auth/argon2.options';
import { DomainException } from '../common/errors/domain.exception';
import { newId } from '../common/ids';
import { toPaginated, toSkipTake } from '../common/pagination/pagination.util';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateUserDto, UpdateUserDto, UserListQueryDto } from './schemas/user.schemas';
import { toUser } from './user.mapper';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: UserListQueryDto): Promise<Paginated<User>> {
    const where: Prisma.UserWhereInput = {
      ...(query.role ? { role: query.role } : {}),
      ...(query.stationId ? { stationId: query.stationId } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const [totalCount, rows] = await this.prisma.$transaction([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({ where, orderBy: { createdAt: 'desc' }, ...toSkipTake(query) }),
    ]);
    return toPaginated(rows.map(toUser), totalCount, query);
  }

  async create(dto: CreateUserDto): Promise<User> {
    if (dto.stationId) await this.ensureStationExists(dto.stationId);

    const passwordHash = await argon2.hash(dto.password, ARGON2_OPTIONS);
    try {
      const row = await this.prisma.user.create({
        data: {
          id: newId(),
          role: dto.role,
          name: dto.name,
          email: dto.email.trim().toLowerCase(), // 저장·조회 모두 lowercase 정규화
          phone: dto.phone ?? null,
          status: 'active',
          stationId: dto.stationId ?? null,
          passwordHash,
        },
      });
      return toUser(row);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new DomainException('conflict', '이미 사용 중인 이메일입니다');
      }
      throw e;
    }
  }

  async get(id: string): Promise<User> {
    const row = await this.prisma.user.findUnique({ where: { id } });
    if (!row) throw new DomainException('not_found', '사용자를 찾을 수 없습니다');
    return toUser(row);
  }

  async update(id: string, dto: UpdateUserDto): Promise<User> {
    const existing = await this.prisma.user.findUnique({ where: { id } });
    if (!existing) throw new DomainException('not_found', '사용자를 찾을 수 없습니다');
    if (dto.stationId) await this.ensureStationExists(dto.stationId);

    const row = await this.prisma.user.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
        ...(dto.profileImageUrl !== undefined ? { profileImageUrl: dto.profileImageUrl } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        ...(dto.stationId !== undefined ? { stationId: dto.stationId } : {}),
      },
    });
    return toUser(row);
  }

  private async ensureStationExists(stationId: string): Promise<void> {
    const station = await this.prisma.station.findUnique({ where: { id: stationId } });
    if (!station) {
      throw new DomainException('not_found', '지사를 찾을 수 없습니다', { stationId });
    }
  }
}
