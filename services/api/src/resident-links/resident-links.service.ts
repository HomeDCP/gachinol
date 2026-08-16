import { Injectable, Logger } from '@nestjs/common';
import type { ContentId, StationId, User } from '@gachinol/shared';
import { ContentOrigin, isReporterUser, ResidentUploadStatus } from '@gachinol/shared';
import type { ResidentUpload as ResidentUploadRow, ResidentUploadLink as ResidentUploadLinkRow } from '@prisma/client';
import { DomainException } from '../common/errors/domain.exception';
import { newId } from '../common/ids';
import { REVIEW_POLICY_DEFAULTS } from '../config/review-policy.config';
import { MediaAssetsService } from '../media/media-assets.service';
import { S3Service } from '../media/s3.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  generateResidentLinkToken,
  hashResidentLinkToken,
  isResidentLinkTokenShape,
} from './resident-link-token';
import {
  RESIDENT_LINK_MAX_UPLOADS,
  RESIDENT_LINK_TTL_MS,
  RESIDENT_UPLOAD_DEFAULT_CATEGORY,
  RESIDENT_UPLOAD_DEFAULT_TITLE,
  RESIDENT_UPLOAD_KEY_PREFIX,
  RESIDENT_UPLOAD_MAX_BYTES,
} from './resident-links.constants';
import { assertResidentReviewApproved } from './resident-review.gate';
import type { IssueResidentLinkDto, ResidentUploadRequestDto } from './schemas/resident-link.schemas';

/* ══════════════════════════════════════════════════════════════════════════
 * 주민 임시 업로드 링크 (T-W2-08 — 02 §D-T9 · 03 §C-5 · 07 §3-15)
 *
 * 지사 담당자가 주민에게 **인증 없는** 업로드 링크를 발급하고, 주민은 링크 하나로 촬영물을 올린다.
 * 올라온 물건은 **지사 담당자 검수 승인 전에는 정식 파이프라인에 진입하지 않는다**(03 §C-5).
 *
 * ── 검수 게이트를 무엇으로 강제하는가 (3중 — T-W2-24로 ①·③ 갱신) ──────────────
 * ① **무인증 표면의 인큐 무능력**: 완료 통지 시 Content를 만들되 **미디어 잡을 인큐하지 않는다**.
 *    이 서비스는 지금도 큐를 주입받지 않으므로(생성자 참조) 익명 요청이 닿는 코드 어디에도 인큐 문장이
 *    있을 수 없다. T-W2-08 시점에는 이것이 **모듈 전체**의 보증이었으나, 승인 시 파이프라인 진입을
 *    구현한 T-W2-24부터는 **이 파일의 보증**으로 축소됐다(큐는 인증 전용 ResidentReviewsService만 안다).
 * ② **상태 표현**: 승인 여부는 ContentStatus 23종이 아니라 `resident_uploads.status`가 표현한다
 *    (신규 ContentStatus 금지 — 02 §D-T9의 "awaiting_branch_review **상당** 상태"의 실체).
 * ③ **명시 가드**: `assertPipelineEntryAllowed()` — T-W2-24가 **호출 지점을 배선했다**. 승인 액션이
 *    인큐 직전에 부르고(사전 차단), 같은 판정이 `ContentWorkflowService.applyHop`의
 *    `uploaded→processing` 엣지에도 걸린다(최후 방어선 — 인큐 주체와 무관하게 fail-closed).
 *    ①이 모듈 범위에서 파일 범위로 좁아진 대가를 ③의 범위 확대가 갚는다.
 *
 * ── 개인정보 최소수집 (07 §3-15) ────────────────────────────────────────────
 * 저장하는 것: 발급 대장(발급자·발급 지사·발급 시각) + 업로더 연락처 1개 + 이용허락 클릭동의 **시각**.
 * 저장하지 않는 것: 업로더 IP(레이트리밋은 인메모리 버킷 키로만 쓰고 버린다) · 그 밖의 개인정보 일체.
 * 동의 **문구**는 이 코드가 만들지 않는다(외부 법률자문·업로드 페이지 소관) — 기록할 자리만 만든다.
 * ══════════════════════════════════════════════════════════════════════════ */

/** 발급 응답 — 인증된 지사 담당자에게만 나간다(토큰 원문이 실리는 유일한 응답) */
export interface IssuedResidentLink {
  readonly id: string;
  /** ★ 원문 1회 노출. 서버는 해시만 보관하므로 재조회가 불가능하다 */
  readonly token: string;
  readonly stationId: string;
  readonly stationName: string;
  readonly expiresAt: string;
  readonly maxUploads: number;
  readonly remainingUploads: number;
  readonly maxFileSizeBytes: number;
}

