import { StyleSheet, Text } from 'react-native';
import { Tabs } from 'expo-router';
import { colors } from '../../src/ui/theme';

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
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: '피드', tabBarLabel: '피드', tabBarIcon: tabIcon('📺') }}
      />
      <Tabs.Screen
        name="stations"
        options={{ title: '지사', tabBarLabel: '지사', tabBarIcon: tabIcon('🏢') }}
      />
      <Tabs.Screen
        name="live"
        options={{ title: '라이브', tabBarLabel: '라이브', tabBarIcon: tabIcon('🔴') }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  icon: { fontSize: 18 },
});
