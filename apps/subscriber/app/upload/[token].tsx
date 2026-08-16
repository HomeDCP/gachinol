import { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { colors, radii, spacing, touchTarget, typo } from '@gachinol/ui';
import { SimpleModeNotice } from '../../src/upload/SimpleModeNotice';
import { UploadCanceledError } from '../../src/upload/dom-uploader';
import {
  checkSelectedVideo,
  formatMegabytes,
  formatRemainingTime,
  formatRemainingUploads,
  LEGAL_CONSENT_TEXT,
  normalizeToken,
  resolveResidentLinkGate,
  resolveUploadDoneNotice,
  resolveUploadErrorMessage,
  shouldCollectConsent,
  type UploadDoneNotice,
} from '../../src/upload/gate';
import { useResidentLink, useResidentLinkApi } from '../../src/upload/queries';
import {
  completeResidentUpload,
  createResidentUpload,
  type ResidentLinkApiDeps,
  type ResidentLinkPublicView,
} from '../../src/upload/resident-link-api';
import { createResidentUploader } from '../../src/upload/uploader';
import {
  UNSUPPORTED_UPLOAD_NOTICE,
  type PickedVideo,
  type PickSource,
} from '../../src/upload/upload-contract';
import { LoadingView } from '../../src/ui/loading-view';
import { Screen } from '../../src/ui/screen';

/* ══════════════════════════════════════════════════════════════════════════
 * 주민 임시 업로드 링크 화면 (T-W2-09 — 정본 03 §C-5, 서버 T-W2-08)
 *
 * ── 왜 구독자 앱인가 ──────────────────────────────────────────────────────
 * **무인증**이 이 화면의 핵심 설계다. 기자 앱은 로그인 게이트 뒤에 있어 성립하지 않고, 익명 접근을
 * 이미 전제하는 구독자 앱이 유일하게 정합한다(E2 §C 확정).
 *
 * ── 토큰 취급 ────────────────────────────────────────────────────────────
 * URL 경로 세그먼트(`/upload/<token>`)가 **유일한 자격 증명**이다. 그래서 이 화면은 토큰을
 * ⓐ 로그에 남기지 않고 ⓑ 에러 메시지·화면 어디에도 렌더하지 않으며 ⓒ 외부 요청(스토리지 PUT 포함)에
 * 싣지 않는다 — 서버가 준 서명 URL만 그대로 쓴다. 잘못된/만료된 토큰은 감추지 않고 사유별로
 * 정직하게 안내한다(`resolveResidentLinkGate`).
 *
 * ── 판정은 전부 gate.ts에 있다 ─────────────────────────────────────────────
 * 이 파일에는 if 분기가 있어도 **규칙**은 없다. 링크 상태·파일 적합성·에러 문구·완료 안내는 전부
 * 순수 함수가 돌려준 값을 렌더할 뿐이다(화면에 판정을 쓰면 조용히 무보호가 된다).
 *
 * ── 확인 대화상자를 쓰지 않는다 ────────────────────────────────────────────
 * react-native-web의 `Alert.alert`는 **빈 함수**라 콜백이 영원히 실행되지 않는다(대장 #92).
 * 이 화면은 확인이 필요한 지점을 전부 **화면 안 UI**(선택 결과 표시 → 별도의 [올리기] 버튼)로
 * 처리해 대화상자 자체를 없앴다 — 어르신 사용자에게도 모달보다 나은 형태다(03 §A).
 * ══════════════════════════════════════════════════════════════════════════ */

export default function ResidentUploadScreen(): React.JSX.Element {
  const params = useLocalSearchParams<{ token?: string | string[] }>();
  const token = normalizeToken(params.token);
  const api = useResidentLinkApi();
  const linkQuery = useResidentLink(api, token);

  const gate = resolveResidentLinkGate({
    token: params.token,
    isPending: linkQuery.isPending,
    error: linkQuery.error,
    view: linkQuery.data,
  });

  if (gate.kind === 'loading') {
    return (
      <Screen>
        <LoadingView />
      </Screen>
    );
  }

  if (gate.kind !== 'ready' || !gate.view) {
    return (
      <Screen>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
          <Text style={styles.title}>{gate.title}</Text>
          <Text style={styles.body}>{gate.body}</Text>
          {gate.retryable ? (
            <BigButton label="다시 시도" onPress={() => void linkQuery.refetch()} />
          ) : null}
        </ScrollView>
      </Screen>
    );
  }

  return (
    <Screen>
      <UploadForm view={gate.view} token={token as string} api={api} onChanged={linkQuery.refetch} />
    </Screen>
  );
}

/* ─────────────────────────── 업로드 폼(ready 전용) ─────────────────────────── */

interface UploadFormProps {
  readonly view: ResidentLinkPublicView;
  readonly token: string;
  readonly api: ResidentLinkApiDeps;
  readonly onChanged: () => unknown;
}

function UploadForm({ view, token, api, onChanged }: UploadFormProps): React.JSX.Element {
  const uploader = useMemo(() => createResidentUploader(), []);
  const [selected, setSelected] = useState<PickedVideo | null>(null);
  const [selectError, setSelectError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [done, setDone] = useState<UploadDoneNotice | null>(null);
  const [contact, setContact] = useState('');
  const [consentAgreed, setConsentAgreed] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const consentRequired = shouldCollectConsent();
  const uploading = progress !== null;

  const pick = useCallback(
    async (source: PickSource) => {
      setSelectError(null);
      setUploadError(null);
      setDone(null);
      let picked: PickedVideo | null = null;
      try {
        picked = await uploader.pickVideo(source);
      } catch {
        setSelectError(UNSUPPORTED_UPLOAD_NOTICE);
        return;
      }
      if (!picked) return; // 사용자가 취소 — 아무 일도 없었던 것처럼 둔다
      const check = checkSelectedVideo(picked, view.maxFileSizeBytes);
      if (!check.ok) {
        setSelected(null);
        setSelectError(check.message);
        return;
      }
      setSelected(picked);
    },
    [uploader, view.maxFileSizeBytes],
  );

  const upload = useCallback(async () => {
    if (!selected) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setUploadError(null);
    setProgress(0);
    try {
      // ① presigned PUT 발급 — 서버가 이 시점에 슬롯 1개를 소비한다(제한 단위 = 업로드 "시도")
      const ticket = await createResidentUpload(api, token, {
        fileName: selected.name,
        mimeType: selected.mimeType,
        sizeBytes: selected.sizeBytes,
        ...(contact.trim() ? { uploaderContact: contact.trim() } : {}),
        // ★ 동의 문구가 실재할 때만 동의를 보낸다 — 문구 없는 동의는 기록하지 않는다(07 §3-15)
        ...(consentRequired ? { consentAgreed: true } : {}),
      });
      // ② 스토리지로 직행(api 경유 없음). 서명이 URL에 있어 헤더 인증이 없다
      await uploader.putVideo(ticket.uploadUrl, selected, setProgress, controller.signal);
      // ③ 완료 통지 — 여기서 미디어 큐 인큐가 **없다**(검수 승인 전 파이프라인 미진입, 03 §C-5)
      const receipt = await completeResidentUpload(api, token, ticket.uploadId);
      setDone(resolveUploadDoneNotice(receipt));
      setSelected(null);
    } catch (err) {
      if (!(err instanceof UploadCanceledError)) setUploadError(resolveUploadErrorMessage(err));
    } finally {
      abortRef.current = null;
      setProgress(null);
      // 남은 횟수·만료는 서버가 원천이다 — 성공이든 실패든 다시 물어본다(클라 계산 금지)
      void onChanged();
    }
  }, [api, consentRequired, contact, onChanged, selected, token, uploader]);

  const canUpload = selected !== null && !uploading && (!consentRequired || consentAgreed);

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
      <Text style={styles.title}>{view.stationName}에 영상 보내기</Text>
      <Text style={styles.meta}>
        {formatRemainingUploads(view.remainingUploads, view.maxUploads)} ·{' '}
        {formatRemainingTime(view.expiresAt, new Date())}
      </Text>
      <Text style={styles.meta}>영상 한 개는 {formatMegabytes(view.maxFileSizeBytes)}까지</Text>

      <SimpleModeNotice />

      {done ? <DoneCard notice={done} /> : null}

      {!uploader.supported ? (
        <Text style={styles.warn}>{UNSUPPORTED_UPLOAD_NOTICE}</Text>
      ) : (
        <>
          <View style={styles.pickRow}>
            <BigButton
              label="촬영해서 올리기"
              onPress={() => void pick('camera')}
              disabled={uploading}
            />
            <BigButton
              label="저장된 영상 고르기"
              onPress={() => void pick('library')}
              disabled={uploading}
              tone="secondary"
            />
          </View>

          {selectError ? <Text style={styles.error}>{selectError}</Text> : null}

          {selected ? (
            <View style={styles.selectedCard}>
              <Text style={styles.selectedName} numberOfLines={2}>
                {selected.name}
              </Text>
              <Text style={styles.meta}>{formatMegabytes(selected.sizeBytes)}</Text>
            </View>
          ) : null}

          <Text style={styles.fieldLabel}>연락처 (선택)</Text>
          <TextInput
            style={styles.input}
            value={contact}
            onChangeText={setContact}
            placeholder="예: 010-1234-5678"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            editable={!uploading}
            accessibilityLabel="연락처 입력(선택)"
          />

          {/* 07 §3-15 ⓑ 클릭동의 — 확정 문구가 생기면(gate.ts LEGAL_CONSENT_TEXT) 이 블록이 살아난다 */}
          {consentRequired && LEGAL_CONSENT_TEXT ? (
            <Pressable
              style={styles.consentRow}
              onPress={() => setConsentAgreed((v) => !v)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: consentAgreed }}
            >
              <Text style={styles.checkbox}>{consentAgreed ? '☑' : '☐'}</Text>
              <Text style={styles.consentText}>{LEGAL_CONSENT_TEXT}</Text>
            </Pressable>
          ) : null}

          {uploading ? (
            <View style={styles.progressCard}>
              <ActivityIndicator color={colors.primary} />
              <Text style={styles.progressText}>
                보내는 중 {Math.round((progress ?? 0) * 100)}%
              </Text>
              <BigButton
                label="멈추기"
                tone="secondary"
                onPress={() => abortRef.current?.abort()}
              />
            </View>
          ) : (
            <BigButton label="이 영상 보내기" onPress={() => void upload()} disabled={!canUpload} />
          )}

          {uploadError ? <Text style={styles.error}>{uploadError}</Text> : null}
        </>
      )}
    </ScrollView>
  );
}

