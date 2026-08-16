import { useEffect, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { toId } from '@gachinol/shared';
import type { ChatMessage, LiveSessionId } from '@gachinol/shared';
import { colors, radii, spacing, typo } from '@gachinol/ui';
import { isApiClientError, userMessageForError } from '../../src/api/errors';
import { getLiveFallbackYoutubeUrl, getSupportTelHref } from '../../src/config/env';
import { HlsVideo } from '../../src/live/hls-video';
import {
  formatChatTime,
  formatViewerCount,
  isOnAir,
  LIVE_STATUS_LABEL,
} from '../../src/live/format';
import { useLiveSession } from '../../src/live/queries';
import { useLiveChat } from '../../src/live/use-live-chat';
import { isValidNickname, NICKNAME_MAX_LEN, sanitizeNickname } from '../../src/live/nickname';
import { ErrorView } from '../../src/ui/error-view';
import { LoadingView } from '../../src/ui/loading-view';
import {
  PlaybackFallback,
  resolveLiveFallbackButtons,
  resolvePlaybackFallbackMessage,
} from '../../src/ui/playback-fallback';
import { Screen } from '../../src/ui/screen';

/**
 * 재생 영역 — hlsUrl 없으면 정직하게 "준비중"(목 스트림 금지, 기존 원칙 유지). hlsUrl이 생기면
 * hls.js 어댑터(`HlsVideo` — 웹은 hls.js, 네이티브는 expo-video, 플랫폼별 파일 분기)로 재생하고,
 * 치명적 재생 실패 시 라이브 폴백 UI(03 §A-6)로 전환한다. **보강 1**: "다시 시도"를 env 설정과
 * 무관하게 항상 포함해(`resolveLiveFallbackButtons`) 기본 배포(유튜브·전화 미설정)에서도 최소
 * 1개는 항상 눌린다 — 舊 버전은 두 버튼이 전부 `disabled`인 죽은 화면이었다.
 */
function LivePlayer({ hlsUrl }: { hlsUrl: string | null }): React.JSX.Element {
  const [failed, setFailed] = useState(false);
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    setFailed(false);
  }, [hlsUrl]);

  if (!hlsUrl) {
    return (
      <View style={[styles.playerWrap, styles.playerPlaceholder]}>
        <Text style={styles.placeholderText}>라이브 영상은 방송 시작 후 재생됩니다</Text>
      </View>
    );
  }

  if (failed) {
    // ⚠️ 라이브만 아직 env 폴백이다(T-W2-28 기준). `LiveSessionPublic`에는 stationId·stationName이
    // 둘 다 없어 어느 지사의 연락 채널인지 특정할 수 없다 — 지사별 값은 이미 계약에 있으므로
    // (`StationSummary.supportTel`·`youtubeUrl`) 라이브 공개 투영에 지사 참조가 생기는 즉시
    // 시청 화면(app/watch/[id].tsx)과 동일하게 `resolveStationContact`로 갈아끼우면 된다.
    // 그 전까지 env는 "지사를 특정할 수 없는 화면의 최후 수단"이라는 원래 역할 그대로다.
    const youtubeUrl = getLiveFallbackYoutubeUrl();
    const supportTelHref = getSupportTelHref();
    const buttons = resolveLiveFallbackButtons({ youtubeUrl, supportTelHref });
    const actions = buttons.map((button) => {
      if (button.key === 'retry') {
        return {
          label: button.label,
          onPress: () => {
            setFailed(false);
            setRetryToken((n) => n + 1);
          },
        };
      }
      if (button.key === 'youtube') {
        return { label: button.label, onPress: () => void Linking.openURL(youtubeUrl as string) };
      }
      return { label: button.label, onPress: () => void Linking.openURL(supportTelHref as string) };
    });
    return (
      <PlaybackFallback
        message={resolvePlaybackFallbackMessage(actions.length)}
        actions={actions}
      />
    );
  }

  return <HlsVideo key={retryToken} sourceUrl={hlsUrl} onFatalError={() => setFailed(true)} />;
}

