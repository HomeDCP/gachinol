import {
  ContentStatus,
  canTransitionContent,
  isCaptionEditableStatus,
  toId,
} from '@gachinol/shared';
import type { ReporterActions } from '../actions';
import type { UserId } from '@gachinol/shared';
import { reporterActionsFor } from '../actions';

/**
 * 자막 보강(T-W2-34)을 뺀 나머지 액션 — "비담당은 아무것도 못 한다"를 계속 고정하기 위한 헬퍼.
 * `canEditCaptions`만 `mine`을 요구하지 않으므로 그 축은 전용 describe에서 따로 본다.
 */
const withoutCaptions = (a: ReporterActions): Omit<ReporterActions, 'canEditCaptions'> => {
  const { canEditCaptions: _ignored, ...rest } = a;
  return rest;
};

const ME = toId<UserId>('user-me');
const OTHER = toId<UserId>('user-other');

const mine = (status: ContentStatus) => ({ status, reporterId: ME });
const theirs = (status: ContentStatus) => ({ status, reporterId: OTHER });

describe('reporterActionsFor', () => {
  test('담당 + awaiting_reporter_review → canReview·canCancel', () => {
    const a = reporterActionsFor(mine('awaiting_reporter_review'), ME);
    expect(a).toEqual({
      canEdit: false,
      canStartMockUpload: false,
      canRetryUpload: false,
      canReview: true,
      canCancel: true,
      canEditCaptions: true, // 자막은 published 전까지 언제든 (T-W2-34)
      canRegenerate: false, // awaiting_reporter_review에서는 regenerating으로 갈 수 없다
    });
  });

  /* ★ 다시 만들기 (대장 #98) — 수정요청과 자동 연쇄하지 않으므로 이 버튼이 유일한 진행 수단이다.
   * 상태 판정의 원천은 shared 전이 맵이고, 담당 기자만 누를 수 있다(서버 policyGuard와 동일). */
  test('담당 + revision_requested → canRegenerate·canEdit (고치고 나서 다시 만든다)', () => {
    const a = reporterActionsFor(mine('revision_requested'), ME);
    expect(a.canRegenerate).toBe(true);
    expect(a.canEdit).toBe(true); // 초안 수정 기회가 함께 열려 있어야 순서가 성립한다
  });

  test('revision_requested 외에는 canRegenerate가 열리지 않는다 (전이 맵 파생)', () => {
    for (const status of Object.values(ContentStatus)) {
      if (status === 'revision_requested' || status === 'regeneration_failed') continue;
      expect(reporterActionsFor(mine(status), ME).canRegenerate).toBe(false);
    }
  });

  test('비담당은 자막 보강 외 전부 false (지사 동료·live_vod는 열람만)', () => {
    for (const status of Object.values(ContentStatus)) {
      const a = reporterActionsFor(theirs(status), ME);
      expect(Object.values(withoutCaptions(a)).every((v) => v === false)).toBe(true);
    }
    // live_vod: reporterId=null
    const a = reporterActionsFor({ status: 'awaiting_reporter_review', reporterId: null }, ME);
    expect(Object.values(withoutCaptions(a)).every((v) => v === false)).toBe(true);
  });

  test('upload_failed → canRetryUpload (기자 유일 재시도 권한)', () => {
    const a = reporterActionsFor(mine('upload_failed'), ME);
    expect(a.canRetryUpload).toBe(true);
    expect(a.canReview).toBe(false);
    // 그 외 실패 상태는 재시도 불가 (센터 몫)
    expect(reporterActionsFor(mine('processing_failed'), ME).canRetryUpload).toBe(false);
    expect(reporterActionsFor(mine('publish_failed'), ME).canRetryUpload).toBe(false);
  });

  test('revision_requested → canEdit / draft → canEdit + canStartMockUpload', () => {
    expect(reporterActionsFor(mine('revision_requested'), ME).canEdit).toBe(true);
    expect(reporterActionsFor(mine('revision_requested'), ME).canStartMockUpload).toBe(false);
    const draft = reporterActionsFor(mine('draft'), ME);
    expect(draft.canEdit).toBe(true);
    expect(draft.canStartMockUpload).toBe(true);
  });

  test('awaiting_center_review → 자막 보강 외 전부 false (canceled 출구 없음)', () => {
    const a = reporterActionsFor(mine('awaiting_center_review'), ME);
    expect(Object.values(withoutCaptions(a)).every((v) => v === false)).toBe(true);
  });

  test('종결 3종 전부 false (자막 보강 포함 — 채워도 반영할 곳이 없다)', () => {
    for (const status of ['rejected', 'canceled', 'archived'] as const) {
      const a = reporterActionsFor(mine(status), ME);
      expect(Object.values(a).every((v) => v === false)).toBe(true);
    }
  });

  test('canCancel — shared canTransitionContent 결과와 전 상태 일치 (맵 순회)', () => {
    for (const status of Object.values(ContentStatus)) {
      expect(reporterActionsFor(mine(status), ME).canCancel).toBe(
        canTransitionContent(status, ContentStatus.Canceled),
      );
    }
  });
});

/**
 * ★ 자막 보강만 액터 규칙이 다르다 (T-W2-34, 대장 #123 · 정본 03 §C-4).
 * 간단 모드의 존재 이유가 "촬영자에게서 자막 부담을 걷어내는 것"이라, 이 액션까지 소유 기자로
 * 좁히면 자막을 채울 사람이 다시 촬영자밖에 없어진다.
 */
describe('reporterActionsFor — canEditCaptions', () => {
  test('담당이 아니어도 열린다 — 이 파일에서 유일하게 mine을 요구하지 않는 액션', () => {
    expect(reporterActionsFor(theirs('awaiting_reporter_review'), ME).canEditCaptions).toBe(true);
    // 주민 제보(reporterId=null)도 마찬가지 — 자막을 채울 담당 기자가 애초에 없다
    expect(
      reporterActionsFor({ status: 'uploaded', reporterId: null }, ME).canEditCaptions,
    ).toBe(true);
  });

  test('published 이후·종결은 닫힌다', () => {
    for (const status of ['published', 'rejected', 'canceled', 'archived'] as const) {
      expect(reporterActionsFor(mine(status), ME).canEditCaptions).toBe(false);
      expect(reporterActionsFor(theirs(status), ME).canEditCaptions).toBe(false);
    }
  });

  test('판정은 shared 술어와 전 상태 일치 (사본 금지 — 맵 순회)', () => {
    for (const status of Object.values(ContentStatus)) {
      expect(reporterActionsFor(theirs(status), ME).canEditCaptions).toBe(
        isCaptionEditableStatus(status),
      );
    }
  });
});
