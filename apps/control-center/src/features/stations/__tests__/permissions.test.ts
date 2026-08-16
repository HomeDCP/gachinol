import { UserRole } from '@gachinol/shared';
import { canManageStations, canTransitionStation } from '../permissions';

/**
 * 원천: services/api/src/stations/stations.controller.ts
 *   transitions → @Roles('admin','center_operator') / create·update → @Roles('admin')
 * 두 술어가 같아지는 순간 센터 운영자에게 "누르면 403" 버튼이 생긴다 → 여기서 고정한다.
 */

describe('canTransitionStation — 전이는 center_operator·admin', () => {
  it('center_operator는 전이할 수 있다', () => {
    expect(canTransitionStation(UserRole.CenterOperator)).toBe(true);
  });
  it('admin은 수퍼롤이라 전이할 수 있다', () => {
    expect(canTransitionStation(UserRole.Admin)).toBe(true);
  });
  it.each([UserRole.Reporter, UserRole.Announcer, UserRole.Subscriber])(
    '%s는 전이할 수 없다',
    (role) => {
      expect(canTransitionStation(role)).toBe(false);
    },
  );
});

describe('canManageStations — 생성·수정은 admin 전용', () => {
  it('admin만 true', () => {
    expect(canManageStations(UserRole.Admin)).toBe(true);
  });

  /** 이 한 줄이 무너지면 센터 운영자 화면에 403 지뢰 버튼이 생긴다 */
  it('center_operator는 false — 전이 권한과 관리 권한이 다르다', () => {
    expect(canManageStations(UserRole.CenterOperator)).toBe(false);
  });

  it.each([UserRole.Reporter, UserRole.Announcer, UserRole.Subscriber])(
    '%s는 false',
    (role) => {
      expect(canManageStations(role)).toBe(false);
    },
  );
});

describe('두 권한은 서로 다른 술어다', () => {
  it('center_operator에서 전이=허용 / 관리=차단으로 갈린다', () => {
    expect(canTransitionStation(UserRole.CenterOperator)).toBe(true);
    expect(canManageStations(UserRole.CenterOperator)).toBe(false);
  });
});
