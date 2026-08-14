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
  safe: { flex: 1, backgroundColor: colors.bg, alignItems: 'center' },
  // 콘텐츠 폭 상한 — 구독자 웹은 세로 피드가 주 형태라 폭이 넓어질수록 카드 썸네일만 거대해지고
  // 제목·본문은 한 줄에 흩어져 읽기 나빠진다(실배포 데스크톱 확인). 배경은 전체를 채우고
  // 콘텐츠만 가운데로 모은다. 720은 720p 렌디션 원폭이기도 해 상세 재생 화면의 업스케일도 막는다.
  inner: { flex: 1, width: '100%', maxWidth: 720 },
});
