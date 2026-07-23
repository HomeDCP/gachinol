import { useEffect, useRef, useState } from 'react';
import type { LiveComment, LiveSessionId, LiveSessionStatus } from '@gachinol/shared';
import { useApiClient } from '../auth/auth-context';
import { getApiBaseUrl } from '../config/env';
import { mergePrompterComments, seedPrompterComments, selectQuestions } from '../features/live/prompter-store';
import { createControlSocket, type ControlSocket, type ControlSocketFactory } from './live-socket';

export interface UseLivePrompterOptions {
  liveSessionId: LiveSessionId;
  socketFactory?: ControlSocketFactory;
}

export interface UseLivePrompterResult {
  comments: readonly LiveComment[];
  /** isQuestion만 (아나운서 우선 응답 후보) */
  questions: readonly LiveComment[];
  connected: boolean;
  /** WS status_changed로 갱신 — 관제 상태 표시용(초기 null) */
  liveStatus: LiveSessionStatus | null;
}

/**
 * 아나운서 프롬프터 배선 — JWT 소켓 생성·prompter.join(연결/재연결마다 재전송)·recentComments 시드·
 * prompter.comments 배치 누적(postedAt 오름차순 dedupe)·status_changed 반영. 언마운트 시 close.
 * 토큰은 client.getFreshAccessToken(함수형 auth)로 (재)연결마다 최신 access 재-auth.
 */
export function useLivePrompter(opts: UseLivePrompterOptions): UseLivePrompterResult {
  const { liveSessionId, socketFactory } = opts;
  const client = useApiClient();

  const [comments, setComments] = useState<readonly LiveComment[]>([]);
  const [connected, setConnected] = useState(false);
  const [liveStatus, setLiveStatus] = useState<LiveSessionStatus | null>(null);
  const socketRef = useRef<ControlSocket | null>(null);

  useEffect(() => {
    const socket = createControlSocket({
      url: getApiBaseUrl(),
      getToken: () => client.getFreshAccessToken(),
      socketFactory,
    });
    socketRef.current = socket;

    let active = true;

    const join = async (): Promise<void> => {
      try {
        const ack = await socket.prompterJoin(liveSessionId);
        // 관제 공용 룸(CONTROL_ROOM) 조인 — live.status_changed는 프롬프터 룸엔 방출되지 않으므로
        // 이 소켓이 상태 전이(자동 중단·타 운영자 조작 등)를 실시간 수신하려면 반드시 필요.
        await socket.controlJoin();
        if (!active) return;
        setConnected(true);
        setComments(seedPrompterComments(ack.recentComments));
      } catch {
        if (active) setConnected(false);
      }
    };

    const offConnect = socket.onConnect(() => {
      void join();
    });
    const offComments = socket.onPrompterComments((p) => {
      if (p.liveSessionId !== liveSessionId) return;
      setComments((prev) => mergePrompterComments(prev, p.comments));
    });
    const offStatus = socket.onLiveStatus((p) => {
      if (p.liveSessionId === liveSessionId) setLiveStatus(p.to);
    });

    // autoConnect라 'connect' 방출 전일 수 있어 즉시 1회 join도 시도(멱등)
    void join();

    return () => {
      active = false;
      offConnect();
      offComments();
      offStatus();
      socket.close();
      socketRef.current = null;
    };
  }, [liveSessionId, client, socketFactory]);

  return { comments, questions: selectQuestions(comments), connected, liveStatus };
}
