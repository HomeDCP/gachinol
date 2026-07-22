import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Screen } from '../../src/ui/screen';
import { colors, radii, spacing, typo } from '../../src/ui/theme';

/**
 * 유보 플레이스홀더 — 라이브·실시간 채팅은 다음 단계(RTMP/HLS 라이브 인프라 + WebSocket 미도입).
 * 목 스트림·가짜 댓글 금지, 네트워크 호출 0. 단일 안내 카드만.
 */
export default function LiveScreen(): React.JSX.Element {
  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.card}>
          <Text style={styles.icon}>🔴</Text>
          <Text style={styles.title}>주말 라이브 · 실시간 채팅</Text>
          <Text style={styles.body}>
            제주방송센터 주말 라이브와 실시간 채팅은 다음 단계입니다. 라이브 백엔드(RTMP/HLS)와 댓글
            집계 WebSocket을 구축한 뒤 이 화면에서 제공됩니다.
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
