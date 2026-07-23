import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatMessage, LiveSessionId, LiveSessionPublic } from '@gachinol/shared';
import { userMessageForError } from '../api/errors';
import { getApiBaseUrl } from '../config/env';
import { appendChat, removeChat, seedChat } from './chat-store';
import { createLiveSocket, type LiveSocket, type SubscriberSocketFactory } from './live-socket';

export interface UseLiveChatOptions {
  liveSessionId: LiveSessionId;
  /** 표시명 — 비어있으면 소켓을 만들지 않는다(닉네임 입력 게이트) */
  nickname: string;
  socketFactory?: SubscriberSocketFactory;
}

export interface UseLiveChatResult {
  messages: readonly ChatMessage[];
  /** WS 조인 ack·status_changed로 갱신되는 공개 세션(초기 null) */
  session: LiveSessionPublic | null;
  viewerCount: number;
  connected: boolean;
  /** 채팅 전송 — 실패는 sendError로 표면화(throw 없음) */
  send(message: string): Promise<void>;
  sendError: string | null;
  sending: boolean;
}

/**
 * 라이브 채팅 배선 — 소켓 생성·live.join(연결/재연결마다 재전송)·recentChat 시드·
 * chat.new append·chat.moderated 제거·viewer_count·status_changed 반영. 언마운트 시 leave+close.
 * 낙관적 반영 없음(ack/broadcast가 유일 진실원). status!=='live'면 전송 비활성은 화면이 판단.
 */
export function useLiveChat(opts: UseLiveChatOptions): UseLiveChatResult {
  const { liveSessionId, nickname, socketFactory } = opts;

  const [messages, setMessages] = useState<readonly ChatMessage[]>([]);
  const [session, setSession] = useState<LiveSessionPublic | null>(null);
  const [viewerCount, setViewerCount] = useState(0);
  const [connected, setConnected] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const socketRef = useRef<LiveSocket | null>(null);

  useEffect(() => {
    if (nickname.length === 0) return;

    const socket = createLiveSocket({
      url: getApiBaseUrl(),
      nickname,
      socketFactory,
    });
    socketRef.current = socket;

    let active = true;

    const join = async (): Promise<void> => {
      try {
        const ack = await socket.joinLive(liveSessionId);
        if (!active) return;
        setConnected(true);
        setSession(ack.session);
        setViewerCount(ack.session.viewerCount);
        // 재연결 재조인 — 서버 recentChat로 재시드(룸 재구독 + 최신 상태)
        setMessages(seedChat(ack.recentChat));
      } catch {
        if (active) setConnected(false);
      }
    };

    // connect(초기·재연결)마다 재조인 — socket.io 자동 재연결 후 룸 재구독
    const offConnect = socket.onConnect(() => {
      void join();
    });
    const offChatNew = socket.onChatNew((msg) => {
      if (msg.liveSessionId !== liveSessionId) return;
      setMessages((prev) => appendChat(prev, msg));
    });
    const offModerated = socket.onChatModerated((p) => {
      if (p.liveSessionId !== liveSessionId) return;
      if (p.visibility === 'hidden') setMessages((prev) => removeChat(prev, p.chatMessageId));
    });
    const offViewer = socket.onViewerCount((p) => {
      if (p.liveSessionId === liveSessionId) setViewerCount(p.total);
    });
    const offStatus = socket.onLiveStatus((p) => {
      if (p.liveSessionId !== liveSessionId) return;
      setSession((prev) => (prev ? { ...prev, status: p.to } : prev));
      // 방송 시작(→live) 시 hlsUrl은 status_changed 페이로드에 없다. 조인 ack(REST 아님)이 유일 공급원이라
      // 재조인해 최신 세션(hlsUrl 포함)을 받아야 재생 URL이 반영된다(그 전 조인 ack의 null 잔존 방지).
      if (p.to === 'live') void join();
    });

    // autoConnect라 목/실 소켓 모두 'connect' 방출 전일 수 있어 즉시 1회 join도 시도(멱등)
    void join();

    return () => {
      active = false;
      offConnect();
      offChatNew();
      offModerated();
      offViewer();
      offStatus();
      void socket.leaveLive(liveSessionId).catch(() => {});
      socket.close();
      socketRef.current = null;
    };
  }, [liveSessionId, nickname, socketFactory]);

  const send = useCallback(
    async (message: string): Promise<void> => {
      const socket = socketRef.current;
      if (!socket) return;
      setSending(true);
      setSendError(null);
      try {
        await socket.sendChat(liveSessionId, message);
      } catch (err) {
        setSendError(userMessageForError(err));
      } finally {
        setSending(false);
      }
    },
    [liveSessionId],
  );

  return { messages, session, viewerCount, connected, send, sendError, sending };
}
