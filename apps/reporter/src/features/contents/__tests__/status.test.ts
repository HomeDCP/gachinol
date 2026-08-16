import {
  AUTO_PROGRESS_CONTENT_STATUSES,
  ContentStatus,
  isStalledAutomationContentStatus,
  SYSTEM_DRIVEN_CONTENT_STATUSES,
} from '@gachinol/shared';
import {
  AUTO_PROGRESS_STATUSES,
  STATUS_DESCRIPTION,
  isAutoProgressStatus,
  statusBadge,
} from '../status';

describe('STATUS_BADGE — 23종 전수', () => {
  const all = Object.values(ContentStatus);

  test('상태 23종', () => {
    expect(all).toHaveLength(23);
  });

  test.each(all)('%s — 라벨·설명 존재·비어있지 않음', (status) => {
    expect(statusBadge(status).label.length).toBeGreaterThan(0);
    expect(statusBadge(status).tone.length).toBeGreaterThan(0);
    expect(STATUS_DESCRIPTION[status].length).toBeGreaterThan(0);
  });

  test('needsMyAction 정확히 3종 (upload_failed·awaiting_reporter_review·revision_requested)', () => {
    const flagged = all.filter((s) => statusBadge(s).needsMyAction === true).sort();
    expect(flagged).toEqual(
      ['awaiting_reporter_review', 'revision_requested', 'upload_failed'].sort(),
    );
  });
});

/**
 * 대장 #98 — revision_requested UI가 하던 거짓 약속(auto_edit 미구현인데 "반영 후 재생성됩니다")을
 * 걷어내는 회귀 방지. 이 두 테스트는 옛 문구로는 반드시 실패한다(항상 통과하는 테스트가 아니다).
 */
describe('revision_requested — 거짓 약속 제거 (대장 #98)', () => {
  test('자동 재생성을 약속하지 않는다', () => {
    const desc = STATUS_DESCRIPTION.revision_requested;
    // 옛 문구 "초안을 수정하면 반영 후 재생성됩니다"의 핵심 주장(수정→자동 재생성)을 부정
    expect(desc).not.toMatch(/수정하면.*재생성됩니다/);
    expect(desc).not.toMatch(/반영 후 재생성/);
  });

  test('진행 주체(센터)를 명시한다 — 기자 혼자 끝나는 일이 아님을 알린다', () => {
    expect(STATUS_DESCRIPTION.revision_requested).toContain('센터');
  });

  test('needsMyAction=true는 유지 — 초안 수정(EDITABLE_STATUSES)이라는 실제 조치가 있다', () => {
    expect(statusBadge('revision_requested').needsMyAction).toBe(true);
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

  test('정지가 아닌 시스템 구동 상태는 전부 15s 폴링 대상이다', () => {
    for (const status of SYSTEM_DRIVEN_CONTENT_STATUSES) {
      if (isStalledAutomationContentStatus(status)) continue;
      expect(isAutoProgressStatus(status)).toBe(true);
    }
  });

  test('설명이 "생성하고 있습니다"(진행 단정)를 주장하지 않는다', () => {
    expect(STATUS_DESCRIPTION.regenerating).not.toMatch(/생성하고 있습니다/);
  });
});

/**
 * AUTO_PROGRESS_STATUSES — 목록도 제외 규칙도 앱에 없다(#29 ④). shared 파생과 동일해야 하고,
 * "실제로 워커·큐가 진행시키는" 7종(대장 #98 보강 지시: regenerating 외 항목 변경 금지)이
 * 여전히 전부 포함돼야 한다. 옛 하드코딩 목록으로는 파생 동치 단정이 성립하지 않는다.
 */
describe('AUTO_PROGRESS_STATUSES — 레지스트리 파생 (대장 #98 보강 → #29 ④)', () => {
  test('shared 파생 목록과 정확히 동일 (앱 사본 0)', () => {
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
