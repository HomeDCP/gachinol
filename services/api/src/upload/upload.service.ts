import { Injectable } from '@nestjs/common';
import type { Content, IssueUploadUrlResponse, User } from '@gachinol/shared';
import { DomainException } from '../common/errors/domain.exception';
import { toContent } from '../contents/content.mapper';
import { ContentWorkflowService } from '../contents/content-workflow.service';
import { ContentsService } from '../contents/contents.service';
import { MediaAssetsService } from '../media/media-assets.service';
import { S3Service } from '../media/s3.service';
import { PrismaService } from '../prisma/prisma.service';
import { QueueProducerService } from '../queue/queue-producer.service';
import type { CompleteUploadDto, IssueUploadUrlDto } from './schemas/upload.schemas';

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
}
