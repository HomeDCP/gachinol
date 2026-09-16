import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  Content,
  CreateMultipartUploadResponse,
  IssueUploadUrlResponse,
  User,
} from '@gachinol/shared';
import { DomainException } from '../common/errors/domain.exception';
import { toContent } from '../contents/content.mapper';
import { ContentWorkflowService } from '../contents/content-workflow.service';
import { ContentsService } from '../contents/contents.service';
import type { Env } from '../config/env.schema';
import { MediaAssetsService } from '../media/media-assets.service';
import { planMultipartUpload, S3Service } from '../media/s3.service';
import { PrismaService } from '../prisma/prisma.service';
import { QueueProducerService } from '../queue/queue-producer.service';
import type {
  AbortMultipartUploadDto,
  CompleteMultipartUploadDto,
  CompleteUploadDto,
  CreateMultipartUploadDto,
  IssueUploadUrlDto,
} from './schemas/upload.schemas';

const ISSUABLE = ['draft', 'upload_failed'] as const;

/** 파일명 확장자 우선, 없으면 mimeType subtype (video/mp4 → mp4) */
const resolveExt = (fileName: string, mimeType: string): string => {
  const fromName = fileName.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
  if (fromName) return fromName;
  return mimeType.split('/')[1]?.split(';')[0]?.trim() || 'mp4';
};

/**
 * 업로드 오케스트레이션 — presigned PUT 발급 + 완료 검증. 상태 전이는 ContentWorkflowService 관문 경유.
 * REDIS_URL 미설정 시 파이프라인 비활성 → 라우트 진입 시점에 거부(콘텐츠를 uploaded 교착에 두지 않음).
 */
@Injectable()
export class UploadService {
  constructor(
    private readonly contents: ContentsService,
    private readonly workflow: ContentWorkflowService,
    private readonly assets: MediaAssetsService,
    private readonly s3: S3Service,
    private readonly producer: QueueProducerService,
    private readonly prisma: PrismaService,
    // 대장 #224(업로드 고착 복구) — UPLOAD_STUCK_MS 조회 전용. 끝에 추가해 기존 위치 인자
    // 호출부(테스트 setup 등)의 앞쪽 6개 인자를 건드리지 않는다.
    private readonly config: ConfigService<Env, true>,
  ) {}

  private requirePipeline(): void {
    if (!this.producer.enabled) {
      throw new DomainException(
        'internal',
        'Redis 미설정 — 업로드 파이프라인이 비활성 상태입니다',
      );
    }
  }

  async issueUploadUrl(
    user: User,
    id: string,
    dto: IssueUploadUrlDto,
  ): Promise<IssueUploadUrlResponse> {
    this.requirePipeline();
    const content = await this.contents.loadOwned(user, id);
    if (dto.contentId !== id) {
      throw new DomainException('validation_failed', 'body.contentId가 경로 id와 일치하지 않습니다');
    }
    if (!(ISSUABLE as readonly string[]).includes(content.status)) {
      throw new DomainException('conflict', 'draft·upload_failed 상태에서만 업로드를 시작할 수 있습니다', {
        status: content.status,
      });
    }

    const storageKey = this.assets.originalKey(id, resolveExt(dto.fileName, dto.mimeType));
    // 자산 upsert 먼저(멱등) → beginUpload(전이). 재-issue 안전
    await this.assets.createOriginalPending(id, storageKey, dto.mimeType, dto.sizeBytes);
    await this.workflow.beginUpload(id, user);

    const { url, expiresAt } = await this.s3.presignPut(storageKey, { contentType: dto.mimeType });
    return { storageKey, uploadUrl: url, expiresAt };
  }

