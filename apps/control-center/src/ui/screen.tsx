import { StyleSheet, View } from 'react-native';
import type { PropsWithChildren } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from './theme';

/** 화면 공통 래퍼 — SafeArea + 배경. 스크롤은 각 화면이 담당 */
export function Screen({ children }: PropsWithChildren): React.JSX.Element {
  return (
    <SafeAreaView style={styles.safe} edges={['bottom', 'left', 'right']}>
      <View style={styles.inner}>{children}</View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg, alignItems: 'center' },
  // 콘텐츠 폭 상한 — 관제는 데스크톱 콘솔을 겸하므로(마스터플랜 §4) 구독자보다 훨씬 넓게 쓰되,
  // 초광폭 모니터에서 카드가 무한정 늘어나 한 줄이 시선을 벗어나는 것은 막는다.
  // 1440은 W2 DoD의 데스크톱 확인 폭이다.
  inner: { flex: 1, width: '100%', maxWidth: 1440 },
});
