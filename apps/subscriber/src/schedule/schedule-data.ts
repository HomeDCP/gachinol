/**
 * 정적 방송 편성표 데이터 — T-W1-10 (02 §E-21, 04 §B④ "라이브 신규 진입 완화책"의 기술 전제).
 *
 * ── 왜 서버가 아니라 코드에 박혀 있는가 (이 파일의 존재 이유) ────────────────────────
 * 이 편성표는 **api를 절대 호출하면 안 된다**. 04 §B④가 이 페이지를 발주한 이유가 정확히
 * "제온(api) 다운 시 `GET /live/sessions/:id`가 죽어 라이브 **신규 진입이 0**이 되는 것"을
 * 완화하기 위해서다. 편성 데이터를 서버에서 받아오는 순간 이 페이지는 **필요한 바로 그 순간에
 * 같이 죽는다** — 즉 서버 조회는 성능 최적화의 문제가 아니라 요구사항 위반이다.
 * (`app/(tabs)/live.tsx`는 정반대다: `GET /v1/live/sessions`로 실 세션을 보여주는 동적 화면이며
 *  api가 살아 있을 때의 정상 경로다. 두 화면은 대체 관계가 아니라 **가용성 계층이 다른 이중화**다.)
 *
 * ── 값의 원천 (여기서 지어낸 편성은 하나도 없다) ────────────────────────────────
 * - `CLAUDE.md` §2 편성 원칙: 월~금 지사 현장 촬영 / 토~일 센터 라이브+녹화방송 / 긴급 즉시 라이브
 * - `docs/plan/01-product-strategy.md` §C-5 "MVP 실제 편성(애월·제주시 2지사, 격일 로테이션)" 표
 * - 회당 방송시간 2시간: 같은 문서 §C-5 "방송 시간 모수 — 단일 원천 선언(ROUND-4-DECISIONS V1)"
 *
 * ── 언제 이 파일을 고쳐야 하는가 (조건이 깨지는 시점) ───────────────────────────
 * ① 01 §C-5 MVP 표가 바뀌면 — 이 파일이 그 표의 **사본**이므로 원천이 바뀌면 즉시 동기화한다.
 * ② **M3 도달 시**: 01 §C-5 "로컬 라이브커머스 방송 슬롯" 표가 애월 목요일·제주시 금요일에
 *    라이브커머스 **방송**(월 2회 → M6부터 월 4회)을 편성한다. 지금 넣지 않은 이유는 M3 전에는
 *    그 방송이 실재하지 않아 시청자에게 거짓이 되기 때문이다(아래 상수에 정의만 두고 렌더하지
 *    않는다). **M3 도달 시 `WEEKLY_SCHEDULE`에 편입하고 이 문단을 지운다.**
 * ③ **12지사 목표 상태 전환 시**: 01 §C-5 "목표 상태(12지사 완성형)" 표로 통째 교체된다.
 * ④ **편성이 주 단위로 가변이 되면**: 그때는 정적 표만으로 부족하다. 다만 그 경우에도 **정적
 *    경로를 없애면 안 된다** — 04 §B④가 요구하는 것은 "api 없이도 신규 시청자가 진입 가능"이므로,
 *    동적 편성이 필요해지면 "정적 기본 편성 + (api 생존 시) 동적 보강"의 2층 구조로 가야 한다.
 */

/** 슬롯 종류 — 시청자가 "지금 뭘 할 수 있는지"의 구분(생방송 시청 / 새 영상 시청 / 예외) */
export type SlotKind = 'live' | 'vod' | 'emergency';

export interface ScheduleSlot {
  /**
   * 요일 — `Date.prototype.getUTCDay()` 규약(0=일 … 6=토)을 그대로 따른다.
   * KST 보정은 `schedule-clock.ts`가 담당하고 이 파일은 보정된 요일 번호만 소비한다.
   */
  readonly weekday: number;
  readonly dayLabel: string;
  readonly kind: SlotKind;
  /** 시청자용 제목 — 기술 용어 금지(03 §A 어르신 접근성 톤) */
  readonly title: string;
  /** 한 줄 설명 */
  readonly detail: string;
  /** 방송 길이 라벨. 생방송만 값이 있다(01 §C-5 V1 = 회당 2시간) */
  readonly durationLabel: string | null;
  /** 동시 송출 채널 안내. 주간뉴스 라이브만 YouTube+Facebook 동시(CLAUDE.md §3-1) */
  readonly simulcastLabel: string | null;
}

/**
 * 주간 정기 편성 — 일(0)~토(6) 7행. `weekday` 오름차순 고정(인덱스 = 요일 번호가 되도록).
 *
 * ⚠️ **시작 시각(몇 시)은 일부러 비어 있다.** 정본 어디에도 방송 시작 시각이 없다 —
 * 01 §C-5는 요일·주체·회당 길이(2시간)까지만 정하고, 04 §A SLO#2는 "편성 시각 기준 5분 이내"를
 * 판정 기준으로 쓰면서도 그 "편성 시각"을 정의하지 않는다. 지어내면 시청자에게 거짓이 되므로
 * 화면은 "시작 시각은 방송 전에 카카오톡 채널로 알려 드립니다"로 정직하게 표시한다.
 * **정본에 시각이 확정되면 이 인터페이스에 `startTimeLabel`을 추가하고 이 문단을 지운다.**
 */
