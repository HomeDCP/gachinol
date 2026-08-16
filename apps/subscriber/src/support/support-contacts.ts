import { getSupportTelHref } from '../config/env';

/**
 * 문의하기 페이지의 연락 채널 해석 (T-W1-09 · 06 §F-6).
 *
 * ── 수신처 판정: **센터**다(지사가 아니다) ─────────────────────────────────────
 * 며칠 전 T-W2-28(대장 #127)이 `Station`에 `supportTel`·`youtubeUrl`을 붙이고
 * `src/features/stations/contact.ts`에 "서버 값 우선 · env 폴백"을 넣었다. 그래서 이 화면도 그
 * 지사별 값을 써야 하는지 판단이 필요했고, 결론은 **쓰지 않는다**이다. 근거:
 *
 *  1. 06 §B 소통창구 라우팅 다이어그램이 채널별 수신자를 명시한다 — "센터 카톡 채널 / 전화 ──→
 *     센터 운영자", "대표 이메일 ──→ 센터 운영자". 반면 **지사 담당자 직통 전화**는 그 용도가
 *     06 §A에 못박혀 있다: "03 §A-6 재생 실패 폴백 화면 · §B-3 리플렛 안내 번호로 발주" 겸
 *     "출연자·라이브커머스 판매자 전용 창구". 문의하기 페이지는 그 발주 목록에 없다.
 *  2. 06 §F-2("대표번호 개통·운영시간 공지 — **웹앱 푸터·FAQ에 게시**")와 §F-20("대표 이메일 계정
 *     개통 + **웹앱 '문의하기'·FAQ에 게시**")가 웹앱에 게시할 대상을 대표번호·대표 이메일로 지정한다.
 *  3. 구조적으로도 이 페이지는 **지사를 특정할 수 없는 정적 라우트**다(콘텐츠·지사 컨텍스트 없이 URL로
 *     직접 진입). `contact.ts`가 "env는 지사를 특정할 수 없는 화면의 최후 수단"이라 적어 둔 바로 그
 *     경우이며, 여기서 임의의 지사 번호를 골라 보여주면 엉뚱한 담당자에게 전화가 간다.
 *
 * 그래서 `usePublicStations()`를 부르지 않는다 — 이 화면은 네트워크 호출 0회다(정적 페이지).
 *
 * ── 값의 공급원 ──────────────────────────────────────────────────────────────
 * 셋 다 앱 env(`EXPO_PUBLIC_*`, 번들 인라인 공개 값). 전화는 **기존 키를 재사용**하고
 * (`EXPO_PUBLIC_SUPPORT_TEL` — #127 이후 이 키에 남은 역할이 정확히 "지사를 특정할 수 없는 화면이
 * 쓰는 대표 번호"다), 카톡 채널 URL·대표 이메일은 공급원이 리포에 **아예 없어** 신규 키 2개를 도입한다:
 *
 *   - 카카오 채널: `channel_accounts` 시드의 `externalChannelId`는 `kakao-aewol` 같은 **내부 식별자**라
 *     공개 채널 URL(`http://pf.kakao.com/_xxxx`)이 아니고, 공개 API(`GET /v1/feed/stations` →
 *     `StationSummary`)에도 카카오 필드가 없다. 게다가 여기 필요한 것은 지사 채널이 아니라 **센터 통합
 *     채널**(06 §F-1)이라 서버가 줄 대상 자체가 없다.
 *   - 대표 이메일: 계정 개통이 06 §F-20(센터 운영자 소유)이라 **아직 주소가 없을 수 있다**. 본 태스크는
 *     그 주소를 렌더링할 자리만 만든다.
 *
 * ── 값이 없을 때 ─────────────────────────────────────────────────────────────
 * **그 항목을 아예 렌더하지 않는다.** 흐린 버튼으로도 두지 않는다 — Wave 8a에서 "폴백 버튼 두 개가
 * 다 안 눌린다"가 실제 결함이었고, `playback-fallback.tsx`가 같은 원칙으로 고쳐졌다.
 */

/** 공백만 있는 값은 "없음"으로 본다(빈 값이 죽은 버튼을 만들지 않게) */
function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * 센터 통합 카카오톡 채널 URL — 06 §A "카카오톡 채널 1:1 채팅"(센터 통합 채널) / §F-1.
 * `http(s)://`로 시작하는 값만 인정한다: 채널 아이디(`_abcde`)만 넣어 두면 눌러도 아무 데도 안 가는
 * 죽은 링크가 되므로, 열 수 없는 값은 "없음"과 같게 취급한다.
 */
