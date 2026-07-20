import type { CreateUserRequest, StationId, UpdateUserRequest } from '@gachinol/shared';
import { UserRole, UserStatus } from '@gachinol/shared';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { zEnum, zId, zPage } from '../../common/zod';
import type { ZodSchemaOf } from '../../common/zod';

export const zCreateUser = z
  .object({
    role: zEnum(UserRole),
    name: z.string().min(1).max(100),
    email: z.string().email().max(320),
    /** 초기 비밀번호 — 전송 전용 */
    password: z.string().min(8).max(200),
    phone: z.string().max(30).optional(),
    stationId: zId<StationId>().optional(),
  })
  .superRefine((v, ctx) => {
    // shared ReporterUser 불변식 — 기자는 소속 지사 필수
    if (v.role === 'reporter' && !v.stationId) {
      ctx.addIssue({
        code: 'custom',
        path: ['stationId'],
        message: "role='reporter'는 stationId 필수",
      });
    }
  }) satisfies ZodSchemaOf<CreateUserRequest>;

export const zUpdateUser = z.object({
  name: z.string().min(1).max(100).optional(),
  phone: z.string().max(30).optional(),
  profileImageUrl: z.string().url().max(2000).optional(),
  status: zEnum(UserStatus).optional(),
  stationId: zId<StationId>().optional(),
}) satisfies ZodSchemaOf<UpdateUserRequest>;

/** UserListQuery — page 기본값·clamp는 zPage */
export const zUserListQuery = zPage.extend({
  role: zEnum(UserRole).optional(),
  stationId: zId<StationId>().optional(),
  status: zEnum(UserStatus).optional(),
});

export class CreateUserDto extends createZodDto(zCreateUser) {}
export class UpdateUserDto extends createZodDto(zUpdateUser) {}
export class UserListQueryDto extends createZodDto(zUserListQuery) {}
