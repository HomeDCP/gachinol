import { ResidentUploadStatus } from '@gachinol/shared';
import { ApiClientError, ApiNetworkError } from '../../api/errors';
import {
  checkSelectedVideo,
  CONTACT_PURPOSE_NOTICE,
  formatMegabytes,
  formatRemainingTime,
  formatRemainingUploads,
  LEGAL_CONSENT_TEXT,
  normalizeToken,
  resolveResidentLinkGate,
  resolveUploadDoneNotice,
  resolveUploadErrorMessage,
  REVIEW_GATE_NOTICE,
  shouldCollectConsent,
  SIMPLE_MODE_NOTICE,
} from '../gate';
import type { ResidentLinkPublicView } from '../resident-link-api';

/**
 * 주민 업로드 화면의 **판정** 고정 — T-W2-09.
 *
 * 화면은 이 함수들의 결과를 렌더만 하므로, 여기서 고정한 불변식이 곧 화면의 보증이다.
 */

const view = (over: Partial<ResidentLinkPublicView> = {}): ResidentLinkPublicView => ({
  valid: true,
  stationName: '애월 마을방송국',
  expiresAt: '2026-08-20T00:00:00.000Z',
  maxUploads: 5,
  remainingUploads: 5,
  maxFileSizeBytes: 524_288_000,
  ...over,
});

const ready = (over: Partial<ResidentLinkPublicView> = {}) =>
  resolveResidentLinkGate({ token: 'abc', isPending: false, error: null, view: view(over) });

describe('resolveResidentLinkGate — 토큰·링크 상태 판정', () => {
  it('토큰이 없으면 서버를 묻지 않고 missing_token', () => {
    expect(
      resolveResidentLinkGate({ token: undefined, isPending: true, error: null, view: undefined })
        .kind,
    ).toBe('missing_token');
    expect(
      resolveResidentLinkGate({ token: '   ', isPending: true, error: null, view: undefined }).kind,
    ).toBe('missing_token');
  });

  it('조회 중에는 loading', () => {
    expect(
      resolveResidentLinkGate({ token: 'abc', isPending: true, error: null, view: undefined }).kind,
    ).toBe('loading');
  });

  it('404는 unknown_link — 만료·소진과 구분된다(안내 문구가 달라야 한다)', () => {
    const gate = resolveResidentLinkGate({
      token: 'abc',
      isPending: false,
      error: new ApiClientError(404, { code: 'not_found', message: '유효하지 않은 링크입니다' }),
      view: undefined,
    });
    expect(gate.kind).toBe('unknown_link');
    expect(gate.retryable).toBe(false);
  });

  it('네트워크 실패는 error이며 재시도 가능', () => {
    const gate = resolveResidentLinkGate({
      token: 'abc',
      isPending: false,
      error: new ApiNetworkError(),
      view: undefined,
    });
    expect(gate.kind).toBe('error');
    expect(gate.retryable).toBe(true);
  });

  it('valid=false + reason=expired → expired', () => {
    const gate = resolveResidentLinkGate({
      token: 'abc',
      isPending: false,
      error: null,
      view: view({ valid: false, reason: 'expired' }),
    });
    expect(gate.kind).toBe('expired');
  });

  it('valid=false + reason=exhausted → exhausted', () => {
    const gate = resolveResidentLinkGate({
      token: 'abc',
      isPending: false,
      error: null,
      view: view({ valid: false, reason: 'exhausted', remainingUploads: 0 }),
    });
    expect(gate.kind).toBe('exhausted');
  });

  it('valid=false인데 사유가 없으면 사용 가능으로 열지 않는다(fail-closed)', () => {
    const gate = resolveResidentLinkGate({
      token: 'abc',
      isPending: false,
      error: null,
      view: view({ valid: false }),
    });
    expect(gate.kind).toBe('unknown_link');
    expect(gate.view).toBeNull();
  });

  it('ready에서만 링크 정보가 노출된다 — 그 외 분기의 view는 항상 null', () => {
    expect(ready().view).toEqual(view());
    const notReady = [
      resolveResidentLinkGate({ token: '', isPending: false, error: null, view: view() }),
      resolveResidentLinkGate({
        token: 'abc',
        isPending: false,
        error: null,
        view: view({ valid: false, reason: 'expired' }),
      }),
      resolveResidentLinkGate({
        token: 'abc',
        isPending: false,
        error: new ApiNetworkError(),
        view: view(),
      }),
    ];
    notReady.forEach((gate) => expect(gate.view).toBeNull());
  });

  it('ready 안내 본문이 검수 게이트 고지를 담는다', () => {
    expect(ready().body).toBe(REVIEW_GATE_NOTICE);
  });

  it('만료·소진·미존재 안내는 전부 "새 링크를 요청"으로 끝난다(막다른 화면 금지)', () => {
    (['expired', 'exhausted', 'unknown_link'] as const).forEach((kind) => {
      const gate =
        kind === 'unknown_link'
          ? resolveResidentLinkGate({
              token: 'abc',
              isPending: false,
              error: new ApiClientError(404, { code: 'not_found', message: '' }),
              view: undefined,
            })
          : resolveResidentLinkGate({
              token: 'abc',
              isPending: false,
              error: null,
              view: view({ valid: false, reason: kind }),
            });
      expect(gate.body).toContain('새 링크를 요청');
    });
  });
});

