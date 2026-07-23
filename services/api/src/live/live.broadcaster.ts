import { Injectable, Logger } from '@nestjs/common';
import type {
  ChatMessage,
  ChatModeratedPayload,
  LiveStatusChangedPayload,
  LiveViewerCountPayload,
  PrompterCommentsPayload,
} from '@gachinol/shared';
import { CONTROL_ROOM, liveRoom, prompterRoom } from '@gachinol/shared';
import type { Server } from 'socket.io';

/**
 * 타입 세이프 emit 표면 — io Server ref 홀더. 게이트웨이 afterInit(server)에서 bind한다.
 * 서비스↔게이트웨이 사이클 차단(서비스는 이 홀더만 주입). server 미bind(부팅 초기·테스트)면 emit no-op.
 * 향후 PipelineModule의 content.status_changed 푸시도 이 export 지점을 주입해 재사용한다.
 */
@Injectable()
export class LiveBroadcaster {
  private readonly logger = new Logger(LiveBroadcaster.name);
  private server: Server | null = null;
  /** liveSessionId → 참가 소켓 id 집합(단일 인스턴스 프레즌스). 다중 인스턴스는 언더카운트(정직 표기). */
  private readonly presence = new Map<string, Set<string>>();

  bind(server: Server): void {
    this.server = server;
  }

  /** 전이 커밋 후 — 시청 룸 + 관제 룸 양쪽에 상태 변경 푸시 */
  emitLiveStatus(payload: LiveStatusChangedPayload): void {
    if (!this.server) return;
    this.server.to(liveRoom(payload.liveSessionId)).emit('live.status_changed', payload);
    this.server.to(CONTROL_ROOM).emit('live.status_changed', payload);
  }

  emitViewerCount(payload: LiveViewerCountPayload): void {
    this.server?.to(liveRoom(payload.liveSessionId)).emit('live.viewer_count', payload);
  }

  /** chat.send 영속 후 — 시청 룸에 브로드캐스트(ack과 동일 개체) */
  emitChatNew(message: ChatMessage): void {
    this.server?.to(liveRoom(message.liveSessionId)).emit('chat.new', message);
  }

  emitChatModerated(payload: ChatModeratedPayload): void {
    this.server?.to(liveRoom(payload.liveSessionId)).emit('chat.moderated', payload);
  }

  /** 수집 배치 — 프롬프터 룸(아나운서·센터)에만 */
  emitPrompterComments(payload: PrompterCommentsPayload): void {
    if (payload.comments.length === 0) return;
    this.server?.to(prompterRoom(payload.liveSessionId)).emit('prompter.comments', payload);
  }

  /** 프레즌스 증가 — 반환=현재 인원(단일 인스턴스). 게이트웨이 live.join에서 호출. */
  addPresence(liveSessionId: string, socketId: string): number {
    let set = this.presence.get(liveSessionId);
    if (!set) {
      set = new Set();
      this.presence.set(liveSessionId, set);
    }
    set.add(socketId);
    return set.size;
  }

  /** 프레즌스 감소 — 반환=현재 인원. 게이트웨이 leave/disconnect에서 호출. */
  removePresence(liveSessionId: string, socketId: string): number {
    const set = this.presence.get(liveSessionId);
    if (!set) return 0;
    set.delete(socketId);
    if (set.size === 0) this.presence.delete(liveSessionId);
    return set.size;
  }

  /** 현재 시청 인원(단일 인스턴스 정확). fetchSockets 미사용(Redis 어댑터 미가용 시 행 회피). */
  viewerCount(liveSessionId: string): number {
    return this.presence.get(liveSessionId)?.size ?? 0;
  }
}
