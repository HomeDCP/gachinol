import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type {
  ChatMessage,
  ClientEventPayloads,
  LiveJoinAck,
  LiveSessionId,
  PrompterJoinAck,
  User,
  UserRole,
  WsAck,
} from '@gachinol/shared';
import { CONTROL_ROOM, liveRoom, prompterRoom, toId, userRoom } from '@gachinol/shared';
import type { Server, Socket } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import IORedis from 'ioredis';
import { v7 as uuidv7 } from 'uuid';
import { DomainException } from '../common/errors/domain.exception';
import type { Env } from '../config/env.schema';
import { ChatRateLimiter } from './chat-rate-limiter';
import { ChatService } from './chat.service';
import { CommentCollectorService } from './comment-collector.service';
import { LiveBroadcaster } from './live.broadcaster';
import { LiveCommentsService } from './live-comments.service';
import { LiveSessionsService } from './live-sessions.service';
import { toChatMessage, toLiveComment, toLiveSessionPublic } from './live.mapper';
import { WsAuthService } from './ws-auth.service';
import { wsError, wsOk } from './ws-ack';

interface SocketData {
  user: User | null;
  guestId: string;
  nickname: string;
  /** 참가 중인 라이브 세션 — disconnect 시 프레즌스 정산용(socket.rooms는 그 시점 비어있음) */
  liveSessions: Set<string>;
  /** 핸드셰이크 JWT 검증 완료 신호 — 핸들러는 이걸 await한 뒤 user를 읽어 연결 직후 경합을 없앤다 */
  authReady: Promise<void>;
}

const PROMPTER_ROLES: readonly UserRole[] = ['announcer', 'center_operator', 'admin'];
const CONTROL_ROLES: readonly UserRole[] = ['center_operator', 'announcer', 'admin'];

/**
 * 라이브 WS 게이트웨이 — 단일 네임스페이스. 채팅 룸=익명 공개(닉네임=핸드셰이크), 프롬프터·관제 룸=JWT 게이트.
 * 전역 AllExceptionsFilter는 HTTP 전용이라 각 핸들러가 try/catch→ws-ack으로 오류를 직렬화한다.
 * Redis 어댑터는 afterInit에서 REDIS_URL 있을 때만 주입(다중 인스턴스 fan-out) — 없으면 단일 인스턴스 저하.
 */
