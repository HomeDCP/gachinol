/**
 * 목적별 자산 셀렉터 — 대장 #232 태스크②(대장 #139 겸 해소).
 *
 * `services/api/src` 3곳(feed.service.ts·public-media.service.ts·distribution-producer.service.ts)에
 * 같은 "배포 렌디션 선택 규칙"(`renditionLabel === '720p'` 우선, 없으면 첫 렌디션 폴백)이 표현만
 * 다르게 복제돼 있었다. 이 모듈이 **단일 원천**이다. 사본이 다시 생기면
 * `infra/scripts/asset-selector-uniqueness.mjs`(D1-c 구조 게이트)가 CI에서 fail-closed로 잡는다.
 *
 * ⭐ **레이블이 env에서 파생된다는 게 이 모듈이 있는 진짜 이유다**: 레이블을 만드는 쪽
 * (`queue-producer.service.ts`의 transcode 인큐·media-worker의 `autoEditProfile`)은 둘 다
 * `MEDIA_RENDITION_HEIGHT`에서 `` `${height}p` ``를 파생한다. `'720p'`를 세 곳에 하드코딩해 두면
 * 그 env를 720이 아닌 값으로 바꾸는 순간 세 셀렉터가 **에러도 경고도 없이** `[0]` 폴백으로
 * 조용히 떨어진다. 그래서 이 모듈은 선호 레이블을 스스로 하드코딩하지 않고 호출부가
 * `renditionLabelForHeight(height)`로 파생해 넘기도록 강제한다.
 *
 * **순수 함수만 둔다**(DB·config 의존 금지) — 호출부(Nest 서비스)가 `ConfigService`에서 읽은 값을
 * 주입한다. 목적별로 이름을 나눈 것은 태스크③("송출은 마스터를 싣는다")에서 `selectDistributionVideo`만
 * `edited_master`를 고르도록 바뀌었기 때문이다 — `selectPlaybackRendition`(시청 재생)은 여전히
 * 720p 렌디션만 고른다(정본 §11 2026-09-20 결정 — 프리뷰/재생은 저화질, 송출만 고화질).
 */

/**
 * 세 호출부(Prisma `MediaAsset` 행 · distribution의 자산 목록)가 모두 만족하는 구조적 최소 타입.
 * Prisma는 이 리포 컨벤션상 enum을 text로 저장하므로(`packages/shared` 계약 — Prisma enum 금지)
 * `kind`/`status`/`renditionLabel` 전부 plain string(nullable)이라 별도 어댑팅 없이 대입 가능하다.
 *
 * ⚠️ 이름은 "렌디션 선택"이지만 `edited_master` 행도 이 타입을 만족한다(`renditionLabel`이 항상
 * null일 뿐) — `selectDistributionVideo`가 같은 배열에서 렌디션과 마스터를 함께 고려해야 하므로
 * 타입을 굳이 쪼개지 않는다.
 */
export interface RenditionSelectable {
  readonly kind: string;
  readonly status: string;
  readonly renditionLabel: string | null;
}

/** `MEDIA_RENDITION_HEIGHT`(픽셀 높이) → 렌디션 레이블. 레이블 파생도 이 한 곳뿐이다. */
export function renditionLabelForHeight(height: number): string {
  return `${height}p`;
}

/**
 * `kind==='rendition' && status==='ready'`인 자산 중 `preferredLabel`과 일치하는 것을 우선하고,
 * 없으면 (원래 배열 순서상) 첫 ready 렌디션으로 폴백한다.
 *
 * 세 호출부의 입력 모양이 조금씩 다르다 — feed·public-media는 이미 쿼리에서
 * `kind==='rendition'`·`status==='ready'`·generation으로 좁힌 배열을 넘기고, distribution은
 * 콘텐츠의 전체 자산(썸네일·마스터 포함)을 그대로 넘긴다. 그래서 이 함수가 **스스로**
 * kind·status를 다시 확인한다 — 이미 좁혀진 입력에는 항등이라 무해하고, 좁혀지지 않은 입력에는
 * 필수 필터다.
 */
function selectReadyRendition<T extends RenditionSelectable>(
  assets: readonly T[],
  opts: { preferredLabel: string },
): T | undefined {
  const ready = assets.filter((a) => a.kind === 'rendition' && a.status === 'ready');
  return ready.find((a) => a.renditionLabel === opts.preferredLabel) ?? ready[0];
}

/** 시청 재생용 — feed playback(`FeedService.getPlayback`) · 공개 사본 복사 대상(`PublicMediaService`). */
export function selectPlaybackRendition<T extends RenditionSelectable>(
  assets: readonly T[],
  opts: { preferredLabel: string },
): T | undefined {
  return selectReadyRendition(assets, opts);
}

/**
 * 외부 플랫폼(YouTube·카카오) 송출 메시지용 — `DistributionProducerService.buildMessage`.
 *
 * **1순위 — 현 세대 `edited_master`(status==='ready')**(대장 #232 태스크③, 정본 §11 2026-09-20
 * 결정 — "고화질 편집본이 그대로 송출되어야 한다. 송출은 유튜브, 카카오페이지 업로드를 의미한다").
 * **2순위(폴백) — 기존 렌디션 선택 규칙**(`selectReadyRendition`, `selectPlaybackRendition`과 동일).
 *
 * ⚠️ **폴백을 지우면 안 된다**: ⓐ 사용자 결정(2026-09-22) — 기존 published 콘텐츠는 재마스터링하지
 * 않는다. 구 콘텐츠는 720p 규격 마스터이거나 마스터가 아예 없다. ⓑ auto_edit 도입 이전 세대에는
 * `edited_master` 자체가 없다. 폴백이 없으면 그 콘텐츠들의 송출이 조용히 깨진다.
 *
 * 호출부가 이미 `generation`으로 좁힌 배열을 넘긴다(`MediaAssetsService.listForContent`) — 이
 * 함수는 그 전제를 다시 확인하지 않는다(마스터가 여러 건이면 배열에서 먼저 발견되는 것을 쓴다,
 * `selectReadyRendition`이 `ready[0]`을 쓰는 것과 같은 관례).
 */
export function selectDistributionVideo<T extends RenditionSelectable>(
  assets: readonly T[],
  opts: { preferredLabel: string },
): T | undefined {
  const master = assets.find((a) => a.kind === 'edited_master' && a.status === 'ready');
  if (master) return master;
  return selectReadyRendition(assets, opts);
}