  async completeUpload(user: User, id: string, dto: CompleteUploadDto): Promise<Content> {
    this.requirePipeline();
    const content = await this.contents.loadOwned(user, id);
    if (dto.contentId !== id) {
      throw new DomainException('validation_failed', 'body.contentId가 경로 id와 일치하지 않습니다');
    }
    if (content.status !== 'uploading') {
      throw new DomainException('conflict', 'uploading 상태에서만 완료할 수 있습니다', {
        status: content.status,
      });
    }

    // 클라 임의 key 주입 차단 — 발급된 original 자산 key와 일치해야 함
    const original = await this.assets.findOriginal(id, 1);
    if (!original) {
      // 대장 #212 — 재-issue 이후에도 원본 자산을 못 찾음(우리 쪽 자산 부재·경합. 클라 입력과 무관).
      // uploading의 유일한 출구는 completeUpload뿐이라(uploading→{uploaded,upload_failed} 외 전이
      // 없음, shared workflow.ts) 여기서 콘텐츠를 놓치면 재-issue조차(ISSUABLE=draft·upload_failed
      // 밖) 열 수 없는 채로 영구 고착된다(I-2). markFailed로 지울 자산 행 자체가 없으므로 콘텐츠
      // 전이만 한 트랜잭션으로 커밋한다.
      await this.prisma.$transaction(async (tx) => {
        await this.workflow.failUploadTx(tx, content, user);
      });
      throw new DomainException('validation_failed', '발급된 업로드 원본을 찾을 수 없습니다');
    }
    if (original.storageKey !== dto.storageKey) {
      // 클라 임의 key 주입 차단(원 목적 유지, 위 주석) — dto.storageKey는 검증되지 않은 클라 입력이라
      // 이 값으로 어떤 media_assets 행도 건드리지 않는다(이름이 우연히 겹치는 타 콘텐츠 자산을 오염
      // 시킬 위험 — 대장 #212 함정1). original 자산 자체도 그대로 둔다: 그 자산은 여전히 유효하게
      // 발급된 상태(pending/ready)이고, 이 요청만 잘못된 key를 주장했을 뿐이다.
      // 그렇더라도 이 요청의 실패가 콘텐츠를 uploading에 영구 고착시켜서는 안 된다(I-2) — 공격이든
      // 클라 버그든 재-issue조차 못 여는 채로 갇히는 것은 원 방어(임의 key 주입 차단)의 목적이 아니다.
      await this.prisma.$transaction(async (tx) => {
        await this.workflow.failUploadTx(tx, content, user);
      });
      throw new DomainException('validation_failed', '발급된 업로드 키와 일치하지 않습니다');
    }

    const head = await this.s3.headObject(dto.storageKey);
    if (!head) {
      // 오브젝트 부재 → 사용자 실패로 표기(재-issue로 복구). uploading 교착 회피.
      // 대장 #168 — 자산 markFailed와 콘텐츠 failUpload를 별개 커밋으로 내면 그 사이 프로세스가 죽었을 때
      // 자산만 failed로 남고 콘텐츠는 uploading에 영구 고착한다(재발급은 ISSUABLE 밖 → 409, findOriginal이
      // failed 자산을 제외 → 완료 경로도 막힘. 실기 2건). 한 트랜잭션으로 묶어 부분 실패를 없앤다.
      await this.prisma.$transaction(async (tx) => {
        await this.assets.markFailed(dto.storageKey, tx);
        await this.workflow.failUploadTx(tx, content, user);
      });
      throw new DomainException('validation_failed', '업로드된 오브젝트를 찾을 수 없습니다');
    }

    await this.assets.markReady(dto.storageKey, { sizeBytes: head.sizeBytes });
    const updated = await this.workflow.completeUpload(id, user);

    // 인큐-애프터-커밋 — 전이 커밋 후 트랜스코딩 인큐
    await this.producer.enqueueTranscode(updated);
    return toContent(updated);
  }

