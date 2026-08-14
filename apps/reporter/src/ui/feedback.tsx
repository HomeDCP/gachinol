import { useEffect, useState } from 'react';
import { Alert, Modal, Platform, Pressable, StyleSheet, Text, ToastAndroid, View } from 'react-native';
import { colors, radii, spacing, typo } from './theme';

/**
 * 토스트·확인 다이얼로그의 웹 대응.
 *
 * react-native-web의 `Alert`는 **빈 함수**다(`class Alert { static alert() {} }`,
 * react-native-web@0.21 `dist/exports/Alert/index.js` — 실측). 예외도 던지지 않아
 * ① 확인 다이얼로그가 뜨지 않고 버튼 `onPress` 콜백이 영원히 실행되지 않으며
 * ② `Alert.alert(message)` 폴백을 쓰던 토스트가 통째로 사라진다.
 * 실배포에서 기자 승인 버튼이 아무 반응도 피드백도 없던 원인이 이것이다.
 *
 * 여기서는 웹에서만 자체 호스트(`<FeedbackHost/>`)로 렌더하고, 네이티브는 기존 동작
 * (Android=ToastAndroid, iOS=Alert)을 그대로 위임한다 — 네이티브 경로 무회귀.
 *
 * 호출 API는 모듈 함수다(훅 아님). 기존 `showToast` 시그니처를 그대로 유지해 호출부를
 * 건드리지 않고, 확인 다이얼로그도 화면 어디서든(이벤트 핸들러·네비게이션 리스너 안 등)
 * 쓸 수 있게 한다. 렌더는 루트에 한 번 마운트된 호스트가 구독해서 담당한다.
 *
 * 웹에서 `window.confirm`을 쓰지 않는 이유: 브라우저 모달은 렌더 스레드를 막고 스타일을
 * 맞출 수 없으며, 자동화 도구에서도 페이지가 정지한다.
 */

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  /** 되돌리기 어려운 동작(반려·이탈 등) — 확인 버튼을 위험 색으로 */
  destructive?: boolean;
}

const isWeb = Platform.OS === 'web';

type ToastListener = (message: string) => void;
type ConfirmRequest = { options: ConfirmOptions; resolve: (ok: boolean) => void };
type ConfirmListener = (request: ConfirmRequest) => void;

let toastListener: ToastListener | null = null;
let confirmListener: ConfirmListener | null = null;

/** 최소 토스트 — Android는 네이티브, iOS는 Alert, 웹은 자체 호스트 */
export function showToast(message: string): void {
  if (Platform.OS === 'android') {
    ToastAndroid.show(message, ToastAndroid.SHORT);
    return;
  }
  if (isWeb) {
    // 호스트 미마운트(테스트·초기 부팅)면 조용히 버린다 — 토스트 때문에 흐름이 깨지면 안 된다
    toastListener?.(message);
    return;
  }
  Alert.alert(message);
}

/**
 * 확인 다이얼로그 — 확인=true / 취소·닫기=false.
 * 네이티브는 OS 다이얼로그, 웹은 자체 모달. 호스트가 없으면 **false**(=취소)로 닫는다:
 * 확인을 못 받은 상태에서 파괴적 동작이 진행되는 쪽이 훨씬 나쁘다.
 */
export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  if (isWeb) {
    if (!confirmListener) return Promise.resolve(false);
    return new Promise<boolean>((resolve) => {
      confirmListener?.({ options, resolve });
    });
  }
  return new Promise<boolean>((resolve) => {
    Alert.alert(options.title, options.message, [
      { text: options.cancelText ?? '취소', style: 'cancel', onPress: () => resolve(false) },
      {
        text: options.confirmText ?? '확인',
        style: options.destructive ? 'destructive' : 'default',
        onPress: () => resolve(true),
      },
    ]);
  });
}

/**
 * 루트에 1회 마운트 — 웹에서 토스트·확인 모달을 실제로 렌더한다.
 * 네이티브에서는 아무것도 렌더하지 않는다(OS 다이얼로그가 담당).
 */
export function FeedbackHost(): React.JSX.Element | null {
  const [toast, setToast] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);

  useEffect(() => {
    if (!isWeb) return;
    toastListener = (message) => setToast(message);
    confirmListener = (request) => setConfirm(request);
    return () => {
      toastListener = null;
      confirmListener = null;
    };
  }, []);

  useEffect(() => {
    if (toast == null) return;
    const timer = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(timer);
  }, [toast]);

  if (!isWeb) return null;

  const settle = (ok: boolean): void => {
    confirm?.resolve(ok);
    setConfirm(null);
  };

  return (
    <>
      {confirm && (
        <Modal transparent animationType="fade" onRequestClose={() => settle(false)}>
          <Pressable style={styles.backdrop} onPress={() => settle(false)}>
            {/* 카드 클릭이 배경으로 새어 닫히지 않도록 흡수 */}
            <Pressable style={styles.card} onPress={() => {}}>
              <Text style={styles.title}>{confirm.options.title}</Text>
              {confirm.options.message ? (
                <Text style={styles.message}>{confirm.options.message}</Text>
              ) : null}
              <View style={styles.actions}>
                <Pressable
                  accessibilityRole="button"
                  style={[styles.action, styles.cancel]}
                  onPress={() => settle(false)}
                >
                  <Text style={styles.cancelLabel}>{confirm.options.cancelText ?? '취소'}</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  style={[
                    styles.action,
                    confirm.options.destructive ? styles.destructive : styles.primary,
                  ]}
                  onPress={() => settle(true)}
                >
                  <Text style={styles.confirmLabel}>{confirm.options.confirmText ?? '확인'}</Text>
                </Pressable>
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      )}
      {toast != null && (
        <View style={styles.toastWrap} pointerEvents="none">
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.4)',
    padding: spacing.lg,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: colors.card,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  title: { fontSize: typo.title, fontWeight: '700', color: colors.text },
  message: { fontSize: typo.body, color: colors.textMuted },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.md },
  action: {
    minHeight: 44,
    minWidth: 88,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.md,
    paddingHorizontal: spacing.lg,
  },
  cancel: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  primary: { backgroundColor: colors.primary },
  destructive: { backgroundColor: colors.danger },
  cancelLabel: { fontSize: typo.body, color: colors.text, fontWeight: '600' },
  confirmLabel: { fontSize: typo.body, color: '#FFFFFF', fontWeight: '600' },
  toastWrap: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    bottom: spacing.xl,
    alignItems: 'center',
  },
  toastText: {
    fontSize: typo.body,
    color: '#FFFFFF',
    backgroundColor: 'rgba(17,17,20,0.92)',
    borderRadius: radii.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    overflow: 'hidden',
    textAlign: 'center',
  },
});
