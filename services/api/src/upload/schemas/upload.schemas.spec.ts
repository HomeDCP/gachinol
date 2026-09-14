import {
  zAbortMultipartUpload,
  zCompleteMultipartUpload,
  zCompleteUpload,
  zCreateMultipartUpload,
  zIssueUploadUrl,
} from './upload.schemas';

const CONTENT_ID = '01920000-0000-7000-8000-0000000000a1';

describe('zCreateMultipartUpload — 대장 #211', () => {
  it('필드는 zIssueUploadUrl과 동일 규칙(비디오 mimeType·5GB 상한)', () => {
    const base = {
      contentId: CONTENT_ID,
      fileName: 'clip.mp4',
      mimeType: 'video/mp4',
      sizeBytes: 1000,
    };
    expect(zCreateMultipartUpload.safeParse(base).success).toBe(true);
    expect(zIssueUploadUrl.safeParse(base).success).toBe(true);
  });

  it('mimeType이 video/*가 아니면 거부', () => {
    expect(
      zCreateMultipartUpload.safeParse({
        contentId: CONTENT_ID,
        fileName: 'clip.mp4',
        mimeType: 'image/png',
        sizeBytes: 1000,
      }).success,
    ).toBe(false);
  });

  it('sizeBytes는 양수·정수만 허용, 5GB 초과 거부', () => {
    const base = { contentId: CONTENT_ID, fileName: 'clip.mp4', mimeType: 'video/mp4' };
    expect(zCreateMultipartUpload.safeParse({ ...base, sizeBytes: 0 }).success).toBe(false);
    expect(zCreateMultipartUpload.safeParse({ ...base, sizeBytes: -1 }).success).toBe(false);
    expect(zCreateMultipartUpload.safeParse({ ...base, sizeBytes: 1.5 }).success).toBe(false);
    expect(
      zCreateMultipartUpload.safeParse({ ...base, sizeBytes: 5 * 1024 ** 3 + 1 }).success,
    ).toBe(false);
    expect(zCreateMultipartUpload.safeParse({ ...base, sizeBytes: 5 * 1024 ** 3 }).success).toBe(
      true,
    );
  });
});

describe('zCompleteMultipartUpload — 완료(ETag 목록 전달)', () => {
  const base = {
    contentId: CONTENT_ID,
    storageKey: 'contents/c-1/g1/original.mp4',
    uploadId: 'upload-1',
  };

  it('파트 1개 이상, partNumber 양의 정수·eTag 비어있지 않음', () => {
    expect(
      zCompleteMultipartUpload.safeParse({
        ...base,
        parts: [{ partNumber: 1, eTag: '"e1"' }],
      }).success,
    ).toBe(true);
  });

  it('parts가 빈 배열이면 거부(최소 1개 파트 필요)', () => {
    expect(zCompleteMultipartUpload.safeParse({ ...base, parts: [] }).success).toBe(false);
  });

  it('partNumber가 0 이하이거나 eTag가 빈 문자열이면 거부', () => {
    expect(
      zCompleteMultipartUpload.safeParse({
        ...base,
        parts: [{ partNumber: 0, eTag: '"e1"' }],
      }).success,
    ).toBe(false);
    expect(
      zCompleteMultipartUpload.safeParse({
        ...base,
        parts: [{ partNumber: 1, eTag: '' }],
      }).success,
    ).toBe(false);
  });

  it('uploadId·storageKey가 비어있으면 거부', () => {
    expect(
      zCompleteMultipartUpload.safeParse({
        ...base,
        uploadId: '',
        parts: [{ partNumber: 1, eTag: '"e1"' }],
      }).success,
    ).toBe(false);
    expect(
      zCompleteMultipartUpload.safeParse({
        ...base,
        storageKey: '',
        parts: [{ partNumber: 1, eTag: '"e1"' }],
      }).success,
    ).toBe(false);
  });
});

describe('zAbortMultipartUpload', () => {
  it('contentId·storageKey·uploadId 전부 필수', () => {
    expect(
      zAbortMultipartUpload.safeParse({
        contentId: CONTENT_ID,
        storageKey: 'contents/c-1/g1/original.mp4',
        uploadId: 'upload-1',
      }).success,
    ).toBe(true);
    expect(
      zAbortMultipartUpload.safeParse({
        contentId: CONTENT_ID,
        storageKey: 'contents/c-1/g1/original.mp4',
      }).success,
    ).toBe(false);
  });
});

describe('기존 계약 무변경 확인 — zIssueUploadUrl·zCompleteUpload', () => {
  it('zIssueUploadUrl은 대장 #211 이전과 동일 필드만 받는다', () => {
    expect(
      zIssueUploadUrl.parse({
        contentId: CONTENT_ID,
        fileName: 'clip.mp4',
        mimeType: 'video/mp4',
        sizeBytes: 1000,
      }),
    ).toEqual({
      contentId: CONTENT_ID,
      fileName: 'clip.mp4',
      mimeType: 'video/mp4',
      sizeBytes: 1000,
    });
  });

  it('zCompleteUpload은 대장 #211 이전과 동일 필드만 받는다', () => {
    expect(
      zCompleteUpload.parse({
        contentId: CONTENT_ID,
        storageKey: 'contents/c-1/g1/original.mp4',
      }),
    ).toEqual({ contentId: CONTENT_ID, storageKey: 'contents/c-1/g1/original.mp4' });
  });
});