  /**
   * 멀티파트 업로드 시작 (대장 #211) — Cloudflare 터널이 단일 요청 바디를 정확히 100MiB까지만
   * 통과시켜(실측, 101MB부터 413) 큰 원본은 단일 presigned PUT(`issueUploadUrl`)로 못 올라간다.
   * 파트 크기는 서버가 `planMultipartUpload`로 고정 계산한다(클라가 100MiB 이상 파트를 요청해
   * 이 결함을 재현하는 것을 원천 차단).
   *
   * ★ 순서 — 대장 #211 보완(조율자 지시). **로컬 계산(`planMultipartUpload`) → S3
   * `createMultipartUpload`(실 네트워크 호출) → 로컬 부수효과(자산 pending 생성·`beginUpload`
   * 전이) → 파트별 presign(로컬 서명)** 순으로 둔다. 애초 구현은 단일 PUT 경로(`issueUploadUrl`)와
   * 똑같이 자산·전이를 먼저 낸 뒤 S3를 불렀는데, `presignPut`(단일 PUT)은 로컬 서명이라 사실상
   * 실패하지 않는 반면 `createMultipartUpload`는 실제 S3 API 호출이라 실패 확률이 다르다 — 실패하면
   * 콘텐츠가 `uploading`에 갇히고 재발급은 `ISSUABLE`(draft·upload_failed) 밖이라 막힌다. 이게
   * 대장 #168(HEAD 부재)·#212(재발급 후 자산 failed 잔존)에 이은 **세 번째 입구**가 될 참이었다 —
   * "완료·중단 경로가 실패하든 uploading에 남지 않는다"는 I-2의 취지는 분기 열거가 아니라 그
   * 상태 자체를 만들지 않는 것이므로, 여기서는 롤백이 아니라 **실패 창을 원천 제거**한다: S3 호출이
   * 실패하는 시점에 아직 어떤 로컬 상태도 바뀌지 않았으므로(자산 미생성·전이 미실행) 콘텐츠는 호출
   * 전 상태(draft/upload_failed) 그대로 남아 재-issue가 즉시 열려 있다. 대가는 S3에 **고아
   * 멀티파트 업로드**가 남을 수 있다는 것뿐이며(그 뒤 로컬 DB 쓰기 2건이 실패하는 극히 드문 경우),
   * MinIO/S3 `AbortIncompleteMultipartUpload` 라이프사이클 규칙으로 정리 가능해 콘텐츠 영구 고착보다
   * 훨씬 가볍다고 판단했다(운영 설정은 인프라 영역 — 이 슬라이스 범위 밖).
   *
   * ⚠️ 단일 PUT 경로(`issueUploadUrl`)에는 **같은 처방을 적용하지 않았다** — `presignPut`은
   * 로컬 서명(크립토 계산)이라 네트워크 실패가 없고, 유일한 실패 조건(S3 자격 미설정)은 매 요청마다
   * 결정적으로 재현되는 **설정 오류**라 첫 실패 시점에 전역 장애로 즉시 드러난다(개별 기자가 조용히
   * 갇히는 것과 다르다). 그 경로를 건드리면 이미 검증된 단일 PUT 무회귀 요구(#211 위임 ⑧) 대비
   * 이득이 없는 코드 변경만 늘어난다고 판단했다.
   */
  async startMultipartUpload(
    user: User,
    id: string,
    dto: CreateMultipartUploadDto,
  ): Promise<CreateMultipartUploadResponse> {
    this.requirePipeline();
    const content = await this.contents.loadOwned(user, id);
    if (dto.contentId !== id) {
      throw new DomainException('validation_failed', 'body.contentId가 경로 id와 일치하지 않습니다');
    }
    if (!(ISSUABLE as readonly string[]).includes(content.status)) {
      throw new DomainException('conflict', 'draft·upload_failed 상태에서만 업로드를 시작할 수 있습니다', {
        status: content.status,
      });
    }

    const storageKey = this.assets.originalKey(id, resolveExt(dto.fileName, dto.mimeType));
    const plan = planMultipartUpload(dto.sizeBytes); // 순수 계산 — 부수효과 이전에 먼저 검증

    // S3 호출(실 네트워크) 먼저 — 실패해도 아직 로컬 상태를 바꾸지 않았으므로 콘텐츠는
    // draft/upload_failed 그대로 남는다(교착 원천 차단, 위 클래스 주석 참조).
    const { uploadId } = await this.s3.createMultipartUpload(storageKey, {
      contentType: dto.mimeType,
    });

    // 단일 PUT 경로와 동일한 순서(멱등) — 재-issue 안전(대장 #212 I-1). S3 시작 성공 후에만
    // 로컬 자산·전이 부수효과를 낸다.
    await this.assets.createOriginalPending(id, storageKey, dto.mimeType, dto.sizeBytes);
    await this.workflow.beginUpload(id, user);

    const parts: CreateMultipartUploadResponse['parts'][number][] = [];
    let expiresAt = '';
    for (const part of plan.parts) {
      const presigned = await this.s3.presignUploadPart(storageKey, uploadId, part.partNumber);
      parts.push({
        partNumber: part.partNumber,
        uploadUrl: presigned.url,
        sizeBytes: part.sizeBytes,
      });
      expiresAt = presigned.expiresAt; // 전 파트 동일 만료 설정 — 마지막 값으로 대표
    }

    return { storageKey, uploadId, partSizeBytes: plan.partSizeBytes, parts, expiresAt };
  }

