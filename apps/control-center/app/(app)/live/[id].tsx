import { useEffect } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { toId } from '@gachinol/shared';
import type { LiveComment, LiveSessionId } from '@gachinol/shared';
import { userMessageForError } from '../../../src/api/errors';
import { CATEGORY_LABEL } from '../../../src/features/contents/labels';
import {
  availableLifecycleActions,
  LIFECYCLE_ACTION_META,
  LIVE_STATUS_LABEL,
  LIVE_STATUS_TONE,
  PLATFORM_LABEL,
} from '../../../src/features/live/labels';
import { useLiveLifecycle, useLiveSession } from '../../../src/live/queries';
import { useLivePrompter } from '../../../src/live/use-live-prompter';
import { Badge } from '../../../src/ui/badge';
import { Button } from '../../../src/ui/button';
import { ErrorView } from '../../../src/ui/error-view';
import { LoadingView } from '../../../src/ui/loading-view';
import { Screen } from '../../../src/ui/screen';
import { colors, radii, spacing, typo } from '../../../src/ui/theme';

/** 프롬프터 댓글 한 줄 — 플랫폼 뱃지 + 질문 강조(좌측 바) */
function PrompterRow({ item }: { item: LiveComment }): React.JSX.Element {
  return (
    <View style={[styles.commentRow, item.isQuestion && styles.commentQuestion]}>
      <View style={styles.commentMeta}>
        <Text style={styles.platform}>{PLATFORM_LABEL[item.platform]}</Text>
        <Text style={styles.author} numberOfLines={1}>
          {item.authorName}
        </Text>
        {item.isQuestion ? <Text style={styles.questionTag}>질문</Text> : null}
      </View>
      <Text style={styles.commentText}>{item.message}</Text>
    </View>
  );
}

/** 라이브 관제 상세 — 세션 제어(라이프사이클) + 아나운서 프롬프터(채널별 댓글 실시간 스트림) */
export default function LiveControlScreen(): React.JSX.Element {
  const { id } = useLocalSearchParams<{ id: string }>();
  const liveSessionId = toId<LiveSessionId>(id ?? '');
  const session = useLiveSession(liveSessionId);
  const lifecycle = useLiveLifecycle(liveSessionId);
  const prompter = useLivePrompter({ liveSessionId });

  // WS status_changed(자동 중단 등) 감지 시 세션 재조회 → 제어 버튼 최신화
  useEffect(() => {
    if (prompter.liveStatus && session.data && prompter.liveStatus !== session.data.status) {
      void session.refetch();
    }
  }, [prompter.liveStatus, session]);

  if (session.isPending) {
    return (
      <Screen>
        <LoadingView />
      </Screen>
    );
  }
  if (session.isError) {
    return (
      <Screen>
        <ErrorView
          message={userMessageForError(session.error)}
          onRetry={() => void session.refetch()}
        />
      </Screen>
    );
  }

  const data = session.data;
  const actions = availableLifecycleActions(data.status);

  return (
    <Screen>
      <FlatList
        data={prompter.comments}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <PrompterRow item={item} />}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <View>
            <View style={styles.headerCard}>
              <View style={styles.headerTop}>
                <Badge label={LIVE_STATUS_LABEL[data.status]} tone={LIVE_STATUS_TONE[data.status]} />
                <Text style={styles.category}>{CATEGORY_LABEL[data.type]}</Text>
              </View>
              <Text style={styles.title}>{data.title}</Text>

              <View style={styles.actionRow}>
                {actions.length === 0 ? (
                  <Text style={styles.terminal}>종결된 세션입니다</Text>
                ) : (
                  actions.map((action) => {
                    const meta = LIFECYCLE_ACTION_META[action];
                    return (
                      <Button
                        key={action}
                        label={meta.label}
                        variant={meta.destructive ? 'destructive' : 'primary'}
                        loading={lifecycle.isPending}
                        onPress={() => lifecycle.mutate(action)}
                        style={styles.actionButton}
                      />
                    );
                  })
                )}
              </View>
            </View>

            <View style={styles.prompterHeader}>
              <Text style={styles.prompterTitle}>프롬프터 · 채널별 댓글</Text>
              <Text style={styles.prompterMeta}>
                {prompter.connected ? '실시간 수신 중' : '연결 중…'} · 질문 {prompter.questions.length}
              </Text>
            </View>
          </View>
        }
        ListEmptyComponent={
          <Text style={styles.empty}>
            {data.status === 'live'
              ? '수집된 댓글이 아직 없습니다'
              : '방송 시작 후 채널 댓글이 수집됩니다'}
          </Text>
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  listContent: { padding: spacing.lg, paddingBottom: spacing.xl, gap: spacing.sm, flexGrow: 1 },
  headerCard: {
    backgroundColor: colors.card,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  headerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  category: { fontSize: typo.caption, color: colors.textMuted },
  title: { fontSize: typo.title, fontWeight: '700', color: colors.text },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  actionButton: { flexGrow: 1, minWidth: 120 },
  terminal: { fontSize: typo.caption, color: colors.textMuted },
  prompterHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  prompterTitle: { fontSize: typo.body, fontWeight: '700', color: colors.text },
  prompterMeta: { fontSize: typo.caption, color: colors.textMuted },
  empty: { fontSize: typo.caption, color: colors.textMuted, textAlign: 'center', marginTop: spacing.xl },
  commentRow: {
    backgroundColor: colors.card,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.xs,
  },
  commentQuestion: { borderLeftWidth: 3, borderLeftColor: colors.warning },
  commentMeta: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  platform: {
    fontSize: typo.caption,
    fontWeight: '700',
    color: colors.info,
  },
  author: { fontSize: typo.caption, color: colors.textMuted, flexShrink: 1 },
  questionTag: {
    fontSize: typo.caption,
    fontWeight: '700',
    color: colors.warning,
  },
  commentText: { fontSize: typo.body, color: colors.text },
});
