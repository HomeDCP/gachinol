import { Logger } from '@nestjs/common';
import type { Platform } from '@gachinol/shared';
import type {
  CommentPollInput,
  CommentPollResult,
  CommentSourceAdapter,
  RawComment,
} from './comment-source.adapter';

/** 결정적 목의 고정 배치 크기 — poll마다 동일 집합 산출(재수집은 DB unique로 dedup=신규0) */
const MOCK_BATCH = 5;
/** 결정적 기준 시각 — seq만큼 분 단위로 단조 증가 */
const BASE_MS = Date.parse('2026-07-25T10:00:00.000Z');

/**
 * SNS 댓글 목 어댑터 — 배포 기본(외부 네트워크 0·결정적). 플랫폼별 인스턴스(youtube/meta/x/threads).
 *
 * 결정적 규약:
 *  - externalCommentId = `${platform}-${externalChannelId}-${seq}` (seq 1..MOCK_BATCH)
 *  - poll은 sinceCursor와 무관하게 동일 고정 집합 산출 → 재-poll은 DB unique(channel,external)로 dedup(신규0).
 *    (수집기 멱등의 단일 진실을 DB에 둔다 — 인메모리 커서 상태 불요, 재호출 신규0 보장.)
 *  - N번째(seq%3===0)는 isQuestion=true(메시지에 '?' 포함 → 휴리스틱도 일치).
 *  - externalChannelId가 'fail-' 접두면 throw(수집 실패 경로 재현 — kakao-mock 선례).
 */
export class CommentMockAdapter implements CommentSourceAdapter {
  private readonly logger = new Logger(CommentMockAdapter.name);

  constructor(
    readonly platform: Platform,
    private readonly batch = MOCK_BATCH,
  ) {}

  poll(input: CommentPollInput): Promise<CommentPollResult> {
    if (input.externalChannelId.startsWith('fail-')) {
      return Promise.reject(
        new Error(`댓글 수집 목 실패(결정적): ${this.platform}/${input.externalChannelId}`),
      );
    }
    const comments: RawComment[] = [];
    for (let seq = 1; seq <= this.batch; seq++) {
      const isQuestion = seq % 3 === 0;
      comments.push({
        externalCommentId: `${this.platform}-${input.externalChannelId}-${seq}`,
        authorName: `${this.platform}_user_${seq}`,
        authorExternalId: `${this.platform}_uid_${seq}`,
        message: isQuestion
          ? `[${this.platform}] 이장님 내일 물때 어떤가요?`
          : `[${this.platform}] 방송 잘 보고 있습니다 ${seq}`,
        isQuestion,
        postedAt: new Date(BASE_MS + seq * 60_000).toISOString(),
      });
    }
    this.logger.debug(`목 댓글 ${comments.length}건 (${this.platform}/${input.externalChannelId})`);
    return Promise.resolve({ comments, nextCursor: String(this.batch) });
  }
}
