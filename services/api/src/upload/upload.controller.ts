import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type {
  Content,
  CreateMultipartUploadResponse,
  IssueUploadUrlResponse,
  User,
} from '@gachinol/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import {
  AbortMultipartUploadDto,
  CompleteMultipartUploadDto,
  CompleteUploadDto,
  CreateMultipartUploadDto,
  IssueUploadUrlDto,
} from './schemas/upload.schemas';
import { UploadService } from './upload.service';

/** 업로드 — ContentsController와 경로 prefix('contents') 공유, 라우트 상이 (Nest 허용) */
@ApiTags('contents')
@ApiBearerAuth()
@Controller('contents')
export class UploadController {
  constructor(private readonly upload: UploadService) {}

  @Post(':id/upload-url')
  @HttpCode(200)
  @Roles('reporter', 'center_operator')
  @ApiOperation({ summary: 'presigned PUT 발급 — draft·upload_failed → uploading + original(pending)' })
  issueUploadUrl(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() body: IssueUploadUrlDto,
  ): Promise<IssueUploadUrlResponse> {
    return this.upload.issueUploadUrl(user, id, body);
  }

  @Post(':id/upload-complete')
  @HttpCode(200)
  @Roles('reporter', 'center_operator')
  @ApiOperation({ summary: '업로드 완료 — HEAD 검증 → uploading → uploaded, 트랜스코딩 인큐' })
  completeUpload(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() body: CompleteUploadDto,
  ): Promise<Content> {
    return this.upload.completeUpload(user, id, body);
  }

  /**
   * 멀티파트 업로드 3종 (대장 #211) — Cloudflare 터널이 단일 요청 바디를 100MiB로 제한해
   * 큰 원본은 위 단일 PUT 경로로 못 올라간다. 역할 게이트·상태 가드는 위 두 라우트와 동일.
   */
  @Post(':id/multipart-upload')
  @HttpCode(200)
  @Roles('reporter', 'center_operator')
  @ApiOperation({ summary: '멀티파트 업로드 시작 — draft·upload_failed → uploading + 파트별 presigned URL' })
  startMultipartUpload(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() body: CreateMultipartUploadDto,
  ): Promise<CreateMultipartUploadResponse> {
    return this.upload.startMultipartUpload(user, id, body);
  }

  @Post(':id/multipart-upload-complete')
  @HttpCode(200)
  @Roles('reporter', 'center_operator')
  @ApiOperation({ summary: '멀티파트 업로드 완료 — S3 조립 → HEAD 검증 → uploading → uploaded' })
  completeMultipartUpload(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() body: CompleteMultipartUploadDto,
  ): Promise<Content> {
    return this.upload.completeMultipartUpload(user, id, body);
  }

  @Post(':id/multipart-upload-abort')
  @HttpCode(200)
  @Roles('reporter', 'center_operator')
  @ApiOperation({ summary: '멀티파트 업로드 중단 — uploading → upload_failed, 재-issue로 복구' })
  abortMultipartUpload(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() body: AbortMultipartUploadDto,
  ): Promise<Content> {
    return this.upload.abortMultipartUpload(user, id, body);
  }
}