/** 채팅 한 줄 */
function ChatRow({ item }: { item: ChatMessage }): React.JSX.Element {
  return (
    <View style={styles.chatRow}>
      <View style={styles.chatMetaRow}>
        <Text style={styles.chatName} numberOfLines={1}>
          {item.userName}
        </Text>
        <Text style={styles.chatTime}>{formatChatTime(item.sentAt)}</Text>
      </View>
      <Text style={styles.chatText}>{item.message}</Text>
    </View>
  );
}

/** 닉네임 입력 게이트 — 익명이라 로그인 대신 표시명만 1회 받는다 */
function NicknameGate({ onSubmit }: { onSubmit: (name: string) => void }): React.JSX.Element {
  const [value, setValue] = useState('');
  const valid = isValidNickname(value);
  return (
    <View style={styles.gate}>
      <Text style={styles.gateTitle}>채팅에 사용할 이름을 입력하세요</Text>
      <TextInput
        style={styles.gateInput}
        value={value}
        onChangeText={setValue}
        placeholder="예: 해녀삼춘"
        placeholderTextColor={colors.textMuted}
        maxLength={NICKNAME_MAX_LEN}
        returnKeyType="done"
        onSubmitEditing={() => valid && onSubmit(sanitizeNickname(value))}
      />
      <Pressable
        style={[styles.gateButton, !valid && styles.gateButtonDisabled]}
        disabled={!valid}
        onPress={() => onSubmit(sanitizeNickname(value))}
      >
        <Text style={styles.gateButtonText}>채팅 참여</Text>
      </Pressable>
    </View>
  );
}

