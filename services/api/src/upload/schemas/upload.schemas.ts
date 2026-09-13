import type {
  AbortMultipartUploadRequest,
  CompleteMultipartUploadRequest,
  CompleteUploadRequest,
  ContentId,
  CreateMultipartUploadRequest,
  IssueUploadUrlRequest,
} from '@gachinol/shared';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { zId } from '../../common/zod';
import type { ZodSchemaOf } from '../../common/zod';
import { MULTIPART_MAX_PART_COUNT } from '../../media/s3.service';

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

/** 필드는 zIssueUploadUrl과 동일 — 응답 형태가 달라 별도 계약(shared dto.ts 주석 참조, 대장 #211) */
export const zCreateMultipartUpload = z.object({
  contentId: zId<ContentId>(),
  fileName: z.string().min(1).max(300),
  mimeType: z.string().regex(/^video\//, '원본은 비디오여야 합니다'),
  sizeBytes: z.number().int().positive().max(MAX_ORIGINAL_BYTES),
}) satisfies ZodSchemaOf<CreateMultipartUploadRequest>;

const zCompletedUploadPart = z.object({
  partNumber: z.number().int().positive(),
  eTag: z.string().min(1),
});

export const zCompleteMultipartUpload = z.object({
  contentId: zId<ContentId>(),
  storageKey: z.string().min(1),
  uploadId: z.string().min(1),
  parts: z.array(zCompletedUploadPart).min(1).max(MULTIPART_MAX_PART_COUNT),
}) satisfies ZodSchemaOf<CompleteMultipartUploadRequest>;

export const zAbortMultipartUpload = z.object({
  contentId: zId<ContentId>(),
  storageKey: z.string().min(1),
  uploadId: z.string().min(1),
}) satisfies ZodSchemaOf<AbortMultipartUploadRequest>;

export class IssueUploadUrlDto extends createZodDto(zIssueUploadUrl) {}
export class CompleteUploadDto extends createZodDto(zCompleteUpload) {}
export class CreateMultipartUploadDto extends createZodDto(zCreateMultipartUpload) {}
export class CompleteMultipartUploadDto extends createZodDto(zCompleteMultipartUpload) {}
export class AbortMultipartUploadDto extends createZodDto(zAbortMultipartUpload) {}