/**
 * 공개 조회 응답 — **화이트리스트 투영**(feed 모듈 원칙).
 * 발급자·발급 지사 id·업로더 연락처·내부 id는 한 필드도 싣지 않는다. 링크를 가진 사람에게 필요한 것은
 * "지금 올릴 수 있는가 / 몇 건 / 언제까지 / 얼마나 큰 파일까지"뿐이다.
 */
export interface ResidentLinkPublicView {
  readonly valid: boolean;
  /** valid=false일 때만 — 만료인지 소진인지 알려야 안내 문구가 정확해진다 */
  readonly reason?: 'expired' | 'exhausted';
  readonly stationName: string;
  readonly expiresAt: string;
  readonly maxUploads: number;
  readonly remainingUploads: number;
  readonly maxFileSizeBytes: number;
}

/** presign 발급 응답 — storageKey는 싣지 않는다(URL에 이미 포함되며, 완료 통지는 uploadId로 한다) */
export interface ResidentUploadTicket {
  readonly uploadId: string;
  readonly uploadUrl: string;
  readonly uploadUrlExpiresAt: string;
  readonly remainingUploads: number;
  readonly maxFileSizeBytes: number;
}

/** 완료 통지 응답 — 생성된 contentId는 익명 클라이언트에 노출하지 않는다 */
export interface ResidentUploadReceipt {
  readonly uploadId: string;
  readonly status: ResidentUploadStatus;
  readonly remainingUploads: number;
}

type LinkWithStation = ResidentUploadLinkRow & { station: { name: string } };

/** 스토리지 키에 들어갈 수 있는 확장자 문자셋 — 좁게 못박는다(아래 주석) */
const SAFE_EXT = /^[a-z0-9]{1,10}$/;

/**
 * 파일명 확장자 우선, 없으면 mimeType subtype (upload.service.ts의 동명 헬퍼와 같은 규칙).
 *
 * ★ 차이 하나: 결과를 `SAFE_EXT`로 **재검증**한다. 여기 입력은 인증이 없는 익명 요청이라
 * `mimeType='video/../../x'`처럼 슬래시·점을 실어 보내 스토리지 키를 조립 단계에서 비트는 시도를
 * 가정해야 한다(S3 키는 평평한 문자열이라 실제 탈출은 아니지만, 파일시스템 백엔드(MinIO)와
 * 프리픽스 기반 정리 규칙이 전제하는 "키는 프리픽스 하위"라는 불변식이 깨진다).
 * 이상하면 조용히 'mp4'로 수렴한다 — 확장자는 재생·정리의 힌트일 뿐 신뢰 대상이 아니다.
 */
const resolveExt = (fileName: string, mimeType: string): string => {
  const fromName = fileName.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
  if (fromName && SAFE_EXT.test(fromName)) return fromName;
  const fromMime = mimeType.split('/')[1]?.split(';')[0]?.trim().toLowerCase();
  return fromMime && SAFE_EXT.test(fromMime) ? fromMime : 'mp4';
};

/**
 * 건당 500MB 초과 — 02 §D-T9가 "건당 500MB 상한 … 초과 시 **403**"으로 못박았으므로
 * 400(validation_failed)이 아니라 forbidden(403)으로 낸다(신고값·실측값 양쪽에서 같은 에러를 쓴다).
 */
const fileTooLargeError = (): DomainException =>
  new DomainException(
    'forbidden',
    `파일 1건은 ${Math.floor(RESIDENT_UPLOAD_MAX_BYTES / 1024 / 1024)}MB를 넘을 수 없습니다`,
    { maxFileSizeBytes: RESIDENT_UPLOAD_MAX_BYTES },
  );

@Injectable()
export class ResidentLinksService {
  private readonly logger = new Logger(ResidentLinksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3Service,
    private readonly assets: MediaAssetsService,
  ) {}

  /* ────────────────────────── ① 발급 (지사 담당자 인증) ────────────────────────── */