@WebSocketGateway({ cors: { origin: true, credentials: true } })
export class LiveGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(LiveGateway.name);
  @WebSocketServer() private readonly server!: Server;
  private rateLimiter!: ChatRateLimiter;
  private redisPub: IORedis | null = null;
  private redisSub: IORedis | null = null;

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly auth: WsAuthService,
    private readonly sessions: LiveSessionsService,
    private readonly chat: ChatService,
    private readonly comments: LiveCommentsService,
    private readonly collector: CommentCollectorService,
    private readonly broadcaster: LiveBroadcaster,
  ) {}

  afterInit(server: Server): void {
    this.broadcaster.bind(server);
    this.rateLimiter = new ChatRateLimiter(
      this.config.get('LIVE_CHAT_RATE_CAPACITY', { infer: true }),
      this.config.get('LIVE_CHAT_RATE_REFILL_MS', { infer: true }),
    );

    const redisUrl = this.config.get('REDIS_URL', { infer: true });
    if (redisUrl) {
      try {
        this.redisPub = new IORedis(redisUrl, { maxRetriesPerRequest: null, lazyConnect: true });
        this.redisSub = this.redisPub.duplicate();
        this.redisPub.on('error', (e) => this.logger.warn(`WS Redis pub 오류(무시): ${e.message}`));
        this.redisSub.on('error', (e) => this.logger.warn(`WS Redis sub 오류(무시): ${e.message}`));
        server.adapter(createAdapter(this.redisPub, this.redisSub));
        this.logger.log('socket.io Redis 어댑터 주입 — 다중 인스턴스 fan-out 활성');
      } catch (e) {
        this.logger.warn(`Redis 어댑터 주입 실패 — 단일 인스턴스로 진행: ${e instanceof Error ? e.message : e}`);
      }
    } else {
      this.logger.log('REDIS_URL 미설정 — 단일 인스턴스 in-memory 어댑터(우아한 저하)');
    }
  }

  /**
   * graceful shutdown — 로컬 keep-alive 소켓만 정리한다(Node 18.2+ closeAllConnections).
   *
   * ★ Redis 어댑터의 pub/sub ioredis는 여기서 건드리지 않는다(의도).
   *   - quit()은 Redis 다운 시 QUIT 왕복을 기다리다 app.close()를 무한 행시킨다.
   *   - disconnect()는 연결을 'end'로 만들어, 이후 Nest dispose가 부르는 RedisAdapter.close()의
   *     punsubscribe가 "Connection is closed"로 거부되는 미처리 rejection을 유발한다.
   *   socket.io/Nest가 io.close()에서 어댑터를 정리하도록 두면 Redis-up은 깨끗이 unsubscribe되고,
   *   Redis-down은 오프라인 큐가 흡수한다(거부 없음). 잔여 ioredis 핸들은 프로세스 종료 시 정리된다.
   */
  async closeAdapters(): Promise<void> {
    try {
      const httpServer = (this.server as unknown as { httpServer?: { closeAllConnections?: () => void } } | undefined)
        ?.httpServer;
      httpServer?.closeAllConnections?.();
    } catch (e) {
      this.logger.warn(`WS 종료 정리 경고: ${e instanceof Error ? e.message : e}`);
    }
    this.redisPub = null;
    this.redisSub = null;
    return Promise.resolve();
  }

  handleConnection(socket: Socket): void {
    // 동기 파트에서 socket.data를 먼저 세팅(이후 도착하는 메시지 핸들러가 항상 data를 본다) →
    // JWT 검증은 authReady로 비동기 진행(핸들러가 await). 연결 직후 prompter.join 경합 제거.
    const token = this.extractToken(socket);
    const data: SocketData = {
      user: null,
      guestId: uuidv7(),
      nickname: this.sanitizeNickname(socket.handshake.auth?.nickname),
      liveSessions: new Set(),
      authReady: Promise.resolve(),
    };
    socket.data = data;
    data.authReady = this.auth.verify(token).then((user) => {
      if (user) {
        data.user = user;
        socket.join(userRoom(user.id)); // shared 규약: 연결 인증 시 자동 join
      }
    });
  }

  handleDisconnect(socket: Socket): void {
    const data = socket.data as SocketData;
    if (!data) return;
    for (const liveSessionId of data.liveSessions) {
      this.leaveLive(socket, liveSessionId);
    }
    this.rateLimiter?.drop(this.rateKey(socket));
  }

  // ── 채팅 룸(익명 공개) ──────────────────────────────────────

  @SubscribeMessage('live.join')
  async onLiveJoin(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: ClientEventPayloads['live.join'],
  ): Promise<WsAck<LiveJoinAck>> {
    try {
      const session = await this.sessions.loadOr404(body.liveSessionId);
      if (!LiveSessionsService.isJoinable(session.status)) {
        throw new DomainException('conflict', '참여할 수 없는 라이브 상태입니다', {
          status: session.status,
        });
      }
      const data = socket.data as SocketData;
      socket.join(liveRoom(toId<LiveSessionId>(session.id)));
      data.liveSessions.add(session.id);
      const total = this.broadcaster.addPresence(session.id, socket.id);
      this.broadcaster.emitViewerCount({ liveSessionId: session.id as never, total });

      const recent = await this.chat.recentVisible(session.id);
      const ack: LiveJoinAck = {
        session: toLiveSessionPublic(session, total),
        recentChat: recent.map(toChatMessage),
      };
      return wsOk(ack);
    } catch (e) {
      return wsError(e);
    }
  }

  @SubscribeMessage('live.leave')
  onLiveLeave(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: ClientEventPayloads['live.leave'],
  ): WsAck<null> {
    try {
      this.leaveLive(socket, body.liveSessionId);
      return wsOk(null);
    } catch (e) {
      return wsError(e);
    }
  }

  @SubscribeMessage('chat.send')
  async onChatSend(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: ClientEventPayloads['chat.send'],
  ): Promise<WsAck<ChatMessage>> {
    try {
      const data = socket.data as SocketData;
      await data.authReady; // 인증 사용자면 user.id/name으로 저장(연결 직후 경합 제거)
      if (!data.liveSessions.has(body.liveSessionId)) {
        throw new DomainException('conflict', '먼저 live.join 후 전송하세요', {
          liveSessionId: body.liveSessionId,
        });
      }
      const session = await this.sessions.loadOr404(body.liveSessionId);
      if (session.status !== 'live') {
        throw new DomainException('conflict', '방송 중일 때만 채팅할 수 있습니다', {
          status: session.status,
        });
      }
      const message = (body.message ?? '').trim();
      const maxLen = this.config.get('LIVE_CHAT_MESSAGE_MAX_LEN', { infer: true });
      if (message.length === 0) {
        throw new DomainException('validation_failed', '빈 메시지는 보낼 수 없습니다');
      }
      if (message.length > maxLen) {
        throw new DomainException('validation_failed', `메시지는 ${maxLen}자를 넘을 수 없습니다`, {
          maxLen,
        });
      }
      const gate = this.rateLimiter.check(this.rateKey(socket));
      if (!gate.allowed) {
        throw new DomainException('validation_failed', '메시지를 너무 빠르게 보냈습니다', {
          reason: 'rate_limited',
          retryAfterMs: gate.retryAfterMs,
        });
      }

      const row = await this.chat.persist({
        liveSessionId: session.id,
        userId: data.user?.id ?? data.guestId,
        userName: data.user?.name ?? data.nickname,
        message,
      });
      const dto = toChatMessage(row);
      this.broadcaster.emitChatNew(dto);
      return wsOk(dto);
    } catch (e) {
      return wsError(e);
    }
  }

  // ── 프롬프터·관제 룸(JWT 게이트) ─────────────────────────────

  @SubscribeMessage('prompter.join')
  async onPrompterJoin(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: ClientEventPayloads['prompter.join'],
  ): Promise<WsAck<PrompterJoinAck>> {
    try {
      await this.requireRole(socket, PROMPTER_ROLES);
      await this.sessions.loadOr404(body.liveSessionId);
      socket.join(prompterRoom(body.liveSessionId));
      const recent = await this.comments.recentForPrompter(body.liveSessionId);
      const ack: PrompterJoinAck = { recentComments: recent.map(toLiveComment) };
      return wsOk(ack);
    } catch (e) {
      return wsError(e);
    }
  }

  @SubscribeMessage('control.join')
  async onControlJoin(@ConnectedSocket() socket: Socket): Promise<WsAck<null>> {
    try {
      await this.requireRole(socket, CONTROL_ROLES);
      socket.join(CONTROL_ROOM);
      return wsOk(null);
    } catch (e) {
      return wsError(e);
    }
  }

  // ── 내부 ────────────────────────────────────────────────

  private async requireRole(socket: Socket, roles: readonly UserRole[]): Promise<void> {
    await (socket.data as SocketData).authReady; // 연결 직후 검증 완료 대기
    const user = (socket.data as SocketData).user;
    if (!user) throw new DomainException('unauthorized', '인증이 필요합니다');
    if (user.role !== 'admin' && !roles.includes(user.role)) {
      throw new DomainException('forbidden', '이 룸에 참여할 권한이 없습니다', { role: user.role });
    }
  }

  private leaveLive(socket: Socket, liveSessionId: string): void {
    const data = socket.data as SocketData;
    if (!data.liveSessions.has(liveSessionId)) return;
    socket.leave(liveRoom(toId<LiveSessionId>(liveSessionId)));
    data.liveSessions.delete(liveSessionId);
    const total = this.broadcaster.removePresence(liveSessionId, socket.id);
    this.broadcaster.emitViewerCount({ liveSessionId: liveSessionId as never, total });
  }

  private rateKey(socket: Socket): string {
    const data = socket.data as SocketData;
    return data.user?.id ?? data.guestId;
  }

  private extractToken(socket: Socket): string | undefined {
    const auth = socket.handshake.auth as { token?: unknown } | undefined;
    if (typeof auth?.token === 'string' && auth.token) return auth.token;
    const header = socket.handshake.headers.authorization;
    if (header) {
      const [scheme, token] = header.split(' ');
      if (scheme?.toLowerCase() === 'bearer' && token) return token;
    }
    return undefined;
  }

  private sanitizeNickname(raw: unknown): string {
    if (typeof raw === 'string') {
      const trimmed = raw.trim().slice(0, 40);
      if (trimmed.length > 0) return trimmed;
    }
    return `익명${Math.floor(Math.random() * 10000)
      .toString()
      .padStart(4, '0')}`;
  }
}