  /**
   * 멀티파트 업로드 완료 (대장 #211) — `completeUpload`(단일 PUT)와 검증 불변식이 같다:
   * 자산 일치(임의 key 주입 차단) → 오브젝트 존재 확인 → markReady → completeUpload 전이 → 인큐.
   * 차이는 HEAD 확인 전에 **S3 CompleteMultipartUpload를 먼저 호출**한다는 것뿐이다 — 그 호출 전에는
   * 파트들이 조립되지 않아 오브젝트 자체가 존재하지 않는다. 그 호출이 실패(파트 누락·ETag 불일치 등)
   * 하면 HEAD 부재 분기와 동형으로 취급한다(대장 #168 패턴 재사용) — **완료 경로가 어떤 이유로
   * 실패하든 콘텐츠는 uploading에 남지 않는다(I-2, 대장 #212)**. S3 완료 실패 시 콘텐츠 롤백을
   * 커밋한 뒤 **S3 멀티파트도 best-effort로 abort**한다(게이트② 보완 — 라이프사이클 규칙 부재
   * 실측 확인, API가 정리하지 않으면 uploadId가 영구 회수 불가).
   */
  async completeMultipartUpload(
    user: User,
    id: string,
    dto: CompleteMultipartUploadDto,
  ): Promise<Content> {
    this.requirePipeline();
    const content = await this.contents.loadOwned(user, id);
    if (dto.contentId !== id) {
      throw new DomainException('validation_failed', 'body.contentId가 경로 id와 일치하지 않습니다');
    }
    if (content.status !== 'uploading') {
      throw new DomainException('conflict', 'uploading 상태에서만 완료할 수 있습니다', {
        status: content.status,
      });
    }

    // 클라 임의 key 주입 차단 — 발급된 original 자산 key와 일치해야 함(completeUpload와 동일 규칙)
    const original = await this.assets.findOriginal(id, 1);
    if (!original) {
      // 재-issue 이후에도 원본 자산을 못 찾음(우리 쪽 자산 부재·경합). markFailed로 지울 자산 행
      // 자체가 없으므로 콘텐츠 전이만 롤백한다(I-2).
      await this.prisma.$transaction(async (tx) => {
        await this.workflow.failUploadTx(tx, content, user);
      });
      throw new DomainException('validation_failed', '발급된 업로드 원본을 찾을 수 없습니다');
    }
    if (original.storageKey !== dto.storageKey) {
      // dto.storageKey는 검증되지 않은 클라 입력 — 이 값으로 어떤 media_assets 행도 건드리지 않는다
      // (타 콘텐츠 자산 오염 차단). 그렇더라도 이 요청의 실패가 콘텐츠를 uploading에 고착시켜서는
      // 안 된다(I-2).
      await this.prisma.$transaction(async (tx) => {
        await this.workflow.failUploadTx(tx, content, user);
      });
      throw new DomainException('validation_failed', '발급된 업로드 키와 일치하지 않습니다');
    }

    try {
      await this.s3.completeMultipartUpload(dto.storageKey, dto.uploadId, dto.parts);
    } catch (e) {
      // S3가 파트 누락·ETag 불일치 등을 감지 — 이 자산은 완성되지 못했다. HEAD 부재 분기와
      // 동형(자산 failed 표기 + 콘텐츠 롤백, 단일 트랜잭션 — 대장 #168 패턴).
      //
      // ★ 조율자 보완 지시(게이트② MEDIUM) — 콘텐츠 롤백을 **먼저 커밋**한 뒤, S3에 남은 멀티파트를
      // best-effort로 abort한다. 순서가 중요하다: I-2(콘텐츠가 uploading에 남지 않는다)는 이 시점에
      // 이미 확정돼 있어야 하고, 그 뒤에 시도하는 정리(abort)의 성패가 그 확정을 흔들면 안 된다.
      // 라이프사이클 규칙(AbortIncompleteMultipartUpload) 부재가 실측 확인됐다(제온 MinIO
      // lifecycle.xml 없음) — API가 정리하지 않으면 uploadId는 영구 회수 불가하다.
      await this.prisma.$transaction(async (tx) => {
        await this.assets.markFailed(dto.storageKey, tx);
        await this.workflow.failUploadTx(tx, content, user);
      });
      // abort 자체가 실패해도(uploadId 만료 등) 무시한다 — 원래 에러(완료 실패)를 가리지 않고,
      // 콘텐츠 롤백(I-2)은 이미 위에서 커밋됐으므로 깨지지 않는다. 재시도·큐잉은 만들지 않는다
      // (디스크 여유 1.8T — 긴급하지 않다는 조율자 판단).
      await this.s3.abortMultipartUpload(dto.storageKey, dto.uploadId).catch(() => undefined);
      throw new DomainException('validation_failed', '멀티파트 업로드 완료에 실패했습니다', {
        reason: e instanceof Error ? e.message : String(e),
      });
    }

    const head = await this.s3.headObject(dto.storageKey);
    if (!head) {
      await this.prisma.$transaction(async (tx) => {
        await this.assets.markFailed(dto.storageKey, tx);
        await this.workflow.failUploadTx(tx, content, user);
      });
      throw new DomainException('validation_failed', '업로드된 오브젝트를 찾을 수 없습니다');
    }

    await this.assets.markReady(dto.storageKey, { sizeBytes: head.sizeBytes });
    const updated = await this.workflow.completeUpload(id, user);

    await this.producer.enqueueTranscode(updated);
    return toContent(updated);
  }

