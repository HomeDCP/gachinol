import type { StationId } from '@gachinol/shared';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { zId } from '../../common/zod';
import { RESIDENT_UPLOAD_DECLARED_SIZE_CEILING } from '../resident-links.constants';

/* ══════════════════════════════════════════════════════════════════════════
 * 요청 계약 — **shared가 아니라 모듈 내부**에 둔다.
 * 이 표면의 소비자는 구독자 웹의 무인증 업로드 화면(T-W2-09) 하나뿐이고, 앱·워커가 공유하는 도메인
 * 계약이 아니다(distribution 큐 wire·recommendations 내부 스키마 선례).
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * POST /v1/resident-links — 발급.
 * stationId는 **admin 전용 지정 수단**이다: reporter는 항상 자기 소속 지사로 발급되며(토큰에서 해석),
 * 다른 지사를 지정하면 403이다. admin은 소속 지사가 없을 수 있어 이 값이 필수가 된다(서비스 판정).
 */
export const zIssueResidentLink = z.object({
  stationId: zId<StationId>().optional(),
});

/**
 * POST /v1/resident-links/:token/uploads — presigned PUT 발급 요청(무인증).
 *
 * ★ **간단 모드 강제(03 §C-5)의 서버측 반영**: 제목·분류·장면 자막을 받는 필드가 아예 없다.
 *   "촬영 → 바로 업로드, 분류·자막 모두 지사 담당자가 사후 입력"이 정본이므로, 서버가 그 입력을 받지
 *   않는 것이 프론트의 축소 UI를 우회 불가능하게 만드는 가장 단순한 방법이다.
 * · sizeBytes: 500MB 판정은 **서비스**가 한다(초과=403, 02 §D-T9). 여기서는 터무니없는 값만 차단한다.
 * · uploaderContact: 07 §3-15 ⓐ "업로더 최소 식별정보(연락처 1개)". 전화/이메일 형식을 강제하지 않는다
 *   — 사후 연락 가능성 확보가 목적이지 신원 확인이 아니고, 형식 강제는 60대 이상 사용자의 이탈만 만든다.
 *   **연락처 외 개인정보 필드는 추가 금지**(과잉수집 방지, 07 §3-4 동일 원칙).
 * · consentAgreed: 07 §3-15 ⓑ 이용허락 클릭동의. true면 서버가 동의 **시각**을 기록한다.
 *   ⚠️ 동의 **문구 자체는 이 코드가 만들지 않는다**(외부 법률자문 + 업로드 페이지 소관, 07 §5-4).
 *   그래서 현재는 optional이다 — 문구 확정 전에 필수화하면 "무엇에 동의했는지 모르는 동의"를 받게 된다.
 */
export const zResidentUploadRequest = z.object({
  fileName: z.string().min(1).max(300),
  mimeType: z.string().regex(/^video\//, '원본은 비디오여야 합니다'),
  sizeBytes: z.number().int().positive().max(RESIDENT_UPLOAD_DECLARED_SIZE_CEILING),
  uploaderContact: z.string().trim().min(1).max(100).optional(),
  consentAgreed: z.boolean().optional(),
});

export class IssueResidentLinkDto extends createZodDto(zIssueResidentLink) {}
export class ResidentUploadRequestDto extends createZodDto(zResidentUploadRequest) {}
