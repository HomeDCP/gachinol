import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
} from 'react-native';
import { validateLogin } from '../../src/features/contents/validation';
import { userMessageForError } from '../../src/api/errors';
import { useSession } from '../../src/auth/auth-context';
import { Button } from '../../src/ui/button';
import { FormField } from '../../src/ui/form-field';
import { Screen } from '../../src/ui/screen';
import { colors, radii, spacing, typo } from '../../src/ui/theme';

/** ① 로그인 — role 게이트(센터 전용)는 AuthProvider가 처리 */
export default function LoginScreen(): React.JSX.Element {
  const { signIn } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const submit = async (): Promise<void> => {
    const result = validateLogin(email, password);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    setSubmitting(true);
    try {
      await signIn(result.value.email, result.value.password);
    } catch (err) {
      // 401은 서버 메시지 그대로 (실패 3종 동일 메시지 — 계정 열거 방지).
      // 비센터 계정은 AuthProvider가 CENTER_ONLY_MESSAGE를 Error로 던진다.
      setErrors({
        form: err instanceof Error && !('status' in err) ? err.message : userMessageForError(err),
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Screen>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <Text style={styles.title}>가치놀 관제</Text>
          <Text style={styles.subtitle}>제주방송센터 관제·검토</Text>
          <FormField label="이메일" error={errors.email}>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              editable={!submitting}
              placeholder="operator@example.com"
              placeholderTextColor={colors.textMuted}
            />
          </FormField>
          <FormField label="비밀번호" error={errors.password}>
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              editable={!submitting}
              placeholder="비밀번호"
              placeholderTextColor={colors.textMuted}
            />
          </FormField>
          {errors.form ? <Text style={styles.formError}>{errors.form}</Text> : null}
          <Button label="로그인" onPress={() => void submit()} loading={submitting} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flexGrow: 1, justifyContent: 'center', padding: spacing.xl },
  title: { fontSize: 28, fontWeight: '700', color: colors.text, textAlign: 'center' },
  subtitle: {
    fontSize: typo.body,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.xs,
    marginBottom: spacing.xl,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    backgroundColor: colors.card,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: typo.body,
    color: colors.text,
  },
  formError: {
    color: colors.danger,
    fontSize: typo.caption,
    marginBottom: spacing.md,
    textAlign: 'center',
  },
});