  /**
   * 멀티파트 업로드 중단 (대장 #211) — 클라가 명시적으로 취소할 때 쓴다. S3 쪽 파트 정리는
   * 베스트 에포트(실패해도 로그만 — 사용자의 취소 의도는 콘텐츠 롤백으로 이행돼야 한다).
   * 자산 key 검증·불일치/부재 시 콘텐츠 롤백은 completeMultipartUpload와 동일 규칙(I-2) —
   * 완료·중단 양쪽 다 uploading에 콘텐츠를 남기지 않는다.
   */
  async abortMultipartUpload(
    user: User,
    id: string,
    dto: AbortMultipartUploadDto,
  ): Promise<Content> {
    this.requirePipeline();
    const content = await this.contents.loadOwned(user, id);
    if (dto.contentId !== id) {
      throw new DomainException('validation_failed', 'body.contentId가 경로 id와 일치하지 않습니다');
    }
    if (content.status !== 'uploading') {
      throw new DomainException('conflict', 'uploading 상태에서만 중단할 수 있습니다', {
        status: content.status,
      });
    }

    const original = await this.assets.findOriginal(id, 1);
    if (!original) {
      await this.prisma.$transaction(async (tx) => {
        await this.workflow.failUploadTx(tx, content, user);
      });
      throw new DomainException('validation_failed', '발급된 업로드 원본을 찾을 수 없습니다');
    }
    if (original.storageKey !== dto.storageKey) {
      await this.prisma.$transaction(async (tx) => {
        await this.workflow.failUploadTx(tx, content, user);
      });
      throw new DomainException('validation_failed', '발급된 업로드 키와 일치하지 않습니다');
    }

    // S3 측 정리는 베스트 에포트 — 실패해도 사용자의 취소 의도(콘텐츠 롤백)는 이행한다.
    await this.s3.abortMultipartUpload(dto.storageKey, dto.uploadId).catch(() => undefined);

    await this.prisma.$transaction(async (tx) => {
      await this.workflow.failUploadTx(tx, content, user);
    });
    const updated = await this.contents.loadOwned(user, id);
    return toContent(updated);
  }

