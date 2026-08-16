import type { StationId, StationSummary } from '@gachinol/shared';

/**
 * 지사 공개 연락 채널 해석(T-W2-28 · 대장 #127).
 *
 * **왜 있나** — 재생 실패 폴백(03 §A-6)의 "지사에 전화 / 유튜브에서 보기"는 지사마다 값이 달라야
 * 하는데, 예전 유일 공급원은 앱 env(`EXPO_PUBLIC_SUPPORT_TEL`·`EXPO_PUBLIC_LIVE_YOUTUBE_URL`)라
 * **빌드 1개 = 값 1개**였다. 이제 서버(`GET /v1/feed/stations` → `StationSummary`)가 지사별 값을
 * 준다. env는 **지사를 특정할 수 없는 화면의 최후 수단**으로만 남긴다(신규 env 키 없음).
 *
 * **우선순위**: 서버 값 > env 폴백 > 없음(null). null이면 화면은 그 대체 경로를 **숨긴다** —
 * 흐린 버튼으로도 그리지 않는다(눌리지 않는 버튼을 보여주는 것이 이 리포의 반복 결함이었다).
 */

export interface StationContact {
  /** `tel:` href — 그대로 `Linking.openURL`에 넘길 수 있는 형태. 없으면 null */
  supportTelHref: string | null;
  /** 유튜브 대체 시청 URL. 없으면 null */
  youtubeUrl: string | null;
}

/** 공백만 있는 값은 "없음"으로 본다 — 서버가 어떤 이유로 빈 값을 흘려도 죽은 버튼을 만들지 않는다 */
function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** 전화번호 → `tel:` href. 공백·괄호는 제거(다이얼러가 못 읽는 문자를 넘기지 않는다) */
export function toTelHref(tel: string | null | undefined): string | null {
  const cleaned = clean(tel);
  if (!cleaned) return null;
  const dialable = cleaned.replace(/[\s()]/g, '');
  return dialable ? `tel:${dialable}` : null;
}

/**
 * 공개 지사 목록에서 연락 채널의 원천이 될 지사 1곳을 고른다.
 *
 * - `stationId`가 있으면 그것으로 찾는다(정확·유일).
 * - 없으면 `stationName` **정확 일치**로 찾되, 동명 지사가 2곳 이상이면 **null**을 돌려준다
 *   (엉뚱한 지사 번호로 전화를 걸게 하느니 대체 경로를 숨기는 편이 낫다).
 *   이름 조회가 필요한 이유: 시청 화면이 받는 `PlaybackInfo`에는 `stationId`가 없고 비정규화된
 *   `stationName`만 있다(계약 확장은 이 태스크의 파일 소유 밖 — 완료 보고 ⑤에 등재).
 */
export function findStationFor(
  stations: readonly StationSummary[] | undefined,
  ref: { stationId?: StationId | null; stationName?: string | null },
): StationSummary | null {
  if (!stations || stations.length === 0) return null;

  if (ref.stationId) {
    return stations.find((s) => s.id === ref.stationId) ?? null;
  }

  const name = clean(ref.stationName);
  if (!name) return null;
  const matched = stations.filter((s) => s.name === name);
  return matched.length === 1 ? (matched[0] as StationSummary) : null;
}

/**
 * 서버 값 우선 + env 폴백. 어느 쪽도 없으면 null(화면이 그 경로를 숨긴다).
 * env 값은 이미 href/URL 형태로 들어온다(`src/config/env.ts`), 서버 값은 원본 전화번호라
 * 여기서 `tel:`로 만든다.
 */
export function resolveStationContact(input: {
  station: StationSummary | null | undefined;
  envSupportTelHref: string | null;
  envYoutubeUrl: string | null;
}): StationContact {
  return {
    supportTelHref: toTelHref(input.station?.supportTel) ?? clean(input.envSupportTelHref),
    youtubeUrl: clean(input.station?.youtubeUrl) ?? clean(input.envYoutubeUrl),
  };
}