function DoneCard({ notice }: { notice: UploadDoneNotice }): React.JSX.Element {
  return (
    <View style={styles.doneCard}>
      <Text style={styles.doneTitle}>{notice.title}</Text>
      <Text style={styles.body}>{notice.body}</Text>
    </View>
  );
}

/** 어르신 우선(03 §A-1) — 최소 히트 영역 토큰(44)보다 크게 잡고 글자도 본문 크기 그대로 */
function BigButton({
  label,
  onPress,
  disabled,
  tone = 'primary',
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  tone?: 'primary' | 'secondary';
}): React.JSX.Element {
  const secondary = tone === 'secondary';
  return (
    <Pressable
      style={[
        styles.button,
        secondary ? styles.buttonSecondary : styles.buttonPrimary,
        disabled ? styles.buttonDisabled : null,
      ]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled) }}
    >
      <Text style={[styles.buttonLabel, secondary ? styles.buttonLabelSecondary : null]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // ScrollView 기본값(flexGrow:1·flexShrink:1) 함정(대장 #93) — 컨테이너는 flex:1, 내용은 padding·gap
  scroll: { flex: 1, width: '100%' },
  scrollContent: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xl * 2 },
  title: { fontSize: typo.title, fontWeight: '700', color: colors.text },
  body: { fontSize: typo.body, lineHeight: 28, color: colors.text },
  meta: { fontSize: typo.caption, color: colors.textMuted },
  warn: { fontSize: typo.body, lineHeight: 28, color: colors.warning },
  error: { fontSize: typo.body, lineHeight: 28, color: colors.danger },
  fieldLabel: { fontSize: typo.body, fontWeight: '600', color: colors.text, marginTop: spacing.sm },
  input: {
    minHeight: touchTarget.min + 8,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.card,
    paddingHorizontal: spacing.lg,
    fontSize: typo.body,
    color: colors.text,
  },
  pickRow: { gap: spacing.sm },
  selectedCard: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  selectedName: { fontSize: typo.body, fontWeight: '600', color: colors.text },
  progressCard: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.md },
  progressText: { fontSize: typo.body, color: colors.text },
  doneCard: {
    backgroundColor: colors.card,
    borderWidth: 2,
    borderColor: colors.success,
    borderRadius: radii.md,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  doneTitle: { fontSize: typo.title, fontWeight: '700', color: colors.success },
  consentRow: { flexDirection: 'row', gap: spacing.sm, minHeight: touchTarget.min },
  checkbox: { fontSize: typo.title, color: colors.primary },
  consentText: { flex: 1, fontSize: typo.body, lineHeight: 28, color: colors.text },
  button: {
    minHeight: touchTarget.min + 12,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  buttonPrimary: { backgroundColor: colors.primary },
  buttonSecondary: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  buttonDisabled: { opacity: 0.4 },
  buttonLabel: { fontSize: typo.body, fontWeight: '700', color: '#FFFFFF' },
  buttonLabelSecondary: { color: colors.primary },
});
