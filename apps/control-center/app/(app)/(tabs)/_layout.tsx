import { Pressable, StyleSheet, Text } from 'react-native';
import { Tabs } from 'expo-router';
import { useSession } from '../../../src/auth/auth-context';
import { colors, spacing, typo } from '../../../src/ui/theme';

function LogoutButton(): React.JSX.Element {
  const { signOut } = useSession();
  return (
    <Pressable onPress={() => void signOut()} hitSlop={8}>
      <Text style={styles.logout}>로그아웃</Text>
    </Pressable>
  );
}

/** 탭 아이콘 — 신규 의존성 없이 이모지 라벨로 표기 */
function tabIcon(emoji: string) {
  return ({ color }: { color: string }): React.JSX.Element => (
    <Text style={[styles.icon, { color }]}>{emoji}</Text>
  );
}

export default function TabsLayout(): React.JSX.Element {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        headerRight: () => <LogoutButton />,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: '검토 보드', tabBarLabel: '검토', tabBarIcon: tabIcon('📋') }}
      />
      <Tabs.Screen
        name="stations"
        options={{ title: '지사', tabBarLabel: '지사', tabBarIcon: tabIcon('🏢') }}
      />
      <Tabs.Screen
        name="recommendations"
        options={{ title: '주간 추천', tabBarLabel: '추천', tabBarIcon: tabIcon('✨') }}
      />
      <Tabs.Screen
        name="live"
        options={{ title: '라이브 관제', tabBarLabel: '라이브', tabBarIcon: tabIcon('🔴') }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  logout: {
    color: colors.primary,
    fontSize: typo.caption,
    fontWeight: '600',
    paddingHorizontal: spacing.lg,
  },
  icon: { fontSize: 18 },
});
