import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { CreateStationRequest, UpdateStationRequest } from '@gachinol/shared';
import { Button } from '../../ui/button';
import { FormField } from '../../ui/form-field';
import { colors, radii, spacing, typo } from '../../ui/theme';
import {
  validateCreateStation,
  validateUpdateStation,
  type StationFormValues,
} from './validation';

/**
 * 지사 생성·수정 폼 (하단 시트) — **admin 전용 화면 요소**.
 * 호출부(`app/(app)/(tabs)/stations.tsx`)가 `canManageStations()`로 렌더 자체를 막으므로
 * 이 컴포넌트는 권한을 다시 판단하지 않는다(게이트 이중화는 어느 쪽이 진짜인지 흐린다).
 *
 * 라우트 트리(`app/`)가 아니라 `src/features/`에 두는 이유: expo-router의 require.context는
 * `app/` 하위 파일을 전부 라우트로 흡수하므로 화면 조각·테스트는 `src/`에 있어야 한다.
 */

type StationFormProps = {
  visible: boolean;
  initial: StationFormValues;
  submitting: boolean;
  /** 서버 실패 메시지 (code 중복 409 등) — 폼 상단에 그대로 노출 */
  serverError?: string;
  onCancel(): void;
} & (
  | { mode: 'create'; onSubmit(body: CreateStationRequest): void }
  | { mode: 'edit'; onSubmit(body: UpdateStationRequest): void }
);

export function StationFormSheet(props: StationFormProps): React.JSX.Element {
  const { visible, initial, submitting, serverError, onCancel } = props;
  const [values, setValues] = useState<StationFormValues>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  // 시트를 다시 열 때 프리필을 갈아끼운다 (initial 참조가 바뀌면 폼 상태를 리셋)
  const [seed, setSeed] = useState(initial);
  if (seed !== initial) {
    setSeed(initial);
    setValues(initial);
    setErrors({});
  }

  const set = (key: keyof StationFormValues) => (text: string) =>
    setValues((prev) => ({ ...prev, [key]: text }));

  const submit = (): void => {
    if (props.mode === 'create') {
      const result = validateCreateStation(values);
      if (!result.ok) {
        setErrors(result.errors);
        return;
      }
      setErrors({});
      props.onSubmit(result.value);
      return;
    }
    const result = validateUpdateStation(values);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    props.onSubmit(result.value);
  };

  const isCreate = props.mode === 'create';

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.sheet}>
          <Text style={styles.title}>{isCreate ? '지사 추가' : '지사 정보 수정'}</Text>
          {serverError ? <Text style={styles.serverError}>{serverError}</Text> : null}
          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.bodyContent}
            keyboardShouldPersistTaps="handled"
          >
            {isCreate ? (
              <FormField label="지사 코드 (필수)" error={errors.code} hint="소문자·숫자·하이픈">
                <TextInput
                  style={styles.input}
                  value={values.code}
                  onChangeText={set('code')}
                  placeholder="aewol"
                  placeholderTextColor={colors.textMuted}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </FormField>
            ) : (
              <FormField label="지사 코드" hint="수정 불가">
                <Text style={styles.readonly}>{values.code}</Text>
              </FormField>
            )}

            <FormField label="지사 이름 (필수)" error={errors.name}>
              <TextInput
                style={styles.input}
                value={values.name}
                onChangeText={set('name')}
                placeholder="애월 마을방송국"
                placeholderTextColor={colors.textMuted}
              />
            </FormField>

            <FormField label="행정구역 (필수)" error={errors.region}>
              <TextInput
                style={styles.input}
                value={values.region}
                onChangeText={set('region')}
                placeholder="제주시 애월읍"
                placeholderTextColor={colors.textMuted}
              />
            </FormField>

            <FormField label="정렬 순서 (필수)" error={errors.sortOrder} hint="0 이상 정수">
              <TextInput
                style={styles.input}
                value={values.sortOrder}
                onChangeText={set('sortOrder')}
                placeholder="1"
                placeholderTextColor={colors.textMuted}
                keyboardType="number-pad"
              />
            </FormField>

            <FormField label="소개" error={errors.description}>
              <TextInput
                style={[styles.input, styles.multiline]}
                value={values.description}
                onChangeText={set('description')}
                placeholder="지사 소개 (선택)"
                placeholderTextColor={colors.textMuted}
                multiline
                maxLength={2000}
              />
            </FormField>

            <FormField label="대표번호" error={errors.supportTel} hint="숫자·하이픈">
              <TextInput
                style={styles.input}
                value={values.supportTel}
                onChangeText={set('supportTel')}
                placeholder="064-000-0000"
                placeholderTextColor={colors.textMuted}
                keyboardType="phone-pad"
              />
            </FormField>

            <FormField label="유튜브 채널" error={errors.youtubeUrl} hint="https youtube.com">
              <TextInput
                style={styles.input}
                value={values.youtubeUrl}
                onChangeText={set('youtubeUrl')}
                placeholder="https://youtube.com/@aewol"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </FormField>

            <FormField label="대표 이미지 주소" error={errors.thumbnailUrl}>
              <TextInput
                style={styles.input}
                value={values.thumbnailUrl}
                onChangeText={set('thumbnailUrl')}
                placeholder="https://…"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </FormField>

            <FormField label="설립일" error={errors.foundedAt} hint="YYYY-MM-DD">
              <TextInput
                style={styles.input}
                value={values.foundedAt}
                onChangeText={set('foundedAt')}
                placeholder="2025-03-01"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </FormField>

            <Text style={styles.note}>
              {isCreate
                ? '생성 직후 상태는 “설립 예정”입니다. 운영 시작은 목록의 상태 액션으로 진행합니다.'
                : '선택 항목을 비워 두면 기존 값이 그대로 유지됩니다(값 지우기는 지원하지 않습니다).'}
            </Text>
          </ScrollView>
          <View style={styles.actions}>
            {/* 라벨은 시트 제목("지사 추가")과 겹치지 않게 짧게 — 화면에 같은 문자열이 둘이면 사람도 도구도 헷갈린다 */}
            <Button label={isCreate ? '추가' : '저장'} onPress={submit} loading={submitting} />
            <Button label="취소" variant="secondary" onPress={onCancel} disabled={submitting} />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.sm,
    maxHeight: '90%',
  },
  title: { fontSize: typo.title, fontWeight: '700', color: colors.text },
  serverError: { fontSize: typo.caption, color: colors.danger },
  // RNW의 ScrollView는 기본 flexGrow:1이라 시트를 밀어 올린다 → flexGrow:0 (대장 #93)
  body: { flexGrow: 0 },
  bodyContent: { paddingTop: spacing.sm },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    backgroundColor: colors.bg,
    padding: spacing.md,
    fontSize: typo.body,
    color: colors.text,
  },
  multiline: { minHeight: 88, textAlignVertical: 'top' },
  readonly: { fontSize: typo.body, color: colors.textMuted, paddingVertical: spacing.sm },
  note: { fontSize: typo.caption, color: colors.textMuted, lineHeight: 18 },
  actions: { gap: spacing.sm, paddingTop: spacing.sm },
});