export function getKakaoChannelUrl(): string | null {
  const url = clean(process.env.EXPO_PUBLIC_KAKAO_CHANNEL_URL);
  if (!url) return null;
  return /^https?:\/\//i.test(url) ? url : null;
}

/**
 * 센터 대표 이메일 — 06 §A "대표 이메일" 행 / §F-20(계정 개통은 센터 운영자 소유).
 * `@`가 없는 값은 `mailto:`로 열 수 없으니 "없음"으로 본다(형식 검사는 여기까지 — 과잉 검증하면
 * 실제로 유효한 주소를 우리가 막게 된다).
 */
export function getSupportEmail(): string | null {
  const email = clean(process.env.EXPO_PUBLIC_SUPPORT_EMAIL);
  if (!email) return null;
  return email.includes('@') ? email : null;
}

export type SupportChannelKey = 'tel' | 'kakao' | 'email';

export interface SupportChannel {
  key: SupportChannelKey;
  /** 버튼 문구 */
  label: string;
  /** 눌렀을 때 이용자에게 보이는 실제 값(전화번호·채널 주소·이메일 주소) */
  value: string;
  /** `Linking.openURL`에 그대로 넘길 수 있는 형태 */
  href: string;
  /** 운영시간·응답 약속 안내 — 없는 응대를 있는 것처럼 보이지 않게 하는 정직 장치 */
  note: string;
}

/**
 * 설정된 채널만 골라 06 §A 채널 표 순서(전화 → 카톡 → 이메일)로 돌려준다. 순수 함수 —
 * 화면은 결과를 렌더만 한다(env 접근·판정이 화면 안에 숨으면 테스트가 못 잡는다).
 *
 * `note`의 숫자는 전부 06 §A 채널 표에서 온 것이다:
 *  - 전화(센터 대표번호): 평일 코어타임 10~12시·14~17시 즉시 / 그 외는 당일 콜백
 *  - 카카오톡 채널: 영업일 4시간 내 첫 응답
 *  - 대표 이메일: 영업일 1일 내 접수 회신
 */
export function resolveSupportChannels(input: {
  telHref: string | null;
  kakaoChannelUrl: string | null;
  email: string | null;
}): readonly SupportChannel[] {
  const channels: SupportChannel[] = [];

  const telHref = clean(input.telHref);
  if (telHref) {
    channels.push({
      key: 'tel',
      label: '전화로 문의하기',
      // 화면에는 `tel:` 접두사 없이 번호만 보여준다(종이에 받아 적는 어르신 이용자 기준)
      value: telHref.replace(/^tel:/i, ''),
      href: telHref,
      note: '평일 오전 10~12시, 오후 2~5시에 바로 받습니다. 그 밖의 시간에는 전화를 남겨 주시면 그날 안에 다시 걸어 드립니다.',
    });
  }

  const kakaoUrl = clean(input.kakaoChannelUrl);
  if (kakaoUrl) {
    channels.push({
      key: 'kakao',
      label: '카카오톡으로 문의하기',
      value: kakaoUrl,
      href: kakaoUrl,
      note: '카카오톡 채널에서 1:1 대화로 물어보실 수 있습니다. 평일 기준 4시간 안에 첫 답을 드립니다.',
    });
  }

  const email = clean(input.email);
  if (email) {
    channels.push({
      key: 'email',
      label: '이메일로 문의하기',
      value: email,
      href: `mailto:${email}`,
      note: '사진이나 서류를 함께 보내셔야 할 때, 글로 남기고 싶으실 때 이용하세요. 평일 기준 하루 안에 접수 확인을 보내 드립니다.',
    });
  }

  return channels;
}

/** 화면이 env를 직접 읽지 않도록 하는 조립 지점(테스트는 위 순수 함수를 직접 부른다) */
export function resolveSupportChannelsFromEnv(): readonly SupportChannel[] {
  return resolveSupportChannels({
    telHref: getSupportTelHref(),
    kakaoChannelUrl: getKakaoChannelUrl(),
    email: getSupportEmail(),
  });
}
