import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Screen } from '../../../src/ui/screen';
import { colors, radii, spacing, typo } from '../../../src/ui/theme';

/**
 * 유보 플레이스홀더 — Live 세션·댓글 프롬프터 컨트롤러 부재(RTMP/HLS·WS 미도입).
 * 목 스트림·가짜 댓글 금지, 단일 안내 카드만.
 */
export default function LiveScreen(): React.JSX.Element {
  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.card}>
          <Text style={styles.icon}>🔴</Text>
          <Text style={styles.title}>라이브 관제 · 채널별 댓글 프롬프터</Text>
          <Text style={styles.body}>
            다음 단계: 백엔드 필요 — 라이브 인프라 + 댓글 집계 WebSocket 도입 후 활성화됩니다.
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
