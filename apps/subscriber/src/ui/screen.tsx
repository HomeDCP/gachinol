import { StyleSheet, View } from 'react-native';
import type { PropsWithChildren } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@gachinol/ui';

/** 화면 공통 래퍼 — SafeArea + 배경. 스크롤은 각 화면이 담당 */
export function Screen({ children }: PropsWithChildren): React.JSX.Element {
  return (
    <SafeAreaView style={styles.safe} edges={['bottom', 'left', 'right']}>
      <View style={styles.inner}>{children}</View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  inner: { flex: 1 },
});