  async issue(user: User, dto: IssueResidentLinkDto): Promise<IssuedResidentLink> {
    const stationId = this.resolveIssuingStation(user, dto.stationId);
    const station = await this.prisma.station.findUnique({
      where: { id: stationId },
      select: { id: true, name: true },
    });
    if (!station) throw new DomainException('not_found', '지사를 찾을 수 없습니다');

    const token = generateResidentLinkToken();
    const expiresAt = new Date(Date.now() + RESIDENT_LINK_TTL_MS);
    const row = await this.prisma.residentUploadLink.create({
      data: {
        id: newId(),
        tokenHash: hashResidentLinkToken(token), // ★ 원문 미저장
        stationId: station.id,
        issuedByUserId: user.id,
        expiresAt,
        maxUploads: RESIDENT_LINK_MAX_UPLOADS,
      },
    });

    return {
      id: row.id,
      token, // 이 응답 이후 서버는 원문을 알지 못한다
      stationId: station.id,
      stationName: station.name,
      expiresAt: row.expiresAt.toISOString(),
      maxUploads: row.maxUploads,
      remainingUploads: row.maxUploads - row.usedCount,
      maxFileSizeBytes: RESIDENT_UPLOAD_MAX_BYTES,
    };
  }

  /**
   * 발급 지사 해석 — 기자는 자기 소속으로만, admin은 명시 지정.
   * (role 게이트 자체는 컨트롤러 `@Roles('reporter','admin')`. 여기는 소속 범위 강제 = 서비스 몫.)
   */
  private resolveIssuingStation(user: User, requested?: StationId): string {
    if (isReporterUser(user)) {
      if (requested && requested !== user.stationId) {
        throw new DomainException('forbidden', '자기 소속 지사의 링크만 발급할 수 있습니다');
      }
      return user.stationId;
    }
    // admin 수퍼롤 — 소속 지사가 없을 수 있으므로 대상 지사를 반드시 지정해야 한다
    if (!requested) {
      throw new DomainException('validation_failed', '발급 대상 지사(stationId)를 지정해야 합니다');
    }
    return requested;
  }

  /* ────────────────────────── ② 공개 유효성 조회 ────────────────────────── */

  async describe(token: string): Promise<ResidentLinkPublicView> {
    const link = await this.loadLinkOrThrow(token);
    const remaining = Math.max(0, link.maxUploads - link.usedCount);
    const expired = link.expiresAt.getTime() <= Date.now();
    const reason = expired ? ('expired' as const) : remaining <= 0 ? ('exhausted' as const) : undefined;

    return {
      valid: !reason,
      ...(reason ? { reason } : {}),
      stationName: link.station.name,
      expiresAt: link.expiresAt.toISOString(),
      maxUploads: link.maxUploads,
      remainingUploads: remaining,
      maxFileSizeBytes: RESIDENT_UPLOAD_MAX_BYTES,
    };
  }

  /* ────────────────────────── ③ presigned PUT 발급 ────────────────────────── */

  /**
   * 슬롯(건수)은 **발급 시점에 소비**한다 — 완료 시점 소비는 "presign만 무한정 받아가는" 우회를 열어준다
   * (03 §C-5의 제한 단위가 "업로드 **시도**"인 것과도 정합). 대신 완료 검증이 실패하면 슬롯을 되돌린다.
   */
  async createUpload(token: string, dto: ResidentUploadRequestDto): Promise<ResidentUploadTicket> {
    const link = await this.loadLinkOrThrow(token);
    if (link.expiresAt.getTime() <= Date.now()) {
      throw new DomainException('forbidden', '링크가 만료되었습니다 (발급 후 72시간)');
    }
    // 신고 크기 1차 차단 — 실측 차단은 완료 통지의 HEAD가 담당한다(신고값은 거짓일 수 있다)
    if (dto.sizeBytes > RESIDENT_UPLOAD_MAX_BYTES) throw fileTooLargeError();

    // 링크당 5건 하드가드 — 조건부 증가(CAS). 동시 요청 중 정확히 max_uploads건만 승리한다
    const claimed = await this.prisma.residentUploadLink.updateMany({
      where: { id: link.id, usedCount: { lt: link.maxUploads }, expiresAt: { gt: new Date() } },
      data: { usedCount: { increment: 1 } },
    });
    if (claimed.count === 0) {
      throw new DomainException('forbidden', `업로드 가능 건수(${link.maxUploads}건)를 모두 사용했습니다`);
    }

    const uploadId: string = newId();
    const ext = resolveExt(dto.fileName, dto.mimeType);
    const storageKey = `${RESIDENT_UPLOAD_KEY_PREFIX}/${uploadId}/original.${ext}`;
    try {
      // presign 먼저 — S3 자격 미설정·장애로 실패하면 행을 남기지 않고 슬롯만 되돌린다
      const presigned = await this.s3.presignPut(storageKey, { contentType: dto.mimeType });
      await this.prisma.residentUpload.create({
        data: {
          id: uploadId,
          linkId: link.id,
          status: ResidentUploadStatus.Pending,
          storageKey,
          mimeType: dto.mimeType,
          sizeBytes: BigInt(dto.sizeBytes), // 신고값 — 완료 시 실측으로 덮어쓴다
          uploaderContact: dto.uploaderContact ?? null,
          consentAgreedAt: dto.consentAgreed ? new Date() : null,
        },
      });
      return {
        uploadId,
        uploadUrl: presigned.url,
        uploadUrlExpiresAt: presigned.expiresAt,
        remainingUploads: await this.remainingUploads(link.id),
        maxFileSizeBytes: RESIDENT_UPLOAD_MAX_BYTES,
      };
    } catch (e) {
      await this.releaseSlot(link.id);
      throw e;
    }
  }

