import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * retry/retract 바디 — 현재는 부가 정보 없음(빈 바디 허용). note는 향후 감사용 예약(optional).
 * 빈 바디도 통과하도록 전 필드 optional.
 */
export const zRetryPublication = z.object({
  note: z.string().max(500).optional(),
});

export const zRetractPublication = z.object({
  note: z.string().max(500).optional(),
});

export class RetryPublicationDto extends createZodDto(zRetryPublication) {}
export class RetractPublicationDto extends createZodDto(zRetractPublication) {}
