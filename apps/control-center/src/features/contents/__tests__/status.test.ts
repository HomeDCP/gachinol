import {
  AUTO_PROGRESS_CONTENT_STATUSES,
  ContentStatus,
  isMinorConsentPending,
  isStalledAutomationContentStatus,
  ProgramCategory,
  SYSTEM_DRIVEN_CONTENT_STATUSES,
} from '@gachinol/shared';
import { CATEGORY_LABEL } from '../labels';
import {
  AUTO_PROGRESS_STATUSES,
  STATUS_DESCRIPTION_CENTER,
  TERMINAL_STATUSES,
  isAutoProgressStatus,
  minorConsentBadge,
  needsCenterAttention,
  statusBadge,
} from '../status';

describe('STATUS_BADGE_CENTER — 23종 전수', () => {
  const all = Object.values(ContentStatus);

  test('상태 23종', () => {
    expect(all).toHaveLength(23);
  });

  test.each(all)('%s — 라벨·톤·설명 존재·비어있지 않음', (status) => {
    expect(statusBadge(status).label.length).toBeGreaterThan(0);
    expect(statusBadge(status).tone.length).toBeGreaterThan(0);
    expect(STATUS_DESCRIPTION_CENTER[status].length).toBeGreaterThan(0);
  });

  test('needsCenterAction 정확히 9종 (awaiting_center_review + 6 *_failed + revision_requested·regenerating, 대장 #98 보강)', () => {
    const flagged = all.filter((s) => statusBadge(s).needsCenterAction === true).sort();
    expect(flagged).toEqual(
      [
        'awaiting_center_review',
        'upload_failed',
        'processing_failed',
        'analysis_failed',
        'preview_failed',
        'regeneration_failed',
        'publish_failed',
        'revision_requested',
        'regenerating',
      ].sort(),
    );
  });
});

/**
 * 대장 #98 — revision_requested UI가 하던 거짓 약속("기자의 반영을 기다리고 있습니다" — auto_edit
 * 미구현이라 기자가 반영해도 아무 일도 안 일어난다)을 걷어내는 회귀 방지. 옛 문구로는 반드시 실패한다.
 */
describe('revision_requested — 센터 문구가 실제로 해야 하는 일을 말한다 (대장 #98)', () => {
  test('"기자의 반영을 기다리고 있습니다"를 더 이상 주장하지 않는다', () => {
    expect(STATUS_DESCRIPTION_CENTER.revision_requested).not.toContain(
      '기자의 반영을 기다리고 있습니다',
    );
  });

  test('센터의 실제 조치(수동 전이·취소)를 언급한다', () => {
    const desc = STATUS_DESCRIPTION_CENTER.revision_requested;
    expect(desc).toMatch(/전이|취소/);
  });
});

/**
 * regenerating — 대장 #98의 관제 수동 전이로 처음 도달 가능해진 상태.
 * 기존 'progress'(진행 중) 라벨·문구는 auto_edit 부재 상태에서 거짓이었다.
 *
 * T-W2-22(EXEC-DECISIONS #29 ④)부터 이 판정은 **사람이 쓴 값이 아니라 shared NOT_WIRED 파생**이다.
 * 그래서 아래 테스트들은 상태 이름을 단정하지 않고 **레지스트리와 UI의 관계**를 고정한다 —
 * auto_edit이 구현돼 regenerating이 정지 집합에서 빠져도 그대로 통과한다(갱신 불요).
 */
describe('정지 상태 — 레지스트리 파생 판정을 UI가 그대로 따른다 (대장 #98 → #29 ④)', () => {
  test('정지로 판정된 상태는 progress 톤·15s 폴링을 쓰지 않는다', () => {
    for (const status of SYSTEM_DRIVEN_CONTENT_STATUSES) {
      if (!isStalledAutomationContentStatus(status)) continue;
      expect(statusBadge(status).tone).not.toBe('progress');
      expect(isAutoProgressStatus(status)).toBe(false);
    }
  });

  /**
   * 대장 #98 보강 — 판정: 정지 상태는 needsCenterAction=true.
   * "조치 필요" 강조는 "앱에 버튼이 있다"는 뜻이 아니라 "사람이 인지해야 한다"는 뜻이다.
   * 앱 내 탈출구가 아예 없는 상태라 강조하지 않으면 아무도 발견하지 못한 채 영구히 묻힌다.
   */
  test('정지로 판정된 상태는 보드에서 발견 가능해야 한다 (needsCenterAction)', () => {
    for (const status of SYSTEM_DRIVEN_CONTENT_STATUSES) {
      if (!isStalledAutomationContentStatus(status)) continue;
      expect(statusBadge(status).needsCenterAction).toBe(true);
    }
  });

  test('정지가 아닌 시스템 구동 상태는 전부 15s 폴링 대상이다', () => {
    for (const status of SYSTEM_DRIVEN_CONTENT_STATUSES) {
      if (isStalledAutomationContentStatus(status)) continue;
      expect(isAutoProgressStatus(status)).toBe(true);
    }
  });

  test('설명이 "생성하고 있습니다"(진행 단정)를 주장하지 않는다', () => {
    expect(STATUS_DESCRIPTION_CENTER.regenerating).not.toMatch(/생성하고 있습니다/);
  });
});

