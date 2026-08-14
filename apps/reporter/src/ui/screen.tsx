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
  // 콘텐츠 폭 상한 — 배경은 전체를 채우고 콘텐츠만 가운데로 모은다.
  // 960은 구독자(720)와 관제(1440) 사이다: 기자 웹은 현장 모바일이 주 사용처라 관제처럼 넓힐 이유가
  // 없지만, 장면 자막 입력·수정 폼이 있어 구독자 피드보다는 여유가 필요하다.
  inner: { flex: 1, width: '100%', maxWidth: 960 },
});