describe('normalizeToken', () => {
  it('배열이면 첫 값을 쓴다(expo-router 중복 파라미터)', () => {
    expect(normalizeToken(['t1', 't2'])).toBe('t1');
  });
  it('undefined·빈 문자열은 null', () => {
    expect(normalizeToken(undefined)).toBeNull();
    expect(normalizeToken('')).toBeNull();
  });
});

describe('checkSelectedVideo — 상한값은 서버 응답에서만 온다', () => {
  const max = 524_288_000;

  it('동영상이 아니면 거절', () => {
    const r = checkSelectedVideo({ name: 'a.jpg', mimeType: 'image/jpeg', sizeBytes: 10 }, max);
    expect(r.ok).toBe(false);
  });

  it('0바이트는 거절', () => {
    expect(checkSelectedVideo({ name: 'a.mp4', mimeType: 'video/mp4', sizeBytes: 0 }, max).ok).toBe(
      false,
    );
  });

  it('상한 초과는 거절하고, 안내 문구의 상한은 인자 값에서 계산된다', () => {
    const r = checkSelectedVideo({ name: 'a.mp4', mimeType: 'video/mp4', sizeBytes: max + 1 }, max);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('500MB');
    // 서버가 상한을 100MB로 바꾸면 화면 문구도 따라간다(상수 사본이 없다는 증명)
    const other = checkSelectedVideo(
      { name: 'a.mp4', mimeType: 'video/mp4', sizeBytes: 200 * 1024 * 1024 },
      100 * 1024 * 1024,
    );
    expect(other.ok).toBe(false);
    if (!other.ok) expect(other.message).toContain('100MB');
  });

  it('상한 이하 동영상은 통과', () => {
    expect(
      checkSelectedVideo({ name: 'a.mp4', mimeType: 'video/mp4', sizeBytes: max }, max).ok,
    ).toBe(true);
  });
});

describe('표시 형식', () => {
  it('formatMegabytes', () => {
    expect(formatMegabytes(524_288_000)).toBe('500MB');
    expect(formatMegabytes(2 * 1024 ** 3)).toBe('2.0GB');
    expect(formatMegabytes(0)).toBe('0MB');
  });

  it('formatRemainingUploads', () => {
    expect(formatRemainingUploads(5, 5)).toBe('5번 중 5번 더 올릴 수 있습니다');
    expect(formatRemainingUploads(0, 5)).toBe('5번을 모두 사용했습니다');
  });

  it('formatRemainingTime — now를 주입받아 기기 시계에 의존하지 않는다', () => {
    const now = new Date('2026-08-17T00:00:00.000Z');
    expect(formatRemainingTime('2026-08-20T00:00:00.000Z', now)).toBe('3일 남았습니다');
    expect(formatRemainingTime('2026-08-17T05:00:00.000Z', now)).toBe('5시간 남았습니다');
    expect(formatRemainingTime('2026-08-17T00:30:00.000Z', now)).toBe('곧 사용 기간이 끝납니다');
    expect(formatRemainingTime('2026-08-16T00:00:00.000Z', now)).toBe('사용 기간이 지났습니다');
  });
});

