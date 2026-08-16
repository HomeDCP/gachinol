import type { StationId } from '@gachinol/shared';
import { createZodDto } from 'nestjs-zod';
import { zEnum, zId, zPage } from '../../common/zod';
import { ResidentUploadStatus } from '../resident-upload-status';

/* ══════════════════════════════════════════════════════════════════════════
 * 검수 대기열 요청 계약 — **shared가 아니라 모듈 내부**(T-W2-08 발급 스키마와 동일 판단).
 * 소비자는 지사 담당자 검수 화면(후속 FE 태스크) 하나뿐이고, 앱·워커가 공유하는 도메인 계약이 아니다.
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * GET /v1/resident-uploads — 검수 대기열 조회.
 *
 * · status: 미지정 시 `awaiting_branch_review`(검수 **대기**열이므로 대기 중인 것이 기본값이다).
 *   값은 `RESIDENT_UPLOAD_STATUS_TRANSITIONS`가 소유하는 5종에서 파생한다(사본 금지).
 * · stationId: **admin 전용 필터**다. 기자는 서버가 자기 소속 지사로 덮어쓰므로 이 값을 보내도
 *   무시된다(`ContentsService.list`의 reporter 강제와 동형) — 타 지사 건은 애초에 보이지 않는다.
 */
export const zResidentReviewQuery = zPage.extend({
  status: zEnum(ResidentUploadStatus).optional(),
  stationId: zId<StationId>().optional(),
});

export class ResidentReviewQueryDto extends createZodDto(zResidentReviewQuery) {}

/* 승인·반려는 **바디가 없다**. 특히 반려 사유를 받지 않는 것은 의도적 판단이다:
 * `resident_uploads`에 사유 컬럼이 없고, shared `TransitionEntityType`에도 'resident_upload'가 없어
 * `status_transition_logs`로 우회할 수도 없다(Prisma 스키마·shared 무변경이 이 태스크의 제약).
 * 받아 놓고 버리는 필드는 "배관 공백"(대장 #98~#107)을 다시 만드는 짓이라, 저장할 자리가 생기기 전에는
 * 받지 않는다. 사유 보존은 후속 위임(반려 사유 컬럼 + 업로더 통지 경로)이다. */
