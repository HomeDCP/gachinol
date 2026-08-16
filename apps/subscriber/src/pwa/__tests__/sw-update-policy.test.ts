import {
  INITIAL_SW_UPDATE_STATE,
  reduceSwUpdate,
  resolveBuildId,
  resolveServiceWorkerUrl,
  SW_SCRIPT_PATH,
  type SwUpdateState,
} from '../sw-update-policy';

/**
 * 서비스워커 갱신 판정(순수 리듀서) 테스트 — T-W1-04.
 *
 * 이 스위트가 고정하는 것은 02 §D-T5 2번의 두 제약이다:
 *   ⓐ 신 버전 감지 = 알림까지(자동 적용 없음)
 *   ⓑ 재로드는 **사용자가 눌렀을 때만**(자동 강제 새로고침 금지)
 * 어느 쪽이든 깨지면 아래 테스트가 실패한다(뮤테이션 증명 대상).
 */
describe('reduceSwUpdate — 새 버전 감지', () => {
  it('제어자가 있는 상태의 waiting은 update-ready로 올라간다(= 배너 노출)', () => {
    const { state, effects } = reduceSwUpdate(INITIAL_SW_UPDATE_STATE, {
      type: 'waiting',
      hasController: true,
    });

    expect(state.status).toBe('update-ready');
    // 감지만으로는 아무것도 적용하지 않는다 — skipWaiting도 reload도 없다
    expect(effects).toEqual([]);
  });

  it('첫 설치(제어자 없음)의 waiting은 아무 일도 일으키지 않는다', () => {
    const { state, effects } = reduceSwUpdate(INITIAL_SW_UPDATE_STATE, {
      type: 'waiting',
      hasController: false,
    });

    expect(state).toEqual(INITIAL_SW_UPDATE_STATE);
    expect(effects).toEqual([]);
  });

  it('적용 중(applying)에 들어온 waiting은 상태를 되돌리지 않는다', () => {
    const applying: SwUpdateState = { status: 'applying', userAccepted: true };
    const { state } = reduceSwUpdate(applying, { type: 'waiting', hasController: true });

    expect(state.status).toBe('applying');
  });
});

describe('reduceSwUpdate — 적용은 사용자 트리거로만', () => {
  const ready: SwUpdateState = { status: 'update-ready', userAccepted: false };

  it('사용자가 눌러야 skip-waiting이 나간다', () => {
    const { state, effects } = reduceSwUpdate(ready, { type: 'user-accepted' });

    expect(effects).toEqual(['skip-waiting']);
    expect(state).toEqual({ status: 'applying', userAccepted: true });
  });

  it('대기 중인 버전이 없으면 누름을 무시한다(헛된 skipWaiting 금지)', () => {
    const { state, effects } = reduceSwUpdate(INITIAL_SW_UPDATE_STATE, { type: 'user-accepted' });

    expect(effects).toEqual([]);
    expect(state).toEqual(INITIAL_SW_UPDATE_STATE);
  });

  it('감지(waiting)만으로는 skip-waiting이 절대 나가지 않는다', () => {
    const detected = reduceSwUpdate(INITIAL_SW_UPDATE_STATE, {
      type: 'waiting',
      hasController: true,
    });

    expect(detected.effects).not.toContain('skip-waiting');
  });
});

describe('reduceSwUpdate — 자동 강제 새로고침 금지(02 §D-T5 2번)', () => {
  it('사용자 확인 없이 제어자가 바뀌어도 재로드하지 않는다', () => {
    // 첫 설치의 clients.claim()이나 **다른 탭**이 적용한 갱신이 이 경로로 온다.
    // 시청 중인 탭이 남의 조작으로 갈아엎히면 안 된다.
    const { effects } = reduceSwUpdate(INITIAL_SW_UPDATE_STATE, { type: 'controller-changed' });

    expect(effects).toEqual([]);
  });

  it('update-ready 상태에서도(아직 누르지 않았다) 제어자 교체는 재로드가 아니다', () => {
    const ready: SwUpdateState = { status: 'update-ready', userAccepted: false };
    const { effects } = reduceSwUpdate(ready, { type: 'controller-changed' });

    expect(effects).toEqual([]);
  });

  it('사용자가 누른 뒤의 제어자 교체에서만 재로드한다', () => {
    const accepted: SwUpdateState = { status: 'applying', userAccepted: true };
    const { effects } = reduceSwUpdate(accepted, { type: 'controller-changed' });

    expect(effects).toEqual(['reload']);
  });

  it('감지 → 누름 → 제어자 교체 전 구간에서 reload는 마지막 한 번뿐이다', () => {
    let state = INITIAL_SW_UPDATE_STATE;
    const seen: string[] = [];
    for (const event of [
      { type: 'waiting', hasController: true },
      { type: 'controller-changed' },
      { type: 'user-accepted' },
      { type: 'controller-changed' },
    ] as const) {
      const result = reduceSwUpdate(state, event);
      state = result.state;
      seen.push(...result.effects);
    }

    expect(seen).toEqual(['skip-waiting', 'reload']);
  });
});

describe('resolveBuildId — Expo 해시 캐시버스팅 소비', () => {
  it('실제 export 산출물의 엔트리 스크립트에서 해시를 뽑는다', () => {
    // 실측 형태: `pnpm --filter @gachinol/subscriber exec expo export --platform web` 후
    // dist/index.html의 <script src> 그대로(해시값 자체는 빌드마다 달라진다 — 여기서 고정하는 것은
    // **파일명 규약**이다. Expo가 이 규약을 바꾸면 이 테스트가 먼저 깨져야 한다).
    const sources = ['/_expo/static/js/web/entry-683b097fb9f4b20ca849cac1bd7b5f25.js'];

    expect(resolveBuildId(sources)).toBe('683b097fb9f4b20ca849cac1bd7b5f25');
  });

  it('다른 스크립트가 섞여 있어도 엔트리 번들만 고른다', () => {
    expect(
      resolveBuildId(['/some/vendor.js', '/_expo/static/js/web/entry-0123456789abcdef.js']),
    ).toBe('0123456789abcdef');
  });

  it('개발 서버 엔트리(해시 없음)에서는 null', () => {
    expect(resolveBuildId(['/index.bundle?platform=web&dev=true&hot=false'])).toBeNull();
    expect(resolveBuildId([])).toBeNull();
  });
});

describe('resolveServiceWorkerUrl — 배포마다 달라지는 등록 URL', () => {
  it('빌드 해시를 쿼리로 실어 스크립트 URL을 바꾼다(갱신 감지의 유일한 트리거)', () => {
    expect(resolveServiceWorkerUrl('abc123def456')).toBe('/sw.js?v=abc123def456');
  });

  it('루트 스코프를 잡으려면 경로가 오리진 루트여야 한다', () => {
    // `/sw.js`가 아니면 SW는 자기 위쪽(`/watch/:id` 등)을 제어할 수 없다.
    expect(SW_SCRIPT_PATH).toBe('/sw.js');
    expect(resolveServiceWorkerUrl('x'.repeat(8))?.startsWith('/sw.js?')).toBe(true);
  });

  it('해시가 없으면 null — 등록하지 않는다(개발 서버 캐시 함정 회피)', () => {
    expect(resolveServiceWorkerUrl(null)).toBeNull();
  });
});