export const WEEKLY_SCHEDULE: readonly ScheduleSlot[] = [
  {
    weekday: 0,
    dayLabel: '일요일',
    kind: 'live',
    title: '교양·정치인 대담 생방송',
    detail: '제주방송센터에서 진행합니다. 주에 따라 녹화방송으로 나갑니다.',
    durationLabel: '약 2시간',
    simulcastLabel: null,
  },
  {
    weekday: 1,
    dayLabel: '월요일',
    kind: 'vod',
    title: '애월 마을방송국 — 뉴스',
    detail: '마을 소식을 취재해 영상으로 올립니다.',
    durationLabel: null,
    simulcastLabel: null,
  },
  {
    weekday: 2,
    dayLabel: '화요일',
    kind: 'vod',
    title: '제주시 마을방송국 — 뉴스',
    detail: '마을 소식을 취재해 영상으로 올립니다.',
    durationLabel: null,
    simulcastLabel: null,
  },
  {
    weekday: 3,
    dayLabel: '수요일',
    kind: 'vod',
    title: '애월 마을방송국 — 교양',
    detail: '독서·요리·여행지·먹거리 등 마을 이야기를 전합니다.',
    durationLabel: null,
    simulcastLabel: null,
  },
  {
    weekday: 4,
    dayLabel: '목요일',
    kind: 'vod',
    title: '제주시 마을방송국 — 우리 마을 날씨',
    detail: '이장·어촌계장 삼춘이 직접 전하는 우리 마을 날씨 이야기입니다.',
    durationLabel: null,
    simulcastLabel: null,
  },
  {
    weekday: 5,
    dayLabel: '금요일',
    kind: 'vod',
    title: '애월 마을방송국 — 마을 장터',
    detail: '마을에서 나는 먹거리와 생산품을 소개합니다.',
    durationLabel: null,
    simulcastLabel: null,
  },
  {
    weekday: 6,
    dayLabel: '토요일',
    kind: 'live',
    title: '주간뉴스 생방송',
    detail: '한 주 동안 12개 마을방송국이 모은 소식을 제주방송센터에서 전해 드립니다.',
    durationLabel: '약 2시간',
    simulcastLabel: '유튜브·페이스북에서도 동시에 보실 수 있습니다',
  },
];

/**
 * 상시(요일 없음) 편성 — CLAUDE.md §2 "긴급(재난·위기 등): 현장 즉시 라이브",
 * 01 §C-5 표 "상시" 행("패스트트랙 즉시 라이브, 캘린더 예외").
 * 요일 표에 넣을 수 없어(요일이 없다) 별도 상수로 둔다.
 */
export const EMERGENCY_SLOT: ScheduleSlot = {
  weekday: -1,
  dayLabel: '언제든지',
  kind: 'emergency',
  title: '긴급 방송',
  detail: '태풍·재난 등 급한 일이 생기면 요일과 상관없이 바로 생방송을 시작합니다.',
  durationLabel: null,
  simulcastLabel: null,
};

/**
 * ── 아직 렌더하지 않는 편성 (위 "언제 고쳐야 하는가" ②) ──────────────────────────
 * 01 §C-5 "로컬 라이브커머스 방송 슬롯" 표가 확정한 편성이지만 **M3부터 발효**한다
 * (M3: 월 2회 격주 → M6부터 월 4회 매주). M3 전에는 실재하지 않는 방송이므로 시청자에게
 * 보여주지 않는다. **M3 도달 시 `WEEKLY_SCHEDULE`의 해당 요일에 편입한다** — 정의를 미리
 * 두는 이유는 "편입 시 무엇을 쓸지"를 그때 다시 정본을 뒤지지 않게 하기 위해서다.
 * (테스트가 이 상수가 `WEEKLY_SCHEDULE`에 **없음**을 고정한다 — 실수로 켜지면 실패한다.)
 */
export const LIVE_COMMERCE_SLOTS_PENDING_M3: readonly ScheduleSlot[] = [
  {
    weekday: 4,
    dayLabel: '목요일',
    kind: 'live',
    title: '애월 마을 장터 생방송',
    detail: '이장·어촌계장·부녀회장이 직접 마을 물건을 소개합니다.',
    durationLabel: '약 1시간',
    simulcastLabel: null,
  },
  {
    weekday: 5,
    dayLabel: '금요일',
    kind: 'live',
    title: '제주시 마을 장터 생방송',
    detail: '이장·어촌계장·부녀회장이 직접 마을 물건을 소개합니다.',
    durationLabel: '약 1시간',
    simulcastLabel: null,
  },
];