  /* ────────────────────────── ④ 완료 통지 → 검수 대기열 편입 ────────────────────────── */

  /**
   * ★ 여기서 **미디어 큐를 인큐하지 않는다**(정식 파이프라인 미진입 — 03 §C-5).
   * 만들어지는 Content는 origin='resident_link' · reporterId=null · status='uploaded'로 정지해 있고,
   * 전진은 지사 담당자 검수 승인(`POST /v1/resident-uploads/:id/approve`) 이후에만 가능하다.
   *
   * 링크 만료 여부는 **보지 않는다**: 슬롯은 이미 발급 시점에 소비됐으므로 완료를 늦게 받아도 제한을
   * 초과할 수 없고, presigned URL 자체의 만료(기본 15분)가 실제 업로드 창을 이미 좁히고 있다.
   */
  async completeUpload(token: string, uploadId: string): Promise<ResidentUploadReceipt> {
    const link = await this.loadLinkOrThrow(token);
    const upload = await this.prisma.residentUpload.findUnique({ where: { id: uploadId } });
    // 다른 링크의 업로드 id를 들고 오는 경우도 "없는 것"으로 수렴(교차 참조 차단)
    if (!upload || upload.linkId !== link.id) {
      throw new DomainException('not_found', '업로드를 찾을 수 없습니다');
    }

    // 멱등 — 모바일 회선에서 완료 통지는 흔히 재전송된다. 자산 생성만 보정하고 같은 영수증을 돌려준다
    if (upload.status === ResidentUploadStatus.AwaitingBranchReview) {
      if (upload.contentId) await this.ensureOriginalAsset(upload, upload.contentId);
      return this.receipt(upload.id, ResidentUploadStatus.AwaitingBranchReview, link.id);
    }
    if (upload.status !== ResidentUploadStatus.Pending) {
      throw new DomainException('conflict', '이미 처리된 업로드입니다', { status: upload.status });
    }

    const head = await this.s3.headObject(upload.storageKey);
    if (!head) {
      await this.failUpload(upload, link.id);
      throw new DomainException('validation_failed', '업로드된 파일을 찾을 수 없습니다. 다시 시도해주세요');
    }
    // ★ 실측 크기 강제 — presigned PUT은 크기를 강제하지 못하므로 신고값만 믿으면 상한이 무의미해진다
    if (head.sizeBytes > RESIDENT_UPLOAD_MAX_BYTES) {
      this.logger.warn(
        `주민 업로드 실측 크기 초과(upload=${upload.id}, ${head.sizeBytes}B) — 검수 대기열 편입 거부`,
      );
      await this.failUpload(upload, link.id);
      throw fileTooLargeError();
    }

    const contentId = newId<ContentId>();
    await this.prisma.$transaction(async (tx) => {
      await tx.content.create({
        data: {
          id: contentId,
          stationId: link.stationId,
          origin: ContentOrigin.ResidentLink, // ⇒ reporterId=null (shared 불변식)
          reporterId: null,
          title: RESIDENT_UPLOAD_DEFAULT_TITLE, // 제목·분류는 검수 때 지사 담당자가 확정(03 §C-5)
          category: RESIDENT_UPLOAD_DEFAULT_CATEGORY,
          cultureTopics: [],
          status: 'uploaded', // ★ 여기서 정지 — 인큐가 없으므로 processing으로 전진하지 않는다
          priority: 'normal',
          reviewPolicy: REVIEW_POLICY_DEFAULTS[RESIDENT_UPLOAD_DEFAULT_CATEGORY],
          generation: 1,
          scenes: [],
          targetChannelAccountIds: [],
          tags: [],
        },
      });
      await tx.residentUpload.update({
        where: { id: upload.id },
        data: {
          status: ResidentUploadStatus.AwaitingBranchReview,
          contentId,
          sizeBytes: BigInt(head.sizeBytes),
          completedAt: new Date(),
        },
      });
    });

    // 커밋 후 자산 등록(media_assets의 유일 기록자는 MediaAssetsService — 직접 쓰기 금지).
    // 실패해도 재전송(멱등 분기)이 같은 경로로 보정한다.
    await this.ensureOriginalAsset(upload, contentId);
    return this.receipt(upload.id, ResidentUploadStatus.AwaitingBranchReview, link.id);
  }

