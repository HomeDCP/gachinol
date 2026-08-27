import { Platform, Share } from 'react-native';

/**
 * 주민 업로드 공유 URL 구성(T-W2-35, 대장 #147).
 *
 * 주민 소비 화면은 구독자 웹(`apps/subscriber/app/upload/[token].tsx`)에 있으므로 공유 URL은
 * `<구독자 오리진>/upload/<token>`이다. 기자 앱은 구독자 오리진을 스스로 알 수 없어 우선순위를 둔다:
 *   ① `EXPO_PUBLIC_SUBSCRIBER_WEB_URL`(명시 설정) — 도메인 보류 중엔 Tailscale 오리진을 넣는다.
 *      빈 문자열은 미설정으로 취급한다(Dockerfile.web ARG 기본값이 빈 값 — 대장 #146 경로).
 *   ② 웹 실행 중 호스트가 `reporter.<rest>`면 `watch.<rest>` 유도 — infra/docker/nginx.conf의
 *      vhost 명명 규칙(watch./reporter./center.${DOMAIN})이 근거라, 도메인이 확정되면 env 없이도 맞다.
 *   ③ 둘 다 불가 → null. 화면은 경로만 표시하고 설정 안내로 강등한다 — localhost 개발 서버 등에서
 *      틀린 절대 URL을 지어내 주민에게 전달되는 사고를 만들지 않는다.
 */

export interface WebLocationLike {
  /** window.location.protocol — 'https:' 형태(콜론 포함) */
  readonly protocol: string;
  /** window.location.host — 포트 포함(예: 'reporter.gachinol.local:8080') */
  readonly host: string;
}

export interface ResidentUploadUrlContext {
  readonly baseUrl?: string | null;
  readonly webLocation?: WebLocationLike | null;
}

const REPORTER_HOST_PREFIX = 'reporter.';
const SUBSCRIBER_HOST_PREFIX = 'watch.';

/** ② reporter.<rest> → watch.<rest> 오리진 유도. 비매칭이면 null */
export function deriveSubscriberOrigin(loc: WebLocationLike | null | undefined): string | null {
  if (!loc || !loc.host.startsWith(REPORTER_HOST_PREFIX)) return null;
  const rest = loc.host.slice(REPORTER_HOST_PREFIX.length);
  return `${loc.protocol}//${SUBSCRIBER_HOST_PREFIX}${rest}`;
}

/** 주민에게 전달할 업로드 경로 — URL을 못 만들 때(③)도 이 경로는 항상 보여줄 수 있다 */
export function residentUploadPath(token: string): string {
  return `/upload/${encodeURIComponent(token)}`;
}

/** 전체 공유 URL. 우선순위 ①→②, 불가하면 null */
export function buildResidentUploadUrl(
  token: string,
  ctx: ResidentUploadUrlContext,
): string | null {
  const base = ctx.baseUrl?.trim().replace(/\/+$/, '');
  if (base) return `${base}${residentUploadPath(token)}`;
  const derived = deriveSubscriberOrigin(ctx.webLocation ?? null);
  if (derived) return `${derived}${residentUploadPath(token)}`;
  return null;
}

/** 런타임 컨텍스트 수집 — env는 빌드 시점 인라인, webLocation은 웹에서만 존재 */
export function residentUploadUrlContext(): ResidentUploadUrlContext {
  const baseUrl = process.env.EXPO_PUBLIC_SUBSCRIBER_WEB_URL ?? null;
  const webLocation =
    Platform.OS === 'web' && typeof window !== 'undefined' && window.location
      ? { protocol: window.location.protocol, host: window.location.host }
      : null;
  return { baseUrl, webLocation };
}

/**
 * 링크 복사/공유 — 웹은 클립보드, 네이티브는 공유 시트. 성공 여부만 반환하고 안내는 호출부(토스트)가.
 * 실패는 예외가 아니라 false다 — 클립보드 권한 거부·공유 시트 취소는 정상 흐름이고,
 * URL 텍스트 자체가 selectable로 렌더돼 있어 수동 복사 경로가 항상 남는다.
 */
export async function copyResidentLinkText(text: string): Promise<boolean> {
  if (Platform.OS === 'web') {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {
      // 아래 공유 시트 폴백으로 계속 — 웹에서도 navigator.share가 있으면 Share.share가 그걸 쓴다
    }
  }
  try {
    await Share.share({ message: text });
    return true;
  } catch {
    return false;
  }
}

/** 만료 시각 표기 — 상대시간이 아니라 절대시각(주민에게 "언제까지"를 전달하는 값이라 모호하면 안 된다) */
export function formatExpiresAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('ko-KR', {
    month: 'long',
    day: 'numeric',
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}
