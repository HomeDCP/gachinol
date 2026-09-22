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
 * `edited_master`를 고르도록 바뀔 예정이기 때문이다 — **오늘은 두 함수가 완전히 같은 자산을
 * 고른다**(동작 변경 없음, 이름만 분리).
 */

/**
 * 세 호출부(Prisma `MediaAsset` 행 · distribution의 자산 목록)가 모두 만족하는 구조적 최소 타입.
 * Prisma는 이 리포 컨벤션상 enum을 text로 저장하므로(`packages/shared` 계약 — Prisma enum 금지)
 * `kind`/`status`/`renditionLabel` 전부 plain string(nullable)이라 별도 어댑팅 없이 대입 가능하다.
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
 * ⚠️ **오늘은 재생 렌디션과 같은 자산을 고른다.** 대장 #232 태스크③(정본 §11 2026-09-20 결정 —
 * "고화질 편집본이 그대로 송출되어야 한다")에서 이 함수만 `edited_master`를 고르도록 바뀔 자리다.
 * 이름을 지금 분리해 두는 것은 그 변경이 `selectPlaybackRendition` 호출부(시청 재생)에 새지 않게
 * 하기 위해서다 — 여기서 마스터로 바꾸지 않는다(태스크③ 범위).
 */
export function selectDistributionVideo<T extends RenditionSelectable>(
  assets: readonly T[],
  opts: { preferredLabel: string },
): T | undefined {
  return selectReadyRendition(assets, opts);
}
