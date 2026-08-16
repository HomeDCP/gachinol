import { useState } from 'react';
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, radii, spacing, typo } from '@gachinol/ui';
import { getLiveFallbackYoutubeUrl, getSupportTelHref } from '../src/config/env';
import { HlsVideo } from '../src/live/hls-video';
import { Badge } from '../src/ui/badge';
import {
  PlaybackFallback,
  resolveLiveFallbackButtons,
  resolvePlaybackFallbackMessage,
} from '../src/ui/playback-fallback';
import { Screen } from '../src/ui/screen';
import { getPublishedLiveNotice } from '../src/schedule/live-notice';
import type { PublishedLiveNotice } from '../src/schedule/live-notice';
import { SLOT_KIND_LABEL, SLOT_KIND_TONE } from '../src/schedule/labels';
import {
  formatDaysAhead,
  formatTodayHeading,
  nextLive,
  scheduleFromToday,
} from '../src/schedule/schedule-clock';
import { EMERGENCY_SLOT } from '../src/schedule/schedule-data';
import type { ScheduleSlot } from '../src/schedule/schedule-data';

/**
 * 정적 방송 편성표 (`/schedule`) — T-W1-10 (02 §E-21, 04 §B④ "라이브 신규 진입 완화책"의 기술 전제).
 *
 * ── 이 화면의 유일한 불변식: **네트워크 호출 0** ──────────────────────────────────
 * 04 §B④는 제온(api)이 죽으면 `GET /live/sessions/:id`가 같이 죽어 **라이브 신규 진입이 0**이
 * 되는 문제를 이 페이지로 완화하라고 발주했다. 따라서 이 화면이 api를 한 번이라도 부르면
 * **필요한 바로 그 순간에 같이 죽어** 존재 이유가 사라진다. `useLiveSessions`·`ApiClient`·
 * `fetch`를 여기서 쓰지 않는다 — 렌더 테스트가 `fetch` 미호출을 고정한다.
 *
 * ── `app/(tabs)/live.tsx`와 무엇이 다른가 (중복이 아닌 이유) ─────────────────────
 * | | `(tabs)/live.tsx` | 이 화면 |
 * |---|---|---|
 * | 데이터 | `GET /v1/live/sessions`(실 세션) | 코드에 박힌 정적 편성 + 빌드 시 주입된 URL |
 * | api 다운 시 | 화면 전체가 오류 | **그대로 동작**(정적 자산, CF 캐시) |
 * | 답하는 질문 | "지금 어떤 세션이 있나" | "언제 방송하나 / 지금 어디로 들어가나" |
 * 정상 상황의 정규 경로는 `live.tsx`이고, 이 화면은 **가용성 계층이 다른 이중화**다(대체 아님).
 *
 * ── `_layout.tsx`에 등재하지 않는 이유 ──────────────────────────────────────────
 * E2 D12-1 판정: 정적 페이지라 Stack 옵션 오버라이드 사유가 없다. 루트 Stack 기본값
 * (`headerShown: false`)을 그대로 받고 제목은 이 화면이 직접 렌더한다.
 * 앱 내부 진입 링크도 신설하지 않는다 — 04 §B④의 설계 의도가 **정적 URL 직접 게시**다
 * (카톡 공지·고정 배너에서 `https://<도메인>/schedule`로 바로 들어온다).
 */
export default function ScheduleScreen(): React.JSX.Element {
  const now = new Date();
  const notice = getPublishedLiveNotice();
  const upcoming = nextLive(now);
  const week = scheduleFromToday(now);

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.pageTitle}>방송 편성표</Text>
        <Text style={styles.pageSubtitle}>{formatTodayHeading(now)} · 제주 기준</Text>

        {notice ? <LiveNowCard notice={notice} /> : <NoLiveCard upcoming={upcoming} />}

        <Text style={styles.sectionTitle}>이번 주 편성</Text>
        {week.map((slot, index) => (
          <SlotRow key={slot.weekday} slot={slot} today={index === 0} />
        ))}

        <Text style={styles.sectionTitle}>그 밖에</Text>
        <SlotRow slot={EMERGENCY_SLOT} today={false} />

        <View style={styles.notice}>
          <Text style={styles.noticeText}>
            방송 시작 시각은 방송 전에 카카오톡 채널로 알려 드립니다.
          </Text>
          <Text style={styles.noticeText}>
            이 화면은 저장해 두셨다가 언제든 다시 열어 보실 수 있습니다.
          </Text>
        </View>
      </ScrollView>
    </Screen>
  );
}

/**
 * 게시된 생방송이 있을 때 — 04 §B④가 말하는 "HLS URL 직접 포함"의 실체.
 * 세션 id도, 서명 URL 발급도 거치지 않고 곧바로 재생한다.
 */
