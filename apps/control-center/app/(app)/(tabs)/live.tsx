import { useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import {
  MAX_PRODUCT_CARDS_PER_SESSION,
  PRODUCT_CARD_NAME_MAX,
  PRODUCT_CARD_PRICE_LABEL_MAX,
  ProgramCategory,
} from '@gachinol/shared';
import type { ChannelAccountId, LiveSession } from '@gachinol/shared';
import { userMessageForError } from '../../../src/api/errors';
import { CATEGORY_LABEL } from '../../../src/features/contents/labels';
import {
  LIVE_STATUS_LABEL,
  LIVE_STATUS_TONE,
} from '../../../src/features/live/labels';
import {
  emptyProductCardDraft,
  validateCreateLiveSession,
  type CreateLiveSessionErrors,
  type ProductCardDraft,
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

/**
 * 라이브커머스 상품 카드 입력 — 1단계(링크아웃) 전용.
 *
 * ★ 판매·결제·재고 입력이 없는 것이 의도다(05 §A-1: 가치놀은 거래 비당사자).
 *   가격은 **표시용 문자열**이라 숫자 키패드를 쓰지 않는다 — "3kg 35,000원~" 같은 판매자 표기를 그대로 옮긴다.
 */
function ProductCardsField({
  cards,
  errors,
  onChange,
}: {
  cards: readonly ProductCardDraft[];
  errors?: Record<number, string>;
  onChange: (next: ProductCardDraft[]) => void;
}): React.JSX.Element {
  const update = (i: number, patch: Partial<ProductCardDraft>): void =>
    onChange(cards.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));

  return (
    <FormField
      label="소개 상품 (선택)"
      hint="판매자의 기존 판매처로 연결됩니다. 결제는 그쪽에서 진행됩니다"
    >
      {cards.map((card, i) => (
        <View key={i} style={styles.productRow}>
          <View style={styles.productRowHead}>
            <Text style={styles.productRowLabel}>상품 {i + 1}</Text>
            <Pressable onPress={() => onChange(cards.filter((_, idx) => idx !== i))} hitSlop={8}>
              <Text style={styles.productRemove}>삭제</Text>
            </Pressable>
          </View>
          <TextInput
            style={styles.input}
            value={card.name}
            onChangeText={(v) => update(i, { name: v })}
            placeholder="상품명 (예: 한라봉 5kg)"
            placeholderTextColor={colors.textMuted}
            maxLength={PRODUCT_CARD_NAME_MAX}
          />
          <TextInput
            style={styles.input}
            value={card.url}
            onChangeText={(v) => update(i, { url: v })}
            placeholder="판매 링크 (https://smartstore.naver.com/...)"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            keyboardType="url"
          />
          <TextInput
            style={styles.input}
            value={card.priceLabel}
            onChangeText={(v) => update(i, { priceLabel: v })}
            placeholder="가격 표기 (선택 — 예: 25,000원)"
            placeholderTextColor={colors.textMuted}
            maxLength={PRODUCT_CARD_PRICE_LABEL_MAX}
          />
          <TextInput
            style={styles.input}
            value={card.imageUrl}
            onChangeText={(v) => update(i, { imageUrl: v })}
            placeholder="사진 주소 (선택 — https://...)"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            keyboardType="url"
          />
          {errors?.[i] ? <Text style={styles.productError}>{errors[i]}</Text> : null}
        </View>
      ))}
      {cards.length < MAX_PRODUCT_CARDS_PER_SESSION ? (
        <Pressable onPress={() => onChange([...cards, emptyProductCardDraft()])} hitSlop={6}>
          <Text style={styles.prefill}>+ 상품 추가</Text>
        </Pressable>
      ) : (
        <Text style={styles.productError}>
          상품은 최대 {MAX_PRODUCT_CARDS_PER_SESSION}개까지 등록할 수 있습니다
        </Text>
      )}
    </FormField>
  );
}

function CreateSessionForm(): React.JSX.Element {
  const [type, setType] = useState<ProgramCategory>('news');
  const [title, setTitle] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [productCards, setProductCards] = useState<ProductCardDraft[]>([]);
  const [errors, setErrors] = useState<CreateLiveSessionErrors>({});
  const create = useCreateLiveSession();

  const isEmergency = type === ProgramCategory.Emergency;
  const isCommerce = type === ProgramCategory.LiveCommerce;

  const submit = (): void => {
    const result = validateCreateLiveSession({
      type,
      title,
      scheduledAt: isEmergency ? null : scheduledAt.trim() || null,
      targetChannelAccountIds: [] as ChannelAccountId[],
      // 커머스가 아니면 입력이 노출되지 않으므로 값도 보내지 않는다(유형 전환 시 잔재 방지)
      productCards: isCommerce ? productCards : [],
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
        setProductCards([]);
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

      {isCommerce ? (
        <ProductCardsField
          cards={productCards}
          errors={errors.productCards}
          onChange={setProductCards}
        />
      ) : null}

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
  productRow: {
    gap: spacing.sm,
    padding: spacing.sm,
    marginBottom: spacing.sm,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  productRowHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  productRowLabel: { fontSize: typo.caption, color: colors.textMuted },
  productRemove: { fontSize: typo.caption, color: colors.danger },
  productError: { fontSize: typo.caption, color: colors.danger },
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