/** 채팅 룸 — 닉네임 확정 후에만 마운트(소켓 연결). status==='live'에서만 전송 활성 */
function LiveChatRoom({
  liveSessionId,
  nickname,
  title,
}: {
  liveSessionId: LiveSessionId;
  nickname: string;
  title: string;
}): React.JSX.Element {
  const { messages, session, viewerCount, connected, send, sendError, sending } = useLiveChat({
    liveSessionId,
    nickname,
  });
  const [draft, setDraft] = useState('');

  const status = session?.status ?? 'preparing';
  const onAir = isOnAir(status);
  const canSend = onAir && draft.trim().length > 0 && !sending;

  const submit = (): void => {
    const message = draft.trim();
    if (!onAir || message.length === 0) return;
    setDraft('');
    void send(message);
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <LivePlayer hlsUrl={session?.hlsUrl ?? null} />
      <View style={styles.header}>
        <Text style={styles.title} numberOfLines={2}>
          {title}
        </Text>
        <View style={styles.headerMeta}>
          <View style={[styles.statusPill, onAir ? styles.statusLive : styles.statusIdle]}>
            {onAir ? <View style={styles.liveDot} /> : null}
            <Text style={[styles.statusText, onAir ? styles.statusTextLive : styles.statusTextIdle]}>
              {LIVE_STATUS_LABEL[status]}
            </Text>
          </View>
          {onAir ? <Text style={styles.viewers}>{formatViewerCount(viewerCount)}</Text> : null}
        </View>
      </View>

      <FlatList
        data={messages}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <ChatRow item={item} />}
        contentContainerStyle={styles.chatList}
        ListEmptyComponent={
          <Text style={styles.chatEmpty}>
            {connected ? '첫 채팅을 남겨보세요' : '채팅에 연결하는 중…'}
          </Text>
        }
      />

      {sendError ? <Text style={styles.sendError}>{sendError}</Text> : null}

      <View style={styles.inputBar}>
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          placeholder={onAir ? '메시지 입력' : '방송 중일 때 채팅할 수 있습니다'}
          placeholderTextColor={colors.textMuted}
          editable={onAir}
          maxLength={500}
          returnKeyType="send"
          onSubmitEditing={submit}
        />
        <Pressable
          style={[styles.sendButton, !canSend && styles.sendButtonDisabled]}
          disabled={!canSend}
          onPress={submit}
        >
          <Text style={styles.sendButtonText}>전송</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

/** 라이브 상세 — 초기 세션(REST) 로드 → 닉네임 게이트 → 채팅 룸(WS) */
export default function LiveDetailScreen(): React.JSX.Element {
  const { id } = useLocalSearchParams<{ id: string }>();
  const liveSessionId = toId<LiveSessionId>(id ?? '');
  const initial = useLiveSession(liveSessionId);
  const [nickname, setNickname] = useState('');

  if (initial.isPending) {
    return (
      <Screen>
        <LoadingView />
      </Screen>
    );
  }
  if (initial.isError) {
    const err = initial.error;
    const notFound = isApiClientError(err) && err.status === 404;
    return (
      <Screen>
        <ErrorView
          message={notFound ? '종료되었거나 없는 라이브입니다' : userMessageForError(err)}
          retryLabel={notFound ? '목록으로' : '다시 시도'}
          onRetry={() => (notFound ? router.replace('/live') : void initial.refetch())}
        />
      </Screen>
    );
  }

  return (
    <Screen>
      {nickname.length === 0 ? (
        <View style={styles.flex}>
          <LivePlayer hlsUrl={initial.data.hlsUrl} />
          <View style={styles.header}>
            <Text style={styles.title} numberOfLines={2}>
              {initial.data.title}
            </Text>
          </View>
          <NicknameGate onSubmit={setNickname} />
        </View>
      ) : (
        <LiveChatRoom
          liveSessionId={liveSessionId}
          nickname={nickname}
          title={initial.data.title}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  playerWrap: { width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000000' },
  playerPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  placeholderText: { color: '#FFFFFF', fontSize: typo.caption },
  header: { padding: spacing.lg, gap: spacing.sm, borderBottomWidth: 1, borderColor: colors.border },
  headerMeta: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  title: { fontSize: typo.title, fontWeight: '700', color: colors.text },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  statusLive: { backgroundColor: '#FBE3E3' },
  statusIdle: { backgroundColor: '#EFEFF1' },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.danger },
  statusText: { fontSize: typo.caption, fontWeight: '700' },
  statusTextLive: { color: colors.danger },
  statusTextIdle: { color: colors.textMuted },
  viewers: { fontSize: typo.caption, color: colors.textMuted },
  chatList: { padding: spacing.lg, gap: spacing.md, flexGrow: 1 },
  chatEmpty: { fontSize: typo.caption, color: colors.textMuted, textAlign: 'center', marginTop: spacing.xl },
  chatRow: { gap: spacing.xs },
  chatMetaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  chatName: { fontSize: typo.caption, fontWeight: '700', color: colors.text, flexShrink: 1 },
  chatTime: { fontSize: typo.caption, color: colors.textMuted },
  chatText: { fontSize: typo.body, color: colors.text },
  sendError: {
    fontSize: typo.caption,
    color: colors.danger,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xs,
  },
  inputBar: {
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
    borderTopWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: typo.body,
    color: colors.text,
    backgroundColor: colors.bg,
  },
  sendButton: {
    justifyContent: 'center',
    borderRadius: radii.md,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.primary,
  },
  sendButtonDisabled: { opacity: 0.5 },
  sendButtonText: { color: '#FFFFFF', fontWeight: '600', fontSize: typo.body },
  gate: { padding: spacing.lg, gap: spacing.md },
  gateTitle: { fontSize: typo.body, color: colors.text, fontWeight: '600' },
  gateInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: typo.body,
    color: colors.text,
    backgroundColor: colors.card,
  },
  gateButton: {
    alignItems: 'center',
    borderRadius: radii.md,
    paddingVertical: spacing.md,
    backgroundColor: colors.primary,
  },
  gateButtonDisabled: { opacity: 0.5 },
  gateButtonText: { color: '#FFFFFF', fontWeight: '600', fontSize: typo.body },
});