  /* ────────────────────────── ⑤ 검수 게이트 (서버측 강제) ────────────────────────── */

  /**
   * ★★ 파이프라인 진입 가드 — 03 §C-5 "미승인 콘텐츠는 정식 파이프라인 미진입"의 **액션측** 판정 지점.
   *
   * `origin='resident_link'` 콘텐츠는 **지사 담당자 승인 전에는 `processing`에 들어갈 수 없다**.
   * 조회·판정·예외는 `resident-review.gate.ts`가 소유하고(같은 판정을 두 벌 적지 않기 위해) 여기서는
   * 콘텐츠 존재 확인(404)만 얹는다. 판정 **규칙**의 원천은 여전히 순수 함수 `isPipelineEntryAllowed`다.
   *
   * ★ 호출 지점(T-W2-24에 배선됨):
   *   · `ResidentReviewsService.enterPipeline` — 승인 액션이 인큐 직전에(= 이 메서드의 주 소비자)
   *   · `ContentWorkflowService.applyHop` — 같은 게이트의 **엣지 수준** 배선(gate.ts를 직접 소비).
   *     그쪽이 최후 방어선이고 이쪽은 "미승인 잡을 애초에 워커에 보내지 않는" 사전 차단이다.
   */
  async assertPipelineEntryAllowed(contentId: string): Promise<void> {
    const content = await this.prisma.content.findUnique({
      where: { id: contentId },
      select: { origin: true },
    });
    if (!content) throw new DomainException('not_found', '콘텐츠를 찾을 수 없습니다');
    await assertResidentReviewApproved(this.prisma, { id: contentId, origin: content.origin });
  }

  /* ────────────────────────── 내부 ────────────────────────── */

  /**
   * 토큰 → 링크. 형식 오류·미존재를 **동일한 404**로 수렴시킨다(존재 여부 오라클 차단).
   * 만료·소진은 404가 아니다 — 토큰을 이미 가진 사람에게는 "왜 못 쓰는지"를 알려야 재발급을 요청할 수 있다.
   */
  private async loadLinkOrThrow(token: string): Promise<LinkWithStation> {
    if (!isResidentLinkTokenShape(token)) {
      throw new DomainException('not_found', '유효하지 않은 링크입니다');
    }
    const link = await this.prisma.residentUploadLink.findUnique({
      where: { tokenHash: hashResidentLinkToken(token) },
      include: { station: { select: { name: true } } },
    });
    if (!link) throw new DomainException('not_found', '유효하지 않은 링크입니다');
    return link;
  }

  /** 완료 검증 실패 — 업로드는 종결(upload_failed)하고 소비했던 슬롯은 되돌린다 */
  private async failUpload(upload: ResidentUploadRow, linkId: string): Promise<void> {
    await this.prisma.residentUpload.updateMany({
      where: { id: upload.id, status: ResidentUploadStatus.Pending },
      data: { status: ResidentUploadStatus.UploadFailed },
    });
    await this.releaseSlot(linkId);
  }

  /** 슬롯 반환 — 0 미만으로 내려가지 않도록 조건부 감소 */
  private async releaseSlot(linkId: string): Promise<void> {
    await this.prisma.residentUploadLink.updateMany({
      where: { id: linkId, usedCount: { gt: 0 } },
      data: { usedCount: { decrement: 1 } },
    });
  }

  /** original 자산 멱등 등록 — (bucket, storageKey) unique가 재호출 가드 */
  private async ensureOriginalAsset(upload: ResidentUploadRow, contentId: string): Promise<void> {
    const declared = upload.sizeBytes == null ? 0 : Number(upload.sizeBytes);
    await this.assets.createOriginalPending(contentId, upload.storageKey, upload.mimeType, declared);
    await this.assets.markReady(upload.storageKey, { sizeBytes: declared });
  }

  private async receipt(
    uploadId: string,
    status: ResidentUploadStatus,
    linkId: string,
  ): Promise<ResidentUploadReceipt> {
    return { uploadId, status, remainingUploads: await this.remainingUploads(linkId) };
  }

  private async remainingUploads(linkId: string): Promise<number> {
    const fresh = await this.prisma.residentUploadLink.findUnique({
      where: { id: linkId },
      select: { maxUploads: true, usedCount: true },
    });
    if (!fresh) return 0;
    return Math.max(0, fresh.maxUploads - fresh.usedCount);
  }
}
