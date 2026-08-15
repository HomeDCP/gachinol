import { ContentStatus, ProgramCategory } from '@gachinol/shared';
import { CATEGORY_LABEL } from '../labels';
import { STATUS_DESCRIPTION_CENTER, isAutoProgressStatus, statusBadge } from '../status';

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
 */
describe('regenerating — 자동 진행을 약속하지 않는다 (대장 #98)', () => {
  test('배지 톤이 progress가 아니다', () => {
    expect(statusBadge('regenerating').tone).not.toBe('progress');
  });

  test('설명이 "생성하고 있습니다"(진행 단정)를 주장하지 않는다', () => {
    expect(STATUS_DESCRIPTION_CENTER.regenerating).not.toMatch(/생성하고 있습니다/);
  });

  /**
   * 대장 #98 보강 — 게이트②가 잡은 4건 중 1번(가장 중요). regenerating을 진행시키는 코드가
   * 없는데(auto_edit 미구현) AUTO_PROGRESS_STATUSES에 남아 있으면 상세 화면이 15s마다 영원히
   * 폴링만 한다. 옛 코드로는 반드시 실패한다.
   */
  test('isAutoProgressStatus(regenerating) === false — 15s 무한 폴링 금지', () => {
    expect(isAutoProgressStatus('regenerating')).toBe(false);
  });

  /**
   * 대장 #98 보강 — 게이트②가 잡은 4건 중 2번. 판정: needsCenterAction=true를 유지한다.
   * "조치 필요" 강조는 "앱에 버튼이 있다"는 뜻이 아니라 "사람이 인지해야 한다"는 뜻으로 판정했다
   * (근거는 위 헤더 주석·완료 보고). regenerating은 앱 내 탈출구가 아예 없는 상태라 강조하지
   * 않으면 아무도 발견하지 못한 채 영구히 묻힌다.
   */
  test('needsCenterAction=true 유지 — 앱 내 탈출구가 없어도 보드에서 발견 가능해야 한다', () => {
    expect(statusBadge('regenerating').needsCenterAction).toBe(true);
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

describe('CATEGORY_LABEL — 6종 전수', () => {
  test.each(Object.values(ProgramCategory))('%s 라벨 존재', (category) => {
    expect(CATEGORY_LABEL[category].length).toBeGreaterThan(0);
  });
});
