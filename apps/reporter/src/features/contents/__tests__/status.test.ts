import { ContentStatus } from '@gachinol/shared';
import { STATUS_DESCRIPTION, isAutoProgressStatus, statusBadge } from '../status';

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
 */
describe('regenerating — 자동 진행을 약속하지 않는다 (대장 #98)', () => {
  test('배지 톤이 progress가 아니다', () => {
    expect(statusBadge('regenerating').tone).not.toBe('progress');
  });

  test('설명이 "생성하고 있습니다"(진행 단정)를 주장하지 않는다', () => {
    expect(STATUS_DESCRIPTION.regenerating).not.toMatch(/생성하고 있습니다/);
  });

  /**
   * 대장 #98 보강 — 게이트②가 잡은 4건 중 1번(가장 중요). regenerating을 진행시키는 코드가
   * 없는데(auto_edit 미구현) AUTO_PROGRESS_STATUSES에 남아 있으면 상세 화면이 15s마다 영원히
   * 폴링만 한다 — 문구에서 걷어낸 거짓 약속이 코드로 자리를 옮긴 것. 옛 코드로는 반드시 실패한다.
   */
  test('isAutoProgressStatus(regenerating) === false — 15s 무한 폴링 금지', () => {
    expect(isAutoProgressStatus('regenerating')).toBe(false);
  });
});

/**
 * AUTO_PROGRESS_STATUSES — regenerating 제외 외 나머지 7종은 무변경(대장 #98 보강 지시:
 * "regenerating 외 항목 변경 금지"). 이 테스트가 그 항목들의 회귀를 잡는다.
 */
describe('AUTO_PROGRESS_STATUSES — regenerating만 빠지고 나머지는 그대로 (대장 #98 보강)', () => {
  test('실제로 워커·큐가 진행시키는 7종만 남는다', () => {
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
    expect(isAutoProgressStatus('regenerating')).toBe(false);
  });
});
