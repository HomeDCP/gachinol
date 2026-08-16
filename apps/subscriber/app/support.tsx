import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Head from 'expo-router/head';
import { colors, radii, spacing, touchTarget, typo } from '@gachinol/ui';
import { FAQ_CATEGORY_LABELS, FAQ_ITEMS } from '../src/support/faq-data';
import type { FaqItem } from '../src/support/faq-data';
import { resolveSupportChannelsFromEnv } from '../src/support/support-contacts';
import type { SupportChannel } from '../src/support/support-contacts';
import { Screen } from '../src/ui/screen';

/**
 * 문의하기 라우트 (T-W1-09 — 정본 06 §F-6, 수신 02 §E-17).
 *
 * 06 §F-6이 정한 **4요소**: `tel:` 링크 · 카카오톡 채널 링크 · **대표 이메일 링크** · FAQ.
 * (02 §E-17은 앞 3개만 인용한 축약이라 그대로 따르면 대표 이메일이 빠진다 — 02가 "06 §F-6 수신"을
 * 자칭하므로 06 정본의 4요소가 판정 기준. E2 §C T-W1-09 셀의 EVAL-ROUND-13 K-7 판정.)
 *
 * **정적 페이지다** — 네트워크 호출 0회, 로그인 0, 목 데이터 0. 연락처는 앱 env에서 오고
 * (수신처가 지사가 아니라 센터인 근거는 `src/support/support-contacts.ts` 상단 참조),
 * **설정되지 않은 항목은 아예 렌더하지 않는다**(흐린 버튼 금지).
 *
 * 진입 링크(탭·설정 화면 등에서 이 페이지로 가는 링크)는 신설하지 않는다 — 02 §E-17이 요구하지
 * 않으며 직접 URL 접근만 가능한 상태가 설계 의도다(E2 EVAL-ROUND-21 Y2-8). 같은 판정(E2 D12-1)에
 * 따라 `app/_layout.tsx`에도 등록하지 않으므로 Stack 헤더가 없다 → 화면 제목을 본문 맨 위에 직접
 * 렌더한다.
 */

const SUPPORT_TITLE = '문의하기 — 가치놀';
const SUPPORT_DESCRIPTION =
  '가치놀 마을방송 이용 중 궁금한 점을 전화·카카오톡·이메일로 문의하실 수 있습니다. 자주 묻는 질문도 함께 보세요.';

/** 문의하기 라우트 고정(정적) OG 메타 — 지사 목록·홈과 동일 원칙 */
function SupportHead(): React.JSX.Element {
  return (
    <Head>
      <title>{SUPPORT_TITLE}</title>
      <meta name="description" content={SUPPORT_DESCRIPTION} />
      <meta property="og:type" content="website" />
      <meta property="og:title" content={SUPPORT_TITLE} />
      <meta property="og:description" content={SUPPORT_DESCRIPTION} />
    </Head>
  );
}

/**
 * 연락 채널 카드 1개.
 *
 * 웹에서 실제로 열리는 방식(react-native-web 0.21 `Linking.openURL` 구현 확인):
 * `tel:`은 `window.location = url`로 이동해 다이얼러를 띄우고, 그 밖(`mailto:`·`https:`)은
 * `window.open(url, '_blank', 'noopener')`으로 연다 — 메일 클라이언트·카카오 채널이 새 탭 경유로
 * 뜬다. 네이티브(쉘 앱)에서는 RN 기본 구현이 그대로 동작한다. 리포의 다른 화면
 * (`watch/[id]`·`live/[id]`·홈 배너)도 전부 이 방식이라 동작 검증 경로가 하나다.
 */
function ChannelCard({ channel }: { channel: SupportChannel }): React.JSX.Element {
  return (
    <Pressable
      style={styles.channelCard}
      accessibilityRole="button"
      accessibilityLabel={`${channel.label} ${channel.value}`}
      onPress={() => void Linking.openURL(channel.href)}
    >
      <Text style={styles.channelLabel}>{channel.label}</Text>
      <Text style={styles.channelValue}>{channel.value}</Text>
      <Text style={styles.channelNote}>{channel.note}</Text>
    </Pressable>
  );
}

