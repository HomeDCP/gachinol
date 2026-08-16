/**
 * 서비스워커 갱신 판정 — **순수 함수·순수 리듀서만** (T-W1-04, 02 §D-T5 "서비스워커 갱신·캐시 무효화 정책").
 *
 * 브라우저 API(`navigator.serviceWorker`·`location`·`document`)를 여기서 만지지 않는다. 실 API를 만지는
 * 얇은 껍데기는 `register-service-worker.web.ts`이고, 이 파일과 `sw-controller.ts`가 **판정 전부**를 갖는다
 * — Wave 8a에서 세 번 반복된 "화면·브라우저 계층에 로직을 쓰면 조용히 무보호가 된다"를 구조적으로 막는다.
 *
 * ── 정본과의 관계(중요, 완료 보고 ⑥에 함께 올린 사항) ─────────────────────────────────────
 * 02 §D-T5 2번 문언은 "신규 서비스워커 감지 시 `self.skipWaiting()` + `clients.claim()`으로 **대기 없이
 * 즉시 활성화**하고 … 자동 강제 새로고침은 금지 — 사용자 트리거로만 재로드"라고 적혀 있다. 이 두 문장은
 * 그대로는 양립하지 않는다:
 *   - 설치 시점에 무조건 `skipWaiting()`을 부르면 새 SW가 즉시 활성화되면서 **열려 있는 탭은 구 번들을
 *     실행한 채 신 SW의 제어를 받는다**. 신 SW의 `activate`는 구 버전 캐시를 청소하므로, 구 번들이 나중에
 *     요청하는 해시 자산이 사라져 화면이 조용히 깨진다(버전 스큐).
 *   - 이 앱은 **영상 시청 중 이탈이 치명적**이라 자동 새로고침으로 덮을 수도 없다.
 * 따라서 `skipWaiting`은 **사용자 확인 뒤에** 부른다 — "대기 없이 즉시"의 의도(구버전 고착 방지)는
 * "대기 상태를 감지하는 즉시 사용자에게 알리고, 사용자가 누르면 즉시 적용"으로 만족한다. `clients.claim()`은
 * 그대로 SW의 `activate`에서 부른다(정본 문언 유지 — 활성화된 SW가 기존 탭을 즉시 제어).
 */

/** SW 갱신 상태 — 화면(배너)은 이 값만 본다 */
export type SwUpdateStatus =
  /** 대기 중인 신 버전 없음 */
  | 'idle'
  /** 신 버전이 waiting 상태 — 사용자에게 알린다(자동 적용 금지) */
  | 'update-ready'
  /** 사용자가 적용을 눌러 skipWaiting을 보냈고 제어권 교체를 기다리는 중 */
  | 'applying';

export interface SwUpdateState {
  readonly status: SwUpdateStatus;
  /** 사용자가 명시적으로 적용을 눌렀는가 — **재로드의 유일한 근거** */
  readonly userAccepted: boolean;
}

export const INITIAL_SW_UPDATE_STATE: SwUpdateState = { status: 'idle', userAccepted: false };

export type SwUpdateEvent =
  /** 신 SW가 waiting 상태가 됐다. `hasController`=현재 페이지를 제어 중인 SW가 이미 있는가 */
  | { readonly type: 'waiting'; readonly hasController: boolean }
  /** 사용자가 "새로고침"을 눌렀다 */
  | { readonly type: 'user-accepted' }
  /** `navigator.serviceWorker.controller`가 교체됐다(controllerchange / workbox `controlling`) */
  | { readonly type: 'controller-changed' };

/** 리듀서가 껍데기에게 시키는 부수효과 — 껍데기는 이 목록 그대로만 실행한다 */
export type SwUpdateEffect = 'skip-waiting' | 'reload';

export interface SwUpdateResult {
  readonly state: SwUpdateState;
  readonly effects: readonly SwUpdateEffect[];
}

const NO_EFFECTS: readonly SwUpdateEffect[] = [];

/**
 * 갱신 상태 전이 — 이 함수가 "자동 강제 새로고침 금지"(02 §D-T5 2번)의 **유일한 시행 지점**이다.
 *
 * 고정하는 불변식 3가지:
 *  ① `waiting`은 절대 `skip-waiting`·`reload`를 내지 않는다 — 감지는 알림까지만.
 *  ② `skip-waiting`은 오직 `user-accepted`에서만 나온다.
 *  ③ `reload`는 오직 `userAccepted === true`인 상태의 `controller-changed`에서만 나온다.
 *     (첫 설치의 `clients.claim()`이나 **다른 탭**이 적용한 갱신도 `controller-changed`를 발생시킨다 —
 *      여기서 무조건 재로드하면 시청 중인 탭이 남의 조작으로 갈아엎힌다.)
 */
