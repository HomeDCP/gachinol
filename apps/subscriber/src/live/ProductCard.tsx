import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import type { ProductCard as ProductCardModel } from '@gachinol/shared';
import { colors, radii, spacing, touchTarget, typo } from '@gachinol/ui';

/* ══════════════════════════════════════════════════════════════════════════
 * 라이브커머스 1단계(링크아웃) 상품 카드 — 02 §E-19.
 *
 * 구현 범위는 **표시 + 외부 이동**뿐이다. 장바구니·수량·재고·결제 UI를 두지 않는다
 * (05 §A-1: 판매·결제·환불은 외부 플랫폼 몫이며 가치놀은 거래 당사자가 아니다).
 *
 * ★ 가로 스크롤을 쓰지 않는다 — 대장 #93: RNW `ScrollView`의 기본 `flexGrow/flexShrink:1`이
 *   구독자 앱에서 칩을 잘라먹은 전례가 있고, 라이브 화면은 이미 세로 스크롤 안이라 중첩이 된다.
 *   세션당 카드가 소수(상한 20)라 세로 나열로 충분하다.
 * ★ 터치 타깃 — 카드 전체가 누를 수 있는 영역이며 `touchTarget.min`(44) 이상을 보장한다(03 §A-1).
 * ══════════════════════════════════════════════════════════════════════════ */

export interface ProductCardProps {
  card: ProductCardModel;
  onPress: (card: ProductCardModel) => void;
}

export function ProductCard({ card, onPress }: ProductCardProps): React.JSX.Element {
  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      onPress={() => onPress(card)}
      accessibilityRole="link"
      accessibilityLabel={`${card.name}${card.priceLabel ? `, ${card.priceLabel}` : ''} — 판매처에서 보기`}
      accessibilityHint="외부 판매 사이트가 열립니다"
    >
      {card.imageUrl ? (
        <Image source={{ uri: card.imageUrl }} style={styles.thumb} resizeMode="cover" />
      ) : (
        <View style={[styles.thumb, styles.thumbEmpty]}>
          <Text style={styles.thumbEmptyText}>사진 없음</Text>
        </View>
      )}
      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={2}>
          {card.name}
        </Text>
        {card.priceLabel ? <Text style={styles.price}>{card.priceLabel}</Text> : null}
        <Text style={styles.cta}>판매처에서 보기 →</Text>
      </View>
    </Pressable>
  );
}

export interface ProductCardListProps {
  cards: readonly ProductCardModel[];
  onPressCard: (card: ProductCardModel) => void;
}

/** 카드가 0건이면 아무 것도 렌더하지 않는다 — 빈 껍데기 섹션은 화면만 차지한다 */
export function ProductCardList({
  cards,
  onPressCard,
}: ProductCardListProps): React.JSX.Element | null {
  if (cards.length === 0) return null;

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>방송 중 소개 상품</Text>
      <Text style={styles.sectionNote}>구매·결제는 판매자의 판매처에서 진행됩니다</Text>
      {cards.map((card) => (
        <ProductCard key={card.id} card={card} onPress={onPressCard} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  sectionTitle: {
    fontSize: typo.title,
    fontWeight: '700',
    color: colors.text,
  },
  sectionNote: {
    fontSize: typo.caption,
    color: colors.textMuted,
    marginBottom: spacing.xs,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm,
    minHeight: touchTarget.min,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  cardPressed: {
    opacity: 0.7,
  },
  thumb: {
    width: 72,
    height: 72,
    borderRadius: radii.sm,
    backgroundColor: colors.bg,
  },
  thumbEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbEmptyText: {
    fontSize: typo.caption,
    color: colors.textMuted,
  },
  body: {
    flex: 1,
    gap: 2,
  },
  name: {
    fontSize: typo.body,
    fontWeight: '600',
    color: colors.text,
  },
  price: {
    fontSize: typo.body,
    color: colors.text,
  },
  cta: {
    fontSize: typo.caption,
    color: colors.primary,
    marginTop: spacing.xs,
  },
});