function FaqCard({ item }: { item: FaqItem }): React.JSX.Element {
  return (
    <View style={styles.faqCard}>
      <Text style={styles.faqCategory}>{FAQ_CATEGORY_LABELS[item.category]}</Text>
      <Text style={styles.faqQuestion} accessibilityRole="header">
        {item.question}
      </Text>
      <Text style={styles.faqAnswer}>{item.answer}</Text>
    </View>
  );
}

export default function SupportScreen(): React.JSX.Element {
  const channels = resolveSupportChannelsFromEnv();

  return (
    <Screen>
      <SupportHead />
      {/*
        세로 스크롤 1개. 대장 #93(RNW ScrollView 함정)은 가로 칩 줄에서 난 문제라 여기 해당하지
        않지만, 같은 뿌리(RNW의 기본 flex 축소)를 피하려고 콘텐츠 컨테이너에 flex 값을 주지 않고
        패딩만 준다 — 항목이 늘어나면 그대로 아래로 길어진다.
      */}
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title} accessibilityRole="header">
          문의하기
        </Text>
        <Text style={styles.lead}>
          마을방송을 보시다가 궁금하거나 불편한 점이 있으면 편하신 방법으로 알려 주세요.
        </Text>

        {channels.length > 0 ? (
          <View style={styles.section}>
            {channels.map((channel) => (
              <ChannelCard key={channel.key} channel={channel} />
            ))}
          </View>
        ) : (
          // 연락처가 하나도 설정되지 않은 배포에서 빈 화면을 주지 않는다. 없는 번호를 지어내지도,
          // 눌리지 않는 버튼을 두지도 않고, 없다는 사실만 정직하게 알린다(FAQ는 그대로 남는다).
          <View style={styles.section}>
            <View style={styles.noticeCard}>
              <Text style={styles.noticeText}>
                연락처를 준비하고 있습니다. 아래 자주 묻는 질문을 먼저 확인해 주세요.
              </Text>
            </View>
          </View>
        )}

        <Text style={styles.sectionTitle} accessibilityRole="header">
          자주 묻는 질문
        </Text>
        <View style={styles.section}>
          {FAQ_ITEMS.map((item) => (
            <FaqCard key={item.id} item={item} />
          ))}
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, paddingBottom: spacing.xl, gap: spacing.md },
  title: { fontSize: typo.title, fontWeight: '700', color: colors.text },
  lead: { fontSize: typo.body, color: colors.textMuted, lineHeight: 28 },
  sectionTitle: {
    fontSize: typo.title,
    fontWeight: '700',
    color: colors.text,
    marginTop: spacing.md,
  },
  section: { gap: spacing.md },
  channelCard: {
    // 03 §A-1 타깃 크기 하한 — 손가락 폭 이상. 어르신 이용자가 주 사용자다.
    minHeight: touchTarget.min,
    backgroundColor: colors.card,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  channelLabel: { fontSize: typo.body, fontWeight: '700', color: colors.primary },
  channelValue: { fontSize: typo.title, fontWeight: '700', color: colors.text },
  channelNote: { fontSize: typo.caption, color: colors.textMuted, lineHeight: 24 },
  noticeCard: {
    backgroundColor: colors.card,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  noticeText: { fontSize: typo.body, color: colors.textMuted, lineHeight: 28 },
  faqCard: {
    backgroundColor: colors.card,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  faqCategory: { fontSize: typo.caption, fontWeight: '700', color: colors.textMuted },
  faqQuestion: { fontSize: typo.body, fontWeight: '700', color: colors.text, lineHeight: 28 },
  faqAnswer: { fontSize: typo.body, color: colors.text, lineHeight: 28 },
});
