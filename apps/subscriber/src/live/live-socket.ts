import { io } from 'socket.io-client';
import type {
  ChatMessage,
  ChatModeratedPayload,
  LiveJoinAck,
  LiveSessionId,
  LiveStatusChangedPayload,
  LiveViewerCountPayload,
  WsAck,
} from '@gachinol/shared';
import { ApiClientError } from '../api/errors';

/**
 * 구독자 라이브 소켓 — 익명(무인증). 닉네임은 핸드셰이크(auth.nickname)로만 전달한다
 * (shared ClientEventPayloads['chat.send']엔 nickname이 없다 — 재정의 금지). Authorization 미부착.
 * 이벤트명·페이로드·ack는 shared realtime/events.ts를 그대로 소비.
 */

type Listener = (...args: never[]) => void;

/** 실 socket.io Socket과 테스트 목이 공유하는 최소 표면 (socketFactory DI로 목 주입) */
export interface MinimalSocket {
  readonly connected: boolean;
  emitWithAck(event: string, arg: unknown): Promise<unknown>;
  on(event: string, listener: Listener): unknown;
  off(event: string, listener: Listener): unknown;
  disconnect(): unknown;
}

export type SubscriberSocketFactory = (url: string, opts: SubscriberSocketOptions) => MinimalSocket;

export interface SubscriberSocketOptions {
  auth: { nickname: string };
  transports: string[];
  reconnection: boolean;
}

export interface CreateLiveSocketDeps {
  /** REST와 동일 오리진 (getApiBaseUrl()). socket.io가 /socket.io로 업그레이드 */
  url: string;
  /** 표시명 — 재연결 시 socket.io가 auth를 재전송 */
  nickname: string;
  /** 기본 socket.io-client io() — 테스트는 목 주입 */
  socketFactory?: SubscriberSocketFactory;
}

/** ApiErrorCode → 유사 HTTP status (화면의 status 분기 재사용) */
const WS_CODE_STATUS: Record<string, number> = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  validation_failed: 400,
  internal: 500,
};

/** ack {ok:false} → throw(ApiClientError 재사용), {ok:true} → data */
function unwrapAck<T>(ack: WsAck<T>): T {
  if (ack.ok) return ack.data;
  const status = WS_CODE_STATUS[ack.error.code] ?? 400;
  throw new ApiClientError(status, ack.error);
}

export interface LiveSocket {
  /** 룸 조인 — LiveJoinAck(공개 세션 + 최근 채팅). 재연결 시 hook이 재호출 */
  joinLive(id: LiveSessionId): Promise<LiveJoinAck>;
  leaveLive(id: LiveSessionId): Promise<void>;
  /** 채팅 전송 — 저장된 ChatMessage(브로드캐스트와 동일 개체). 실패는 throw */
  sendChat(id: LiveSessionId, message: string): Promise<ChatMessage>;
  onChatNew(cb: (msg: ChatMessage) => void): () => void;
  onChatModerated(cb: (p: ChatModeratedPayload) => void): () => void;
  onViewerCount(cb: (p: LiveViewerCountPayload) => void): () => void;
  onLiveStatus(cb: (p: LiveStatusChangedPayload) => void): () => void;
  /** connect·reconnect 훅 — 재연결 시 live.join 재전송 트리거 */
  onConnect(cb: () => void): () => void;
  close(): void;
}

const defaultFactory: SubscriberSocketFactory = (url, opts) =>
  io(url, opts as Parameters<typeof io>[1]) as unknown as MinimalSocket;

export function createLiveSocket(deps: CreateLiveSocketDeps): LiveSocket {
  const factory = deps.socketFactory ?? defaultFactory;
  const socket = factory(deps.url, {
    auth: { nickname: deps.nickname },
    transports: ['websocket'],
    reconnection: true,
  });

  function subscribe(event: string, cb: Listener): () => void {
    socket.on(event, cb);
    return () => socket.off(event, cb);
  }

  return {
    async joinLive(id) {
      const ack = (await socket.emitWithAck('live.join', {
        liveSessionId: id,
      })) as WsAck<LiveJoinAck>;
      return unwrapAck(ack);
    },
    async leaveLive(id) {
      const ack = (await socket.emitWithAck('live.leave', {
        liveSessionId: id,
      })) as WsAck<null>;
      unwrapAck(ack);
    },
    async sendChat(id, message) {
      const ack = (await socket.emitWithAck('chat.send', {
        liveSessionId: id,
        message,
      })) as WsAck<ChatMessage>;
      return unwrapAck(ack);
    },
    onChatNew: (cb) => subscribe('chat.new', cb as Listener),
    onChatModerated: (cb) => subscribe('chat.moderated', cb as Listener),
    onViewerCount: (cb) => subscribe('live.viewer_count', cb as Listener),
    onLiveStatus: (cb) => subscribe('live.status_changed', cb as Listener),
    onConnect: (cb) => subscribe('connect', cb as Listener),
    close: () => {
      socket.disconnect();
    },
  };
}
