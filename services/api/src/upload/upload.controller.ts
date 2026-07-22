import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Content, IssueUploadUrlResponse, User } from '@gachinol/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CompleteUploadDto, IssueUploadUrlDto } from './schemas/upload.schemas';
import { UploadService } from './upload.service';

/** 업로드 — ContentsController와 경로 prefix('contents') 공유, 라우트 상이 (Nest 허용) */
@ApiTags('contents')
@ApiBearerAuth()
@Controller('contents')
export class UploadController {
  constructor(private readonly upload: UploadService) {}

  @Post(':id/upload-url')
  @HttpCode(200)
  @Roles('reporter')
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
  @Roles('reporter')
  @ApiOperation({ summary: '업로드 완료 — HEAD 검증 → uploading → uploaded, 트랜스코딩 인큐' })
  completeUpload(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() body: CompleteUploadDto,
  ): Promise<Content> {
    return this.upload.completeUpload(user, id, body);
  }
}
