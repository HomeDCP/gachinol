import type {
  CenterStaffUser,
  ReporterUser,
  StationId,
  SubscriberUser,
  User,
  UserId,
  UserStatus,
} from '@gachinol/shared';
import { toId } from '@gachinol/shared';
import type { User as UserRow } from '@prisma/client';
import { DomainException } from '../common/errors/domain.exception';

/**
 * row → shared User (role 판별 유니언 복원). 경계 캐스팅의 유일 지점.
 * passwordHash는 어떤 매퍼도 통과 못 한다 — shared User에 필드 자체가 없음(타입이 누출 차단).
 */
export const toUser = (row: UserRow): User => {
  const base = {
    id: toId<UserId>(row.id),
    name: row.name,
    email: row.email ?? undefined,
    phone: row.phone ?? undefined,
    profileImageUrl: row.profileImageUrl ?? undefined,
    status: row.status as UserStatus,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };

  switch (row.role) {
    case 'reporter': {
      if (!row.stationId) {
        // 데이터 불변식 위반 — 기자는 소속 지사 필수
        throw new DomainException(
          'internal',
          '데이터 불변식 위반: 기자 계정에 소속 지사가 없습니다',
          {
            userId: row.id,
          },
        );
      }
      const user: ReporterUser = {
        ...base,
        role: 'reporter',
        stationId: toId<StationId>(row.stationId),
      };
      return user;
    }
    case 'center_operator':
    case 'announcer':
    case 'admin': {
      const user: CenterStaffUser = {
        ...base,
        role: row.role,
        stationId: row.stationId ? toId<StationId>(row.stationId) : undefined,
      };
      return user;
    }
    case 'subscriber': {
      const user: SubscriberUser = { ...base, role: 'subscriber' };
      return user;
    }
    default:
      throw new DomainException('internal', `알 수 없는 role: ${row.role}`, { userId: row.id });
  }
};