function LiveNowCard({ notice }: { notice: PublishedLiveNotice }): React.JSX.Element {
  const [failed, setFailed] = useState(false);
  const [retryToken, setRetryToken] = useState(0);

  const youtubeUrl = getLiveFallbackYoutubeUrl();
  const supportTelHref = getSupportTelHref();

  return (
    <View style={[styles.card, styles.liveCard]}>
      <View style={styles.cardHeader}>
        <Badge label={SLOT_KIND_LABEL.live} tone={SLOT_KIND_TONE.live} />
        <Text style={styles.liveNowLabel}>지금 방송 중</Text>
      </View>
      <Text style={styles.cardTitle}>{notice.title ?? '제주방송센터 생방송'}</Text>
      {failed ? (
        // 재생 실패 폴백은 라이브 상세(app/live/[id].tsx)와 동일한 판정 함수를 쓴다 —
        // "다시 시도"는 env 설정과 무관하게 항상 눌린다(죽은 화면 금지).
        <PlaybackFallback
          message={resolvePlaybackFallbackMessage(
            resolveLiveFallbackButtons({ youtubeUrl, supportTelHref }).length,
          )}
          actions={resolveLiveFallbackButtons({ youtubeUrl, supportTelHref }).map((button) => {
            if (button.key === 'retry') {
              return {
                label: button.label,
                onPress: () => {
                  setFailed(false);
                  setRetryToken((n) => n + 1);
                },
              };
            }
            if (button.key === 'youtube') {
              return {
                label: button.label,
                onPress: () => void Linking.openURL(youtubeUrl as string),
              };
            }
            return {
              label: button.label,
              onPress: () => void Linking.openURL(supportTelHref as string),
            };
          })}
        />
      ) : (
        <HlsVideo
          key={retryToken}
          sourceUrl={notice.hlsUrl}
          onFatalError={() => setFailed(true)}
        />
      )}
    </View>
  );
}

/** 게시된 생방송이 없을 때 — 가짜 재생 버튼을 두지 않고 "다음 방송"만 알려준다 */
function NoLiveCard({
  upcoming,
}: {
  upcoming: ReturnType<typeof nextLive>;
}): React.JSX.Element {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>지금 진행 중인 생방송이 없습니다</Text>
      {upcoming ? (
        <Text style={styles.cardBody}>
          {`다음 생방송은 ${formatDaysAhead(upcoming.daysAhead)}(${upcoming.slot.dayLabel}) ${upcoming.slot.title}입니다.`}
        </Text>
      ) : null}
      <Text style={styles.cardHint}>방송이 시작되면 이 자리에서 바로 보실 수 있습니다.</Text>
    </View>
  );
}

function SlotRow({ slot, today }: { slot: ScheduleSlot; today: boolean }): React.JSX.Element {
  return (
    <View style={[styles.row, today ? styles.rowToday : null]}>
      <View style={styles.rowHeader}>
        <Text style={styles.rowDay}>{slot.dayLabel}</Text>
        {today ? <Text style={styles.todayTag}>오늘</Text> : null}
        <Badge label={SLOT_KIND_LABEL[slot.kind]} tone={SLOT_KIND_TONE[slot.kind]} />
      </View>
      <Text style={styles.rowTitle}>{slot.title}</Text>
      <Text style={styles.rowDetail}>{slot.detail}</Text>
      {slot.durationLabel ? <Text style={styles.rowMeta}>{slot.durationLabel}</Text> : null}
      {slot.simulcastLabel ? <Text style={styles.rowMeta}>{slot.simulcastLabel}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // RNW의 ScrollView는 contentContainer가 기본 flexGrow:1·flexShrink:1이라(대장 #93) 자식이
  // 눌려 보인다 — 다른 화면과 동일하게 flexGrow만 명시하고 세로 여백은 padding으로 준다.
  content: { padding: spacing.lg, paddingBottom: spacing.xl, flexGrow: 1, gap: spacing.md },
  pageTitle: { fontSize: typo.title, fontWeight: '700', color: colors.text },
  pageSubtitle: { fontSize: typo.body, color: colors.textMuted },
  sectionTitle: {
    fontSize: typo.body,
    fontWeight: '700',
    color: colors.text,
    marginTop: spacing.md,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  liveCard: { borderColor: colors.danger, borderWidth: 2 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  liveNowLabel: { fontSize: typo.body, fontWeight: '700', color: colors.danger },
  cardTitle: { fontSize: typo.body, fontWeight: '700', color: colors.text },
  cardBody: { fontSize: typo.body, color: colors.text },
  cardHint: { fontSize: typo.caption, color: colors.textMuted },
  row: {
    backgroundColor: colors.card,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  rowToday: { borderColor: colors.primary, borderWidth: 2 },
  rowHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rowDay: { fontSize: typo.body, fontWeight: '700', color: colors.text },
  todayTag: { fontSize: typo.caption, fontWeight: '700', color: colors.primary },
  rowTitle: { fontSize: typo.body, color: colors.text },
  rowDetail: { fontSize: typo.caption, color: colors.textMuted },
  rowMeta: { fontSize: typo.caption, color: colors.textMuted },
  notice: {
    marginTop: spacing.md,
    padding: spacing.lg,
    borderRadius: radii.md,
    backgroundColor: '#EFEFF1',
    gap: spacing.xs,
  },
  noticeText: { fontSize: typo.caption, color: colors.textMuted },
});
