import { useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { ProgramCategory } from '@gachinol/shared';
import type { ChannelAccountId, LiveSession } from '@gachinol/shared';
import { userMessageForError } from '../../../src/api/errors';
import { CATEGORY_LABEL } from '../../../src/features/contents/labels';
import {
  LIVE_STATUS_LABEL,
  LIVE_STATUS_TONE,
} from '../../../src/features/live/labels';
import {
  validateCreateLiveSession,
  type CreateLiveSessionErrors,
} from '../../../src/features/live/validation';
import { useCreateLiveSession, useLiveSessions } from '../../../src/live/queries';
import { Badge } from '../../../src/ui/badge';
import { Button } from '../../../src/ui/button';
import { EmptyState } from '../../../src/ui/empty-state';
import { ErrorView } from '../../../src/ui/error-view';
import { FormField } from '../../../src/ui/form-field';
import { Screen } from '../../../src/ui/screen';
import { showToast } from '../../../src/ui/toast';
import { colors, radii, spacing, typo } from '../../../src/ui/theme';

const CATEGORY_OPTIONS: readonly ProgramCategory[] = [
  'news',
  'politics_talk',
  'culture',
  'local_weather',
  'live_commerce',
  'emergency',
];

/** 다음 주말(토) 오후 8시 ISO — 편성 시각 자동 프리필(정규 편성) */
function nextWeekendSlot(from: Date = new Date()): string {
  const d = new Date(from);
  const day = d.getDay();
  const daysUntilSat = (6 - day + 7) % 7 || 7;
  d.setDate(d.getDate() + daysUntilSat);
  d.setHours(20, 0, 0, 0);
  return d.toISOString();
}

function CreateSessionForm(): React.JSX.Element {
  const [type, setType] = useState<ProgramCategory>('news');
  const [title, setTitle] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [errors, setErrors] = useState<CreateLiveSessionErrors>({});
  const create = useCreateLiveSession();

  const isEmergency = type === ProgramCategory.Emergency;

  const submit = (): void => {
    const result = validateCreateLiveSession({
      type,
      title,
      scheduledAt: isEmergency ? null : scheduledAt.trim() || null,
      targetChannelAccountIds: [] as ChannelAccountId[],
    });
    if (!result.ok || !result.request) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    create.mutate(result.request, {
      onSuccess: (session) => {
        setTitle('');
        setScheduledAt('');
        showToast('라이브 세션을 생성했습니다');
        router.push(`/live/${session.id}`);
      },
      onError: (err) => setErrors({ title: userMessageForError(err) }),
    });
  };

  return (
    <View style={styles.formCard}>
      <Text style={styles.formTitle}>라이브 세션 생성</Text>

      <FormField label="유형">
        <View style={styles.chipRow}>
          {CATEGORY_OPTIONS.map((c) => {
            const selected = c === type;
            return (
              <Pressable
                key={c}
                style={[styles.chip, selected && styles.chipSelected]}
                onPress={() => setType(c)}
              >
                <Text style={[styles.chipLabel, selected && styles.chipLabelSelected]}>
                  {CATEGORY_LABEL[c]}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </FormField>

      <FormField label="제목" error={errors.title}>
        <TextInput
          style={styles.input}
          value={title}
          onChangeText={setTitle}
          placeholder="예: 주간뉴스 라이브 7월 4주"
          placeholderTextColor={colors.textMuted}
          maxLength={200}
        />
      </FormField>

      {isEmergency ? (
        <Text style={styles.emergencyHint}>긴급 라이브는 편성 시각 없이 즉시 준비 상태로 생성됩니다.</Text>
      ) : (
        <FormField label="편성 시각 (ISO)" error={errors.scheduledAt} hint="주말 편성">
          <TextInput
            style={styles.input}
            value={scheduledAt}
            onChangeText={setScheduledAt}
            placeholder="2026-07-25T20:00:00.000Z"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
          />
          <Pressable onPress={() => setScheduledAt(nextWeekendSlot())} hitSlop={6}>
            <Text style={styles.prefill}>다음 주말 오후 8시로 채우기</Text>
          </Pressable>
        </FormField>
      )}

      <Button
        label="생성"
        onPress={submit}
        loading={create.isPending}
      />
    </View>
  );
}

function SessionCard({ item }: { item: LiveSession }): React.JSX.Element {
  return (
    <Pressable style={styles.card} onPress={() => router.push(`/live/${item.id}`)}>
      <View style={styles.cardHeader}>
        <Badge label={LIVE_STATUS_LABEL[item.status]} tone={LIVE_STATUS_TONE[item.status]} />
        <Text style={styles.cardCategory}>{CATEGORY_LABEL[item.type]}</Text>
      </View>
      <Text style={styles.cardTitle} numberOfLines={2}>
        {item.title}
      </Text>
      {item.scheduledAt ? (
        <Text style={styles.cardMeta}>편성: {new Date(item.scheduledAt).toLocaleString('ko-KR')}</Text>
      ) : null}
    </Pressable>
  );
}

/** 라이브 관제 탭 — 세션 생성 폼 + 세션 목록(전 상태). 탭 → 관제 상세 */
export default function LiveScreen(): React.JSX.Element {
  const sessions = useLiveSessions({});
  const items = useMemo(() => sessions.data?.items ?? [], [sessions.data]);

  return (
    <Screen>
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <SessionCard item={item} />}
        ListHeaderComponent={<CreateSessionForm />}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={sessions.isRefetching}
            onRefresh={() => void sessions.refetch()}
          />
        }
        ListEmptyComponent={
          sessions.isError ? (
            <ErrorView
              message={userMessageForError(sessions.error)}
              onRetry={() => void sessions.refetch()}
            />
          ) : sessions.isPending ? null : (
            <EmptyState message="아직 라이브 세션이 없습니다" />
          )
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  listContent: { padding: spacing.lg, paddingBottom: spacing.xl, gap: spacing.md, flexGrow: 1 },
  formCard: {
    backgroundColor: colors.card,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  formTitle: { fontSize: typo.body, fontWeight: '700', color: colors.text, marginBottom: spacing.md },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    backgroundColor: colors.bg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipLabel: { fontSize: typo.caption, color: colors.text },
  chipLabelSelected: { color: '#FFFFFF', fontWeight: '600' },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    backgroundColor: colors.card,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: typo.body,
    color: colors.text,
  },
  prefill: { fontSize: typo.caption, color: colors.primary, marginTop: spacing.sm },
  emergencyHint: { fontSize: typo.caption, color: colors.warning, marginBottom: spacing.lg },
  card: {
    backgroundColor: colors.card,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardCategory: { fontSize: typo.caption, color: colors.textMuted },
  cardTitle: { fontSize: typo.body, fontWeight: '700', color: colors.text },
  cardMeta: { fontSize: typo.caption, color: colors.textMuted },
});
