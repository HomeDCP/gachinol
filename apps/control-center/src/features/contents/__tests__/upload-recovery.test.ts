import { formatUploadRecoverWait } from '../upload-recovery';

/**
 * formatUploadRecoverWait (대장 #224) — 서버 409 `details.elapsedMs`·`stuckMs`를 사람이 읽는
 * 대기 안내문으로 바꾸는 순수 함수. 임계값(30분) 자체는 여기서 재현하지 않는다 — 서버가 보낸
 * 두 숫자를 뺄셈만 한다(설계 근거는 upload-recovery.ts 헤더 주석).
 */
describe('formatUploadRecoverWait', () => {
  it('elapsedMs·stuckMs가 없으면 null (다른 종류의 409 — 예: 다른 상태로 전이됨)', () => {
    expect(formatUploadRecoverWait(undefined)).toBeNull();
    expect(formatUploadRecoverWait({})).toBeNull();
    expect(formatUploadRecoverWait({ status: 'uploaded' })).toBeNull();
  });

  it('숫자가 아니면 null (형태 방어)', () => {
    expect(formatUploadRecoverWait({ elapsedMs: '100', stuckMs: 1_800_000 })).toBeNull();
    expect(formatUploadRecoverWait({ elapsedMs: 100, stuckMs: null })).toBeNull();
    expect(formatUploadRecoverWait({ elapsedMs: NaN, stuckMs: 1_800_000 })).toBeNull();
    expect(formatUploadRecoverWait({ elapsedMs: 100, stuckMs: Infinity })).toBeNull();
  });

  it('기본 임계(30분) 진입 직후 — 약 30분 남음', () => {
    expect(formatUploadRecoverWait({ elapsedMs: 0, stuckMs: 1_800_000 })).toBe(
      '아직 업로드가 진행 중일 수 있습니다 — 약 30분 후 다시 시도해 주세요.',
    );
  });

  it('경계값 — 남은 시간이 1ms여도 최소 1분으로 올림(0분 표기 방지)', () => {
    expect(formatUploadRecoverWait({ elapsedMs: 1_799_999, stuckMs: 1_800_000 })).toBe(
      '아직 업로드가 진행 중일 수 있습니다 — 약 1분 후 다시 시도해 주세요.',
    );
  });

  it('경계값 — 정확히 임계 도달(remaining=0)이면 일반 재시도 문구(서버가 이미 통과시켰을 상황)', () => {
    expect(formatUploadRecoverWait({ elapsedMs: 1_800_000, stuckMs: 1_800_000 })).toBe(
      '아직 업로드가 진행 중일 수 있습니다 — 잠시 후 다시 시도해 주세요.',
    );
  });

  it('경계값 — 임계 초과(remaining<0)도 같은 일반 문구 (음수 분 표기 방지)', () => {
    expect(formatUploadRecoverWait({ elapsedMs: 1_800_001, stuckMs: 1_800_000 })).toBe(
      '아직 업로드가 진행 중일 수 있습니다 — 잠시 후 다시 시도해 주세요.',
    );
  });

  it('올림 — 61초 남으면 2분으로 올린다(내림으로 과소 안내 금지)', () => {
    expect(formatUploadRecoverWait({ elapsedMs: 1_800_000 - 61_000, stuckMs: 1_800_000 })).toBe(
      '아직 업로드가 진행 중일 수 있습니다 — 약 2분 후 다시 시도해 주세요.',
    );
  });
});
