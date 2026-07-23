import { Logger } from '@nestjs/common';
import type { Platform } from '@gachinol/shared';
import type {
  CommentPollInput,
  CommentPollResult,
  CommentSourceAdapter,
} from './comment-source.adapter';

/**
 * 실 SNS 댓글 어댑터 스텁 — 플랫폼 키(env) 존재 시에만 레지스트리에 등록되는 격리 확장점.
 * 실 API 연동(YouTube liveChatMessages / Meta Graph comments / X / Threads)은 후속.
 * 현재는 미구현 시그널(throw) — 수집기의 per-channel catch가 흡수해 계속 진행한다(조용한 실패 금지).
 */
export class RealCommentSourceAdapter implements CommentSourceAdapter {
  private readonly logger = new Logger(RealCommentSourceAdapter.name);

  constructor(
    readonly platform: Platform,
    private readonly credential: string,
  ) {}

  poll(_input: CommentPollInput): Promise<CommentPollResult> {
    this.logger.warn(`실 댓글 어댑터 미구현: ${this.platform} (credential ref 보유=${!!this.credential})`);
    return Promise.reject(new Error(`실 댓글 어댑터 미구현: ${this.platform}`));
  }
}
