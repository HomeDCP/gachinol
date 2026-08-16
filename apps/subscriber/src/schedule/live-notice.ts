/**
 * 방송별 직접 시청 URL 게시 — **04 §B④ "라이브 신규 진입 완화책"의 실제 알맹이**.
 *
 * ── 이게 왜 필요한가 ─────────────────────────────────────────────────────────
 * 04 §B④ 원문: "방송 시작 시 CF Stream이 발급한 HLS URL을 카톡 공지·웹앱 정적 배너(방송 편성표
 * 페이지, 정적 자산이라 api 무관 생존)에 **직접 포함**해 두면, `GET /live/sessions/:id` 없이도
 * 신규 시청자가 URL을 확보할 수 있다 — 담당: 센터 운영(공지 게시), 트리거: 헬스체크 3회 연속 실패".
 * 즉 이 값은 **서버에서 받아오면 안 된다**(받아올 수 있는 상황이면 완화책이 필요 없다).
 *
 * ── 왜 build-time env인가 ────────────────────────────────────────────────────
 * "api를 안 거치고 값을 페이지에 넣는" 방법은 결국 **빌드 시점 주입**뿐이다. `EXPO_PUBLIC_*`는
 * 번들에 인라인되므로(런타임 env 아님 — `infra/docker/Dockerfile.web` 55행 주석) 센터 운영이
 * 방송 시작 시 값을 넣고 웹을 재배포하면 페이지에 URL이 박힌다. 이 게시 절차 자체는
 * **T-NC-14**(02 §E-21의 "센터 운영(방송별 URL 게시 절차)" 몫)가 소유한다.
 * 기존 선례와 동형이다(`src/config/env.ts`의 `EXPO_PUBLIC_SUPPORT_TEL`·`EXPO_PUBLIC_LIVE_YOUTUBE_URL`).
 *
 * ⚠️ **알려진 미배선**: `infra/docker/Dockerfile.web`과 `.github/workflows/deploy-web.yml`은 현재
 * `EXPO_PUBLIC_API_URL` **하나만** build-arg로 전달한다. 아래 두 변수를 실제로 주입하려면 그 두
 * 파일에 build-arg 추가가 필요한데 둘 다 이 태스크의 파일 소유 밖이라 손대지 않았다(같은 미배선이
 * `EXPO_PUBLIC_SUPPORT_TEL`·`EXPO_PUBLIC_LIVE_YOUTUBE_URL`에도 이미 있다). **T-NC-14 착수 전에
 * 반드시 닫아야 하고**, 닫히면 이 문단을 지운다.
 *
 * ── 값이 없을 때 ─────────────────────────────────────────────────────────────
 * 가짜 URL을 지어내지 않는다. 값이 없거나 형식이 어긋나면 `null`을 돌려주고, 화면은 "지금 진행 중인
 * 생방송이 없습니다"를 정직하게 표시한다(재생 버튼을 흐리게라도 보여주지 않는다 —
 * `resolveLiveFallbackButtons`가 세운 원칙과 동형).
 */

/** 게시된 생방송 안내 — 값이 다 갖춰졌을 때만 만들어진다 */
export interface PublishedLiveNotice {
  /** CF Stream이 발급한 HLS(.m3u8) 재생 URL */
  readonly hlsUrl: string;
  /** 방송 제목. 미기입 시 편성표의 기본 제목을 쓰도록 null */
  readonly title: string | null;
}

/**
 * 게시 값 검증 — 순수 함수(테스트 대상). 통과 조건:
 *  ① `https:` 스킴 **한정**. 이유가 둘이다 — (a) 웹앱이 https로 서빙되므로 `http:` 매니페스트는
 *     브라우저가 mixed content로 **차단**해 눌러도 안 나온다, (b) `javascript:`/`data:` 같은
 *     스킴이 게시 실수로 들어오는 것을 원천 차단한다.
 *  ② 경로가 `.m3u8`로 끝날 것(쿼리스트링은 허용 — CF Stream 서명 파라미터). HLS 매니페스트가
 *     아닌 것(예: 유튜브 시청 페이지 링크)이 들어오면 플레이어가 조용히 실패하므로 미리 막는다.
 * 하나라도 어긋나면 null — 잘못 게시된 값으로 "되는 척"하지 않는다.
 */
export function parsePublishedLiveNotice(input: {
  hlsUrl?: string | null;
  title?: string | null;
}): PublishedLiveNotice | null {
  const raw = input.hlsUrl?.trim();
  if (!raw) return null;

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  if (!parsed.pathname.toLowerCase().endsWith('.m3u8')) return null;

  const title = input.title?.trim();
  return { hlsUrl: raw, title: title ? title : null };
}

/**
 * 빌드 시점에 주입된 게시 값을 읽는다. **호출 시점 평가**(import 시점 평가 금지 — `src/config/env.ts`와
 * 동일 규율. 테스트가 `process.env`를 갈아끼우며 검증할 수 있어야 한다).
 */
export function getPublishedLiveNotice(): PublishedLiveNotice | null {
  return parsePublishedLiveNotice({
    hlsUrl: process.env.EXPO_PUBLIC_SCHEDULE_LIVE_HLS_URL,
    title: process.env.EXPO_PUBLIC_SCHEDULE_LIVE_TITLE,
  });
}
