import { Alert, Platform, ToastAndroid } from 'react-native';

/** 최소 토스트 — Android는 네이티브 토스트, iOS는 Alert 폴백 (packages/ui 승격 시 교체) */
export function showToast(message: string): void {
  if (Platform.OS === 'android') {
    ToastAndroid.show(message, ToastAndroid.SHORT);
    return;
  }
  Alert.alert(message);
}