export function reduceSwUpdate(state: SwUpdateState, event: SwUpdateEvent): SwUpdateResult {
  switch (event.type) {
    case 'waiting': {
      // 첫 설치(제어자 없음)에는 "새 버전"이 존재하지 않는다 — 알릴 것도, 적용할 것도 없다.
      if (!event.hasController) return { state, effects: NO_EFFECTS };
      if (state.status === 'applying') return { state, effects: NO_EFFECTS };
      return { state: { ...state, status: 'update-ready' }, effects: NO_EFFECTS };
    }
    case 'user-accepted': {
      // 대기 중인 버전이 없을 때의 누름은 무시(연타·경합 방지) — skipWaiting을 헛되이 보내지 않는다.
      if (state.status !== 'update-ready') return { state, effects: NO_EFFECTS };
      return { state: { status: 'applying', userAccepted: true }, effects: ['skip-waiting'] };
    }
    case 'controller-changed': {
      if (!state.userAccepted) return { state, effects: NO_EFFECTS };
      return { state, effects: ['reload'] };
    }
    /* istanbul ignore next — 유니온 전수 처리 확인용 */
    default:
      return { state, effects: NO_EFFECTS };
  }
}

/**
 * 대기 중인 SW에 보내는 메시지 — `public/sw.js`의 `message` 핸들러와 **문자열이 일치해야 한다**.
 * workbox-window의 `messageSkipWaiting()`이 보내는 값과 동일(`{type:'SKIP_WAITING'}`)이며,
 * 여기서는 계약을 눈에 보이게 고정하고 테스트가 sw.js와 대조할 수 있게 상수로 둔다.
 */
export const SW_SKIP_WAITING_MESSAGE = { type: 'SKIP_WAITING' } as const;

/** 등록 대상 서비스워커 스크립트 경로 — 루트 스코프(`/`)를 잡으려면 반드시 오리진 루트여야 한다 */
export const SW_SCRIPT_PATH = '/sw.js';

/**
 * Expo Web 정적 산출물의 엔트리 번들 파일명에서 **콘텐츠 해시**를 뽑는다.
 *
 * 실측(`pnpm --filter @gachinol/subscriber exec expo export --platform web`, 2026-08-16):
 *   `dist/index.html` → `<script src="/_expo/static/js/web/entry-<32자리 해시>.js" defer>`
 *   (해시값 자체는 빌드마다 바뀌므로 여기 박제하지 않는다 — 규약 확인은 위 명령 재실행)
 * 즉 **해시 캐시버스팅(02 §D-T5 1번)은 Expo가 이미 제공한다** — 이 태스크가 새로 구현할 것이 아니라
 * 여기서 **소비**할 사실이다.
 *
 * 왜 이 해시가 필요한가(이 파일 전체에서 가장 중요한 판단):
 *   `public/sw.js`는 Expo가 **바이트 그대로** 산출물 루트에 복사한다(빌드 시점 주입 단계 없음 —
 *   `infra/docker/Dockerfile.web`이 `expo export`를 직접 호출해 후처리 훅을 걸 자리가 없다).
 *   그래서 sw.js의 내용은 **배포마다 동일**하고, 브라우저의 갱신 검사는 바이트 비교라 신 버전을
 *   **영원히 감지하지 못한다** — 토스트도 skipWaiting도 영원히 안 뜬다. 등록 URL에 이 해시를 실어
 *   (`/sw.js?v=<hash>`) 배포마다 스크립트 URL이 달라지게 만드는 것이 후처리 단계 없이 갱신을
 *   성립시키는 유일한 방법이다. 해시 캐시버스팅이 SW 갱신의 **전제**라는 정본 서술이 여기서
 *   문자 그대로 작동한다.
 *
 * @param scriptSources 문서의 `<script src>` 값들(순서 무관)
 * @returns 해시 문자열, 못 찾으면 null
 */
export function resolveBuildId(scriptSources: readonly string[]): string | null {
  for (const src of scriptSources) {
    // 쿼리·오리진이 붙어 있어도 경로 부분만 본다
    const match = /\/_expo\/static\/js\/[^/]+\/[^/?#]*?-([0-9a-f]{8,})\.js(?:[?#]|$)/.exec(src);
    if (match?.[1]) return match[1];
  }
  return null;
}

/**
 * 등록할 SW 스크립트 URL. 빌드 해시가 없으면 **null** — 등록하지 않는다는 뜻이다.
 *
 * null이 되는 경우 = `expo start --web` 개발 서버(엔트리가 `/index.bundle?platform=web…`이라 해시가 없다).
 * 개발 중 SW 등록은 개발 자산을 캐시해 "고쳐도 안 바뀐다"를 만드는 대표적 함정이고, 해시가 없으면
 * 위 갱신 감지도 성립하지 않는다 — 두 이유가 같은 방향이라 **해시 부재 = 등록 안 함**으로 통일한다.
 */
export function resolveServiceWorkerUrl(buildId: string | null): string | null {
  if (!buildId) return null;
  return `${SW_SCRIPT_PATH}?v=${buildId}`;
}

/** 새 버전 알림 문구 — 03 어르신 톤(기술 용어 금지). 배너와 테스트가 공유하는 단일 원천 */
export const SW_UPDATE_NOTICE = {
  message: '새 버전이 준비됐어요.',
  action: '새로고침',
} as const;
