import type {
  CompleteUploadRequest,
  ContentId,
  IssueUploadUrlRequest,
} from '@gachinol/shared';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { zId } from '../../common/zod';
import type { ZodSchemaOf } from '../../common/zod';

const MAX_ORIGINAL_BYTES = 5 * 1024 ** 3; // 5GB 상한

export const zIssueUploadUrl = z.object({
  contentId: zId<ContentId>(),
  fileName: z.string().min(1).max(300),
  mimeType: z.string().regex(/^video\//, '원본은 비디오여야 합니다'),
  sizeBytes: z.number().int().positive().max(MAX_ORIGINAL_BYTES),
}) satisfies ZodSchemaOf<IssueUploadUrlRequest>;

export const zCompleteUpload = z.object({
  contentId: zId<ContentId>(),
  storageKey: z.string().min(1),
}) satisfies ZodSchemaOf<CompleteUploadRequest>;

export class IssueUploadUrlDto extends createZodDto(zIssueUploadUrl) {}
export class CompleteUploadDto extends createZodDto(zCompleteUpload) {}