/**
 * AUTO_PROGRESS_STATUSES — 목록도 제외 규칙도 앱에 없다(#29 ④). shared 파생과 동일해야 하고,
 * "실제로 워커·큐가 진행시키는" 7종(대장 #98 보강 지시: regenerating 외 항목 변경 금지)이
 * 여전히 전부 포함돼야 한다. 옛 하드코딩 목록으로는 파생 동치 단정이 성립하지 않는다.
 */
describe('AUTO_PROGRESS_STATUSES — 레지스트리 파생 (대장 #98 보강 → #29 ④)', () => {
  test('shared 파생 목록과 정확히 동일 — 기자 앱과 원천을 공유해 어긋날 수 없다', () => {
    expect([...AUTO_PROGRESS_STATUSES]).toEqual([...AUTO_PROGRESS_CONTENT_STATUSES]);
  });

  test('워커·큐가 진행시키는 7종은 그대로 남는다', () => {
    const rest = [
      'uploading',
      'uploaded',
      'processing',
      'analyzing',
      'preview_generating',
      'publishing',
      'reporter_approved',
    ] as const;
    for (const status of rest) {
      expect(isAutoProgressStatus(status)).toBe(true);
    }
  });

  test('정지 상태와 교집합이 없다', () => {
    expect(AUTO_PROGRESS_STATUSES.filter((s) => isStalledAutomationContentStatus(s))).toEqual([]);
  });
});

/**
 * 미성년자 동의 게이트 배지 (T-W2-27, 대장 #118).
 * 이 축이 없으면 `reviewPolicy='reporter_only'` 콘텐츠는 `awaiting_reporter_review`("기자 확인
 * 대기" = 센터는 대기)로만 보여서, 승인이 차단돼 있다는 사실이 화면 어디에도 나타나지 않는다.
 */
describe('minorConsentBadge — 상태와 직교한 게이트 축', () => {
  const item = (
    over: Partial<{
      status: ContentStatus;
      hasMinorSubject: boolean;
      minorConsentConfirmedAt: string | null;
    }> = {},
  ) => ({
    status: 'awaiting_reporter_review' as ContentStatus,
    hasMinorSubject: false,
    minorConsentConfirmedAt: null as string | null,
    ...over,
  });

  test('플래그가 꺼져 있으면 배지 없음 (대다수 콘텐츠는 이 축과 무관)', () => {
    expect(minorConsentBadge(item())).toBeUndefined();
  });

  test('플래그 ON + 미확인 → "동의 확인 대기" · 조치 필요', () => {
    const badge = minorConsentBadge(item({ hasMinorSubject: true }));
    expect(badge?.label).toBe('동의 확인 대기');
    expect(badge?.needsCenterAction).toBe(true);
  });

  test('플래그 ON + 확인 완료 → 조치 필요 아님', () => {
    const badge = minorConsentBadge(
      item({ hasMinorSubject: true, minorConsentConfirmedAt: '2026-08-10T00:00:00.000Z' }),
    );
    expect(badge?.label).toBe('동의 확인 완료');
    expect(badge?.needsCenterAction).toBeUndefined();
  });

  test('판정은 shared isMinorConsentPending과 동치 — 사본 조건 금지', () => {
    for (const hasMinorSubject of [true, false]) {
      for (const at of [null, '2026-08-10T00:00:00.000Z']) {
        const target = item({ hasMinorSubject, minorConsentConfirmedAt: at });
        // 종결이 아닌 status에서는 두 판정이 정확히 일치해야 한다
        expect(minorConsentBadge(target)?.needsCenterAction === true).toBe(
          isMinorConsentPending(target),
        );
      }
    }
  });

  test.each(TERMINAL_STATUSES)(
    '%s(종결)는 사실 배지는 남기되 조치 필요로 올리지 않는다 (대기열 오염 방지)',
    (status) => {
      const badge = minorConsentBadge(item({ status, hasMinorSubject: true }));
      expect(badge).toBeDefined();
      expect(badge?.needsCenterAction).toBeUndefined();
    },
  );
});

describe('needsCenterAttention — 상태 축 ∪ 동의 게이트 축', () => {
  const base = { hasMinorSubject: false, minorConsentConfirmedAt: null };

  test('센터 검토 대기는 게이트와 무관하게 조치 필요 (기존 동작 무회귀)', () => {
    expect(needsCenterAttention({ ...base, status: 'awaiting_center_review' })).toBe(true);
  });

  test('기자 확인 대기는 원래 조치 필요가 아니다', () => {
    expect(needsCenterAttention({ ...base, status: 'awaiting_reporter_review' })).toBe(false);
  });

  test('★ 기자 확인 대기 + 동의 미확인 → 조치 필요 (reporter_only 교착의 유일한 신호)', () => {
    expect(
      needsCenterAttention({
        status: 'awaiting_reporter_review',
        hasMinorSubject: true,
        minorConsentConfirmedAt: null,
      }),
    ).toBe(true);
  });

  test('동의 확인이 끝나면 다시 조치 필요가 아니다', () => {
    expect(
      needsCenterAttention({
        status: 'awaiting_reporter_review',
        hasMinorSubject: true,
        minorConsentConfirmedAt: '2026-08-10T00:00:00.000Z',
      }),
    ).toBe(false);
  });
});

describe('CATEGORY_LABEL — 6종 전수', () => {
  test.each(Object.values(ProgramCategory))('%s 라벨 존재', (category) => {
    expect(CATEGORY_LABEL[category].length).toBeGreaterThan(0);
  });
});
