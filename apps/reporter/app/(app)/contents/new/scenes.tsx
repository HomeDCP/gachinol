import { useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { SceneListEditor } from '../../../../src/features/contents/components/scene-list-editor';
import { useDraft } from '../../../../src/features/contents/draft-context';
import { validateScenes } from '../../../../src/features/contents/validation';
import { Button } from '../../../../src/ui/button';
import { Screen } from '../../../../src/ui/screen';
import { spacing } from '../../../../src/ui/theme';

/** ③-2 장면별 자막·설명 기입 */
export default function ScenesScreen(): React.JSX.Element {
  const { scenes, setScenes } = useDraft();
  const [errors, setErrors] = useState<Record<string, string>>({});

  const next = (): void => {
    const result = validateScenes(scenes);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    router.push('/contents/new/classify');
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <SceneListEditor scenes={scenes} onChange={setScenes} errors={errors} />
        <Button label="다음 — 분류·저장" onPress={next} style={styles.next} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, paddingBottom: spacing.xl * 2 },
  next: { marginTop: spacing.lg },
});
