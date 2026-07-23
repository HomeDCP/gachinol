import { io } from 'socket.io-client';
import type {
  LiveSessionId,
  LiveStatusChangedPayload,
  LiveViewerCountPayload,
  PrompterCommentsPayload,
  PrompterJoinAck,
  WsAck,
} from '@gachinol/shared';
import { ApiClientError } from '../api/errors';

/**
 * 센터 관제 소켓 — JWT 게이트(프롬프터·관제 룸). auth.token은 함수형으로 전달해
 * socket.io가 매 (재)연결마다 getToken()을 호출 → 최신 access로 재-auth(만료 대비 선제 refresh 포함).
 * 이벤트·페이로드·ack는 shared realtime/events.ts 그대로 소비.
 */

type Listener = (...args: never[]) => void;
type AuthCallback = (data: Record<string, unknown>) => void;

export interface MinimalSocket {
  readonly connected: boolean;
  emitWithAck(event: string, arg: unknown): Promise<unknown>;
  on(event: string, listener: Listener): unknown;
  off(event: string, listener: Listener): unknown;
  disconnect(): unknown;
}

export interface ControlSocketOptions {
  auth: (cb: AuthCallback) => void;
  transports: string[];
  reconnection: boolean;
}

export type ControlSocketFactory = (url: string, opts: ControlSocketOptions) => MinimalSocket;

export interface CreateControlSocketDeps {
  url: string;
  /** 신선한 access 토큰 공급 — 매 (재)연결 시 호출(client.getFreshAccessToken) */
  getToken: () => Promise<string | null>;
  socketFactory?: ControlSocketFactory;
}

const WS_CODE_STATUS: Record<string, number> = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  validation_failed: 400,
  internal: 500,
};

function unwrapAck<T>(ack: WsAck<T>): T {
  if (ack.ok) return ack.data;
  const status = WS_CODE_STATUS[ack.error.code] ?? 400;
  throw new ApiClientError(status, ack.error);
}

export interface ControlSocket {
  /** 프롬프터 룸 조인 — 초기 recentComments. 재연결 시 hook이 재호출 */
  prompterJoin(id: LiveSessionId): Promise<PrompterJoinAck>;
  /** 관제 공용 룸 조인 — 라이브 상태 브로드캐스트 수신 */
  controlJoin(): Promise<void>;
  onPrompterComments(cb: (p: PrompterCommentsPayload) => void): () => void;
  onLiveStatus(cb: (p: LiveStatusChangedPayload) => void): () => void;
  onViewerCount(cb: (p: LiveViewerCountPayload) => void): () => void;
  onConnect(cb: () => void): () => void;
  close(): void;
}

const defaultFactory: ControlSocketFactory = (url, opts) =>
  io(url, opts as Parameters<typeof io>[1]) as unknown as MinimalSocket;

export function createControlSocket(deps: CreateControlSocketDeps): ControlSocket {
  const factory = deps.socketFactory ?? defaultFactory;
  const socket = factory(deps.url, {
    // 함수형 auth: socket.io가 (재)연결마다 호출 → 최신 access 재-auth
    auth: (cb) => {
      void deps
        .getToken()
        .then((token) => cb({ token: token ?? '' }))
        .catch(() => cb({ token: '' }));
    },
    transports: ['websocket'],
    reconnection: true,
  });

  function subscribe(event: string, cb: Listener): () => void {
    socket.on(event, cb);
    return () => socket.off(event, cb);
  }

  return {
    async prompterJoin(id) {
      const ack = (await socket.emitWithAck('prompter.join', {
        liveSessionId: id,
      })) as WsAck<PrompterJoinAck>;
      return unwrapAck(ack);
    },
    async controlJoin() {
      const ack = (await socket.emitWithAck('control.join', {})) as WsAck<null>;
      unwrapAck(ack);
    },
    onPrompterComments: (cb) => subscribe('prompter.comments', cb as Listener),
    onLiveStatus: (cb) => subscribe('live.status_changed', cb as Listener),
    onViewerCount: (cb) => subscribe('live.viewer_count', cb as Listener),
    onConnect: (cb) => subscribe('connect', cb as Listener),
    close: () => {
      socket.disconnect();
    },
  };
}