  /**
   * 업로드 고착 복구 (대장 #224) — `uploading`이 `UPLOAD_STUCK_MS`보다 오래 머물면 강제로
   * `upload_failed`로 되돌려 재발급(ISSUABLE=draft·upload_failed)을 연다. 기자가 올리다 막힌
   * 업로드를 센터가 대신 열어 줄 수 있어야 한다는 정본 결정(CLAUDE.md §4, 2026-09-15)의
   * 서버측 구동부다.
   *
   * ★ **고착 판정은 서버가 한다** — 클라이언트가 "이건 갇혔다"고 주장해도 그대로 믿지 않는다
   * (주간추천 `RecommendationsService.recoverStuck` 선례와 동형). 여기서는 `content.updatedAt`
   * (마지막 전이 시각 — `applyHop`의 CAS UPDATE가 매 홉마다 갱신하므로 `uploading` 진입 시각과
   * 같다)과 서버 시계만으로 경과시간을 재고, 클라이언트는 그 결과(409/200)를 받을 뿐이다.
   *
   * 액터: `loadOwned`(소유 기자 또는 center_operator·admin — 대장 #216이 통일한 것과 같은
   * 의미론). 무관한 기자(타 지사·타 기자 콘텐츠)는 `loadOwned`가 403으로 막는다. 정본상 이
   * 행위의 주된 주체는 센터·admin(CLAUDE.md §4)이지만, 인접한 업로드 액션(`beginUpload`·
   * `completeUpload`·`failUpload`·`failUploadTx`)이 전부 소유 기자도 이미 허용하고 있어
   * (대장 #216) 같은 엣지(`uploading→upload_failed`)에만 다른 액터 규칙을 두면 "왜 이 경로만
   * 다른가"라는 불일치가 생긴다. 기자 본인이 자기 업로드가 멈췄다는 것을 가장 먼저 알아채는
   * 경우(새로고침 후 서버 상태만 `uploading`으로 남아 있는 상황)도 있어, 자기 것을 스스로 여는
   * 것을 막을 이유가 없다고 판단했다 — 다만 이 판단은 위임자 재검토 대상으로 보고에 남긴다.
   *
   * 응답 분기(멱등·경합 — 값은 전부 서버가 그 순간 재조회해 판정, 클라이언트 입력 없음):
   *  · 이미 `upload_failed` → 목표 상태 그대로 반환(멱등 성공). 이미 열려 있는 것을 또 눌러도
   *    새 전이·감사 로그를 쌓지 않는다(재시도 오픈이라는 목적은 이미 달성돼 있다).
   *  · `uploading`이 아닌 다른 상태(다른 단계에서 정상 진행 중이거나 이미 종결) → 409 conflict.
   *    "정상 진행 중"과 "갇힘"을 구분하는 축이 바로 이 분기다 — uploading이 아니면 애초에 이
   *    엔드포인트의 대상이 아니다.
   *  · `uploading`이지만 경과 < `UPLOAD_STUCK_MS` → 409 conflict(details: elapsedMs·stuckMs).
   *    대용량 업로드가 아직 정상 진행 중일 수 있다(오판 방지 — 위임 근거: 원본 최대 173MB,
   *    가정 회선이 origin).
   *  · `uploading` && 경과 ≥ `UPLOAD_STUCK_MS` → `failUploadTx`로 강제 전이(CAS). 그 사이
   *    다른 경로(기자의 정상 completeUpload 등)가 먼저 끝났으면 CAS가 0행 → 409(재조회 유도,
   *    뭉개지 않는다 — `applyHop`의 기본 동작).
   */
  async recoverStalledUpload(user: User, id: string): Promise<Content> {
    const content = await this.contents.loadOwned(user, id);

    if (content.status === 'upload_failed') {
      return toContent(content); // 이미 목표 상태 — 멱등 성공(전이·로그 없음)
    }
    if (content.status !== 'uploading') {
      throw new DomainException(
        'conflict',
        'uploading 상태가 아니라 복구할 수 없습니다 — 정상 진행 중이거나 이미 다른 단계로 넘어갔습니다',
        { status: content.status },
      );
    }

    const stuckMs = this.config.get('UPLOAD_STUCK_MS', { infer: true });
    const elapsedMs = Date.now() - content.updatedAt.getTime();
    if (elapsedMs < stuckMs) {
      throw new DomainException(
        'conflict',
        '아직 정상 업로드 진행 중일 수 있습니다 — 고착 임계에 도달하지 않았습니다',
        { status: content.status, elapsedMs, stuckMs },
      );
    }

    const elapsedSec = Math.round(elapsedMs / 1000);
    await this.prisma.$transaction(async (tx) => {
      await this.workflow.failUploadTx(
        tx,
        content,
        user,
        `업로드 고착 복구 (${elapsedSec}초 경과, 임계 ${Math.round(stuckMs / 1000)}초)`,
      );
    });
    const updated = await this.contents.loadOwned(user, id);
    return toContent(updated);
  }
}