describe('resolveUploadErrorMessage — 429는 상태 코드로만 판정한다', () => {
  it('서버 레이트리밋 응답은 code가 internal이라 코드 기반 판정이 성립하지 않는다', () => {
    // 2026-08-17 실측: 11번째 시도 → HTTP 429 {"code":"internal","message":"업로드 시도가 너무 많습니다…"}
    const err = new ApiClientError(429, {
      code: 'internal',
      message: '업로드 시도가 너무 많습니다. 약 6분 후 다시 시도해주세요.',
    });
    expect(resolveUploadErrorMessage(err)).toContain('업로드 시도가 너무 많습니다');
  });

  it('403(만료·소진·용량 초과)은 서버 한국어 메시지를 그대로 쓴다', () => {
    const err = new ApiClientError(403, {
      code: 'forbidden',
      message: '파일 1건은 500MB를 넘을 수 없습니다',
    });
    expect(resolveUploadErrorMessage(err)).toBe('파일 1건은 500MB를 넘을 수 없습니다');
  });

  it('네트워크 실패는 연결 안내', () => {
    expect(resolveUploadErrorMessage(new ApiNetworkError())).toContain('인터넷 연결');
  });
});

describe('resolveUploadDoneNotice', () => {
  it('awaiting_branch_review여야 성공이라고 말한다 + 검수 게이트를 다시 알린다', () => {
    const n = resolveUploadDoneNotice({
      status: ResidentUploadStatus.AwaitingBranchReview,
      remainingUploads: 3,
    });
    expect(n.title).toBe('잘 올라갔습니다');
    expect(n.body).toContain(REVIEW_GATE_NOTICE);
    expect(n.canUploadMore).toBe(true);
  });

  it('남은 횟수가 0이면 재업로드를 열지 않는다(재업로드 차단 안내)', () => {
    const n = resolveUploadDoneNotice({
      status: ResidentUploadStatus.AwaitingBranchReview,
      remainingUploads: 0,
    });
    expect(n.canUploadMore).toBe(false);
    expect(n.body).toContain('모두 사용했습니다');
  });

  it('검수 대기 외의 상태를 성공이라고 말하지 않는다', () => {
    const n = resolveUploadDoneNotice({
      status: ResidentUploadStatus.UploadFailed,
      remainingUploads: 4,
    });
    expect(n.title).not.toBe('잘 올라갔습니다');
  });
});

describe('안내 문구 계약', () => {
  it('검수 게이트 고지는 "바로 공개되지 않는다"를 명시한다', () => {
    expect(REVIEW_GATE_NOTICE).toContain('지사 담당자');
    expect(REVIEW_GATE_NOTICE).toContain('바로 공개되지는 않습니다');
  });

  it('간단 모드 고지는 제목·분류·자막을 요구하지 않음을 알린다', () => {
    expect(SIMPLE_MODE_NOTICE).toContain('제목');
    expect(SIMPLE_MODE_NOTICE).toContain('분류');
    expect(SIMPLE_MODE_NOTICE).toContain('자막');
  });

  it('지켜질 수 없는 약속을 하지 않는다 — 제목·분류를 담당자가 "정해 준다"고 말하지 않는다(대장 #136)', () => {
    // 서버에 제목·분류 수정 액터가 0명이라, 그 약속은 현재 지켜질 수 없다.
    expect(SIMPLE_MODE_NOTICE).not.toContain('정해');
    expect(SIMPLE_MODE_NOTICE).not.toContain('나중에 입력');
  });

  it('연락처 수집은 선택이며 목적을 함께 밝힌다(07 §3-15 과잉수집 방지)', () => {
    expect(CONTACT_PURPOSE_NOTICE).toContain('적지 않으셔도');
  });

  it('이용허락 문구가 확정되기 전에는 동의를 수집하지 않는다(07 §3-15 · EXEC-DECISIONS #25)', () => {
    expect(LEGAL_CONSENT_TEXT).toBeNull();
    expect(shouldCollectConsent()).toBe(false);
  });
});
