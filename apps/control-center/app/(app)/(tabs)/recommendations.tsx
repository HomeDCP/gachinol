import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Screen } from '../../../src/ui/screen';
import { colors, radii, spacing, typo } from '../../../src/ui/theme';

/**
 * 유보 플레이스홀더 — WeeklyRecommendation/RecommendationReview 컨트롤러 부재.
 * 목 데이터·가짜 리스트 금지, 단일 안내 카드만.
 */
export default function RecommendationsScreen(): React.JSX.Element {
  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.card}>
          <Text style={styles.icon}>✨</Text>
          <Text style={styles.title}>주간 콘텐츠 추천 검토·재생성</Text>
          <Text style={styles.body}>
            다음 단계: 백엔드 필요 — ai-worker 주간 추천 산출 + 추천 조회/전이 API 도입 후
            활성화됩니다.
          </Text>
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, justifyContent: 'center', padding: spacing.xl },
  card: {
    backgroundColor: colors.card,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xl,
    gap: spacing.md,
    alignItems: 'center',
  },
  icon: { fontSize: 40 },
  title: { fontSize: typo.title, fontWeight: '700', color: colors.text, textAlign: 'center' },
  body: { fontSize: typo.body, color: colors.textMuted, textAlign: 'center', lineHeight: 22 },
});
