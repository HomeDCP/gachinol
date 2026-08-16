import type { StationId } from '@gachinol/shared';
import { ResidentUploadStatus } from '@gachinol/shared';
import { createZodDto } from 'nestjs-zod';
import { zEnum, zId, zPage } from '../../common/zod';

/* ══════════════════════════════════════════════════════════════════════════
 * 검수 대기열 요청 계약 — **모듈 내부**(zod 스키마·DTO 자체는 api 전용으로 유지).
 * T-W2-08 당시 이 문단은 "shared가 아니라 모듈 내부"의 근거로 "소비자는 지사 담당자 검수 화면
 * (후속 FE 태스크) 하나뿐이고, 앱·워커가 공유하는 도메인 계약이 아니다"를 들었다 — 그 후속 FE
 * 태스크(T-W2-25b, 기자 앱 검수 화면)가 이제 착수되어 전제가 깨졌다. **enum·전이맵
 * 자체(`ResidentUploadStatus`·`RESIDENT_UPLOAD_STATUS_TRANSITIONS`)는 T-W2-25a에서 shared로
 * 승격했다**(2026-08-16, `@gachinol/shared`의 `resident/resident-upload-status.ts`가 유일 원천).
 * 여기 남은 것은 이 enum을 감싼 zod 쿼리 DTO뿐이다 — REST 쿼리 파싱은 api 경계 관심사라 승격 대상이
 * 아니다(다른 도메인의 zod 스키마도 shared에 두지 않는 것과 동형).
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
 * 받지 않는다. 사유 보존은 후속 위임(반려 사유 컬럼 + 업로더 통지 경로)이며 대장 #113이 별건으로 잡고 있다.
 *
 * T-W2-31 이후에도 이 판단은 그대로다. 반려는 이제 연결된 Content를 종결시키고 그 전이가
 * `status_transition_logs`(entity_type='content')에 남지만, 거기 실리는 것은 **서버가 조립한 고정 문구**
 * (검수자 id + uploadId)일 뿐 검수자가 쓴 자유 사유가 아니다 — 자유 입력을 받아 note에 밀어 넣으면
 * 콘텐츠 감사 로그에 검수자 원문이 섞여 들어가고, 여전히 질의 가능한 구조화 컬럼은 생기지 않는다. */
