import { RESIDENT_UPLOAD_MAX_BYTES } from '../resident-links.constants';
import { zIssueResidentLink, zResidentUploadRequest } from './resident-link.schemas';

const S1 = '01920000-0000-7000-8000-0000000000b1';
const base = { fileName: '해녀축제.mp4', mimeType: 'video/mp4', sizeBytes: 1024 };

describe('zIssueResidentLink', () => {
  it('stationId는 선택(기자는 토큰에서 해석) — UUID만 허용', () => {
    expect(zIssueResidentLink.parse({})).toEqual({});
    expect(zIssueResidentLink.parse({ stationId: S1 }).stationId).toBe(S1);
    expect(zIssueResidentLink.safeParse({ stationId: 'aewol' }).success).toBe(false);
  });
});

describe('zResidentUploadRequest', () => {
  it('원본은 비디오만', () => {
    expect(zResidentUploadRequest.safeParse(base).success).toBe(true);
    expect(zResidentUploadRequest.safeParse({ ...base, mimeType: 'image/png' }).success).toBe(false);
    expect(
      zResidentUploadRequest.safeParse({ ...base, mimeType: 'application/octet-stream' }).success,
    ).toBe(false);
  });

  it('★ 500MB 초과를 zod가 막지 않는다 — 상한 판정은 서비스(403 계약, 02 §D-T9)', () => {
    const over = { ...base, sizeBytes: RESIDENT_UPLOAD_MAX_BYTES + 1 };
    expect(zResidentUploadRequest.safeParse(over).success).toBe(true);
  });

  it('그래도 터무니없는 값·음수·소수는 거부(400)', () => {
    expect(zResidentUploadRequest.safeParse({ ...base, sizeBytes: 0 }).success).toBe(false);
    expect(zResidentUploadRequest.safeParse({ ...base, sizeBytes: -1 }).success).toBe(false);
    expect(zResidentUploadRequest.safeParse({ ...base, sizeBytes: 1.5 }).success).toBe(false);
    expect(zResidentUploadRequest.safeParse({ ...base, sizeBytes: 2 ** 50 }).success).toBe(false);
  });

  it('연락처·동의는 선택 — 문구 확정 전에도 업로드가 막히지 않는다(07 §3-15 파생 필드)', () => {
    expect(zResidentUploadRequest.parse(base).uploaderContact).toBeUndefined();
    expect(zResidentUploadRequest.parse(base).consentAgreed).toBeUndefined();
    const filled = zResidentUploadRequest.parse({
      ...base,
      uploaderContact: '  010-0000-0000  ',
      consentAgreed: true,
    });
    expect(filled.uploaderContact).toBe('010-0000-0000'); // trim
    expect(filled.consentAgreed).toBe(true);
    expect(zResidentUploadRequest.safeParse({ ...base, uploaderContact: 'x'.repeat(101) }).success)
      .toBe(false);
  });

  it('★ 간단 모드 강제 — 제목·분류·장면은 계약에 없어 서버에 도달하지 않는다(03 §C-5)', () => {
    const parsed = zResidentUploadRequest.parse({
      ...base,
      title: '내가 정한 제목',
      category: 'emergency',
      scenes: [{ order: 0, caption: '자막' }],
    } as never);
    expect(parsed).not.toHaveProperty('title');
    expect(parsed).not.toHaveProperty('category');
    expect(parsed).not.toHaveProperty('scenes');
  });
});
