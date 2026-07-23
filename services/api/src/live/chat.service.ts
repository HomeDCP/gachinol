import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { User } from '@gachinol/shared';
import type { ChatMessage as ChatMessageRow } from '@prisma/client';
import { DomainException } from '../common/errors/domain.exception';
import { newId } from '../common/ids';
import { PrismaService } from '../prisma/prisma.service';
import type { Env } from '../config/env.schema';
import { LiveBroadcaster } from './live.broadcaster';
import { toChatMessage } from './live.mapper';

/**
 * 라이브 채팅 영속·조회·모더레이션. 익명 게스트 userId(FK 없음)도 그대로 저장한다(감사 시 익명 구분).
 * hidden은 행 보존(soft) — 신고 감사 대응.
 */
@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
    private readonly broadcaster: LiveBroadcaster,
  ) {}

  /** chat.send 영속 — visibility='visible'. userId는 인증 user.id ?? 익명 guestId. */
  persist(params: {
    liveSessionId: string;
    userId: string;
    userName: string;
    message: string;
  }): Promise<ChatMessageRow> {
    return this.prisma.chatMessage.create({
      data: {
        id: newId(),
        liveSessionId: params.liveSessionId,
        userId: params.userId,
        userName: params.userName,
        message: params.message,
        visibility: 'visible',
      },
    });
  }

  /** live.join 초기 로드 — visible 최근 N개, sentAt 오름차순 반환(표시 순서) */
  async recentVisible(liveSessionId: string): Promise<ChatMessageRow[]> {
    const limit = this.config.get('LIVE_CHAT_RECENT_LIMIT', { infer: true });
    const rows = await this.prisma.chatMessage.findMany({
      where: { liveSessionId, visibility: 'visible' },
      orderBy: { sentAt: 'desc' },
      take: limit,
    });
    return rows.reverse();
  }

  /**
   * 센터 모더레이션 — visibility visible→hidden CAS + moderatedByUserId. 커밋 후 chat.moderated 브로드캐스트.
   * 이미 hidden이면 count=0 → conflict(멱등 안내). 메시지가 해당 세션 소속인지도 검증.
   */
  async hide(liveSessionId: string, messageId: string, user: User): Promise<ChatMessageRow> {
    const row = await this.prisma.chatMessage.findUnique({ where: { id: messageId } });
    if (!row || row.liveSessionId !== liveSessionId) {
      throw new DomainException('not_found', '채팅 메시지를 찾을 수 없습니다');
    }
    const res = await this.prisma.chatMessage.updateMany({
      where: { id: messageId, visibility: 'visible' },
      data: { visibility: 'hidden', moderatedByUserId: user.id },
    });
    if (res.count === 0) {
      throw new DomainException('conflict', '이미 숨김 처리된 메시지입니다', { messageId });
    }
    this.broadcaster.emitChatModerated({
      liveSessionId: liveSessionId as never,
      chatMessageId: messageId as never,
      visibility: 'hidden',
    });
    const updated = await this.prisma.chatMessage.findUnique({ where: { id: messageId } });
    return updated!;
  }

  /** row → shared ChatMessage(매퍼 재노출 — 게이트웨이 편의) */
  toDto = toChatMessage;
}
