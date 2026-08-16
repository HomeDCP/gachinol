import type { ContentStatus } from '@gachinol/shared';
import { ContentOrigin } from '@gachinol/shared';
import type { PrismaClient } from '@prisma/client';
import { DomainException } from '../common/errors/domain.exception';
import { isPipelineEntryAllowed } from './resident-upload-status';

/* ══════════════════════════════════════════════════════════════════════════
 * 검수 게이트 — "조회 + 판정 + 예외" 의 **유일 구현** (T-W2-24, 대장 #86·#97)
 *
 * 왜 이 파일이 따로 있는가: 이 게이트를 **두 곳**이 부른다.
 *   ① `ResidentLinksService.assertPipelineEntryAllowed` — 승인 액션이 인큐 직전에 부르는 사전 점검
 *      (여기서 걸리면 미승인 건이 워커에 아예 도달하지 않는다 = 낭비·남용 차단).
 *   ② `ContentWorkflowService.applyHop` — 콘텐츠 전이의 단일 관문. `uploaded→processing`(정식
 *      파이프라인 진입 엣지)을 시도하는 **모든** 경로(파이프라인 시스템 전이·범용 수동 전이·재시도·
 *      아직 없는 미래 코드)를 fail-closed로 막는다.
 * 같은 판정을 두 번 적고 싶지 않아 여기에 한 번만 둔다. 판정 **규칙** 자체의 원천은 여전히
 * `resident-upload-status.ts`의 순수 함수 `isPipelineEntryAllowed`이고, 이 파일은 그 함수에
 * DB 조회와 예외 변환만 얹는다(규칙 사본 0).
 *
 * ── 왜 ②가 필요한가 (T-W2-08의 구조적 강제 ①을 대체한다) ─────────────────────
 * T-W2-08은 "ResidentLinksModule이 QueueModule을 모른다 = 인큐할 수단이 없다"를 1차 강제로 삼았다.
 * T-W2-24가 승인 시 인큐를 붙이면서 그 강제는 **모듈 경계로는** 더 이상 성립하지 않는다.
 * 대신 이 파일의 ②가 강제를 **엣지 수준**으로 옮긴다 — ①은 "이 모듈이 인큐를 못 한다"는 모듈 범위
 * 보증이라 다른 모듈(UploadService·ContentsController.retry·미래의 코드)에는 애초에 효력이 없었다.
 * ②는 "누가 인큐하든 미승인 콘텐츠는 processing으로 못 간다"는 콘텐츠 범위 보증이라 범위가 더 넓다.
 * 잡이 잘못 인큐돼 워커가 돌아도 상태는 `uploaded`에 머물고, 후속 인큐(분석·프리뷰)는 전부
 * `hop.applied` 가드 뒤에 있어 연쇄가 시작되지 않는다.
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * 이 가드가 필요로 하는 DB 표면의 최소 조각.
 * `PrismaService`(PrismaClient 상속)와 `Prisma.TransactionClient`(= PrismaClient에서 $-메서드만
 * 제외) 양쪽이 그대로 만족하므로, 트랜잭션 안팎 어디서든 같은 함수를 부를 수 있다.
 */
export type ResidentUploadReader = Pick<PrismaClient, 'residentUpload'>;

/**
 * ★ "정식 파이프라인 진입" 엣지의 정의 — 유일 표기(사본 금지).
 * 03 §C-5의 "미승인 콘텐츠는 정식 파이프라인 미진입"에서 '진입'이 가리키는 지점이 정확히 이 엣지다:
 * `uploaded`까지는 원본 오브젝트가 스토리지에 놓였을 뿐이고, `processing`부터 트랜스코딩·분석·
 * 프리뷰·송출 연쇄가 시작된다.
 */
export const isPipelineEntryEdge = (from: ContentStatus, to: ContentStatus): boolean =>
  from === 'uploaded' && to === 'processing';

/**
 * ★★ 검수 승인 확인 — origin='resident_link'가 아니면 즉시 통과(기존 경로 무영향·DB 조회 0회).
 *
 * 코드는 `invalid_transition`(409): 권한 문제가 아니라 "지금 그 전이를 할 수 없다"는 상태 문제이며,
 * origin 기반 차단을 invalid_transition으로 표현한 `ContentWorkflowService.policyGuard` 선례와 같다.
 * 업로드 행이 아예 없는 경우도 거절이다 — 판정 근거 부재를 통과로 해석하면 게이트가 무의미해진다
 * (fail-closed, 판정은 `isPipelineEntryAllowed`가 소유).
 */
export const assertResidentReviewApproved = async (
  db: ResidentUploadReader,
  content: { readonly id: string; readonly origin: string },
): Promise<void> => {
  if (content.origin !== ContentOrigin.ResidentLink) return;

  const upload = await db.residentUpload.findUnique({
    where: { contentId: content.id },
    select: { status: true },
  });
  if (!isPipelineEntryAllowed(content.origin, upload?.status ?? null)) {
    throw new DomainException(
      'invalid_transition',
      '지사 담당자 검수 승인 전에는 정식 파이프라인에 진입할 수 없습니다',
      { origin: content.origin, reviewStatus: upload?.status ?? null },
    );
  }
};
