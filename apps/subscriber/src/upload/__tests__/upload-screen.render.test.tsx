import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { ApiClientError } from '../../api/errors';
import { REVIEW_GATE_NOTICE, SIMPLE_MODE_NOTICE } from '../gate';
import type { ResidentLinkPublicView } from '../resident-link-api';
import type { PickedVideo, ResidentUploader } from '../upload-contract';

/* ══════════════════════════════════════════════════════════════════════════
 * 주민 업로드 화면 렌더 테스트 — T-W2-09.
 *
 * 고정하는 불변식:
 *  ① **검수 게이트 고지가 화면에 실제로 렌더된다** — 이 문장이 사라지면 무인증 업로더가
 *     "올리면 바로 방송"으로 오해한다(03 §C-5). 문구를 지우면 이 스위트가 깨진다.
 *  ② 만료·소진·없는 링크는 사유별로 정직하게 안내하고 **업로드 UI를 열지 않는다**.
 *  ③ 토큰은 화면 어디에도 렌더되지 않는다(무인증 자격 증명 노출 금지).
 *  ④ 업로드 한 바퀴(선택 → 발급 → PUT → 완료 통지)가 실제 호출 순서대로 돈다.
 *  ⑤ 상한 초과 파일은 서버를 때리기 전에 막고, 이유를 알려준다.
 *
 * 테스트를 `src/**\/__tests__/`에 두는 이유: expo-router의 require.context가 `app/` 아래 파일을
 * 라우트 트리에 싣기 때문이다(리포 선례 — watch-screen-contact.render.test.tsx 주석).
 * ══════════════════════════════════════════════════════════════════════════ */

const mockParams = jest.fn<{ token?: string | string[] }, []>();
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockParams(),
}));

const mockUseResidentLink = jest.fn();
jest.mock('../queries', () => ({
  useResidentLinkApi: () => ({ baseUrl: 'https://example.test' }),
  useResidentLink: () => mockUseResidentLink(),
}));

const mockCreateUpload = jest.fn();
const mockCompleteUpload = jest.fn();
jest.mock('../resident-link-api', () => ({
  createResidentUpload: (...args: unknown[]) => mockCreateUpload(...args),
  completeResidentUpload: (...args: unknown[]) => mockCompleteUpload(...args),
}));

let mockUploaderStub: ResidentUploader;
jest.mock('../uploader', () => ({
  createResidentUploader: () => mockUploaderStub,
}));

import ResidentUploadScreen from '../../../app/upload/[token]';

const TOKEN = 'kZ8m_resident-link-token-0000000000000000000';

const VIEW: ResidentLinkPublicView = {
  valid: true,
  stationName: '애월 마을방송국',
  expiresAt: '2999-01-01T00:00:00.000Z',
  maxUploads: 5,
  remainingUploads: 5,
  maxFileSizeBytes: 524_288_000,
};

const PICKED: PickedVideo = {
  name: '마을잔치.mp4',
  mimeType: 'video/mp4',
  sizeBytes: 4_000_000,
  body: 'BYTES',
};

function stubUploader(over: Partial<ResidentUploader> = {}): ResidentUploader {
  return {
    supported: true,
    pickVideo: jest.fn(async () => PICKED),
    putVideo: jest.fn(async () => undefined),
    ...over,
  };
}

function linkQuery(over: Record<string, unknown> = {}) {
  return { isPending: false, error: null, data: VIEW, refetch: jest.fn(), ...over };
}

beforeEach(() => {
  mockParams.mockReturnValue({ token: TOKEN });
  mockUseResidentLink.mockReturnValue(linkQuery());
  mockUploaderStub = stubUploader();
  mockCreateUpload.mockResolvedValue({
    uploadId: 'u1',
    uploadUrl: 'https://storage.test/put?sig=SECRET',
    uploadUrlExpiresAt: '2999-01-01T00:15:00.000Z',
    remainingUploads: 4,
    maxFileSizeBytes: 524_288_000,
  });
  mockCompleteUpload.mockResolvedValue({
    uploadId: 'u1',
    status: 'awaiting_branch_review',
    remainingUploads: 4,
  });
});

describe('검수 게이트 고지 (03 §C-5)', () => {
  it('업로드 가능한 링크 화면에 검수 게이트 고지가 렌더된다', async () => {
    const { getByText } = await render(<ResidentUploadScreen />);
    expect(getByText(REVIEW_GATE_NOTICE)).toBeTruthy();
  });

  it('간단 모드 고지(제목·분류·자막 불요)도 함께 렌더된다', async () => {
    const { getByText } = await render(<ResidentUploadScreen />);
    expect(getByText(SIMPLE_MODE_NOTICE)).toBeTruthy();
  });

  it('업로드 완료 뒤에도 "검수 뒤에 방송"임을 다시 알린다', async () => {
    const { getByText, getAllByText, getByLabelText } = await render(<ResidentUploadScreen />);
    await act(async () => fireEvent.press(getByLabelText('촬영해서 올리기')));
    await act(async () => fireEvent.press(getByLabelText('이 영상 보내기')));

    await waitFor(() => expect(getByText('잘 올라갔습니다')).toBeTruthy());
    // 안내 카드(항상) + 완료 카드(이번에 생김) 두 곳에서 같은 고지가 보인다
    expect(getAllByText(new RegExp(REVIEW_GATE_NOTICE.slice(0, 20)))).toHaveLength(2);
  });
});

describe('링크 상태별 화면', () => {
  it('토큰이 없으면 업로드 UI를 열지 않는다', async () => {
    mockParams.mockReturnValue({});
    const { getByText, queryByLabelText } = await render(<ResidentUploadScreen />);
    expect(getByText('링크가 올바르지 않습니다')).toBeTruthy();
    expect(queryByLabelText('촬영해서 올리기')).toBeNull();
  });

  it('만료된 링크는 사유를 밝히고 새 링크를 요청하라고 안내한다', async () => {
    mockUseResidentLink.mockReturnValue(
      linkQuery({ data: { ...VIEW, valid: false, reason: 'expired' } }),
    );
    const { getByText, queryByLabelText } = await render(<ResidentUploadScreen />);
    expect(getByText('링크 사용 기간이 지났습니다')).toBeTruthy();
    expect(queryByLabelText('이 영상 보내기')).toBeNull();
  });

  it('건수를 모두 쓴 링크는 재업로드를 열지 않는다', async () => {
    mockUseResidentLink.mockReturnValue(
      linkQuery({ data: { ...VIEW, valid: false, reason: 'exhausted', remainingUploads: 0 } }),
    );
    const { getByText, queryByLabelText } = await render(<ResidentUploadScreen />);
    expect(getByText('이 링크로는 더 올릴 수 없습니다')).toBeTruthy();
    expect(queryByLabelText('촬영해서 올리기')).toBeNull();
  });

  it('404(없는 링크)는 재시도 버튼 없이 안내만 한다', async () => {
    mockUseResidentLink.mockReturnValue(
      linkQuery({
        data: undefined,
        error: new ApiClientError(404, { code: 'not_found', message: '유효하지 않은 링크입니다' }),
      }),
    );
    const { getByText, queryByLabelText } = await render(<ResidentUploadScreen />);
    expect(getByText('사용할 수 없는 링크입니다')).toBeTruthy();
    expect(queryByLabelText('다시 시도')).toBeNull();
  });

  it('네트워크 실패는 다시 시도를 제공한다', async () => {
    const refetch = jest.fn();
    mockUseResidentLink.mockReturnValue(
      linkQuery({ data: undefined, error: new Error('boom'), refetch }),
    );
    const { getByLabelText } = await render(<ResidentUploadScreen />);
    fireEvent.press(getByLabelText('다시 시도'));
    expect(refetch).toHaveBeenCalled();
  });
});

describe('토큰 비노출', () => {
  it('토큰이 화면 어디에도 렌더되지 않는다', async () => {
    const { toJSON } = await render(<ResidentUploadScreen />);
    expect(JSON.stringify(toJSON())).not.toContain(TOKEN);
  });

  it('만료 화면에서도 지사명·토큰을 흘리지 않는다(ready 밖에서는 링크 정보 자체가 없다)', async () => {
    mockUseResidentLink.mockReturnValue(
      linkQuery({ data: { ...VIEW, valid: false, reason: 'expired' } }),
    );
    const { toJSON } = await render(<ResidentUploadScreen />);
    const tree = JSON.stringify(toJSON());
    expect(tree).not.toContain(TOKEN);
    expect(tree).not.toContain('애월 마을방송국');
  });
});

describe('업로드 한 바퀴', () => {
  it('선택 → presign 발급 → PUT → 완료 통지 순서로 돈다', async () => {
    const refetch = jest.fn();
    mockUseResidentLink.mockReturnValue(linkQuery({ refetch }));
    const { getByLabelText, getByText } = await render(<ResidentUploadScreen />);

    await act(async () => fireEvent.press(getByLabelText('저장된 영상 고르기')));
    expect(getByText('마을잔치.mp4')).toBeTruthy();

    await act(async () => fireEvent.press(getByLabelText('이 영상 보내기')));

    await waitFor(() => expect(mockCompleteUpload).toHaveBeenCalled());
    expect(mockCreateUpload).toHaveBeenCalledWith(
      { baseUrl: 'https://example.test' },
      TOKEN,
      expect.objectContaining({
        fileName: '마을잔치.mp4',
        mimeType: 'video/mp4',
        sizeBytes: 4_000_000,
      }),
    );
    // 동의 문구 미확정 → consentAgreed를 보내지 않는다(07 §3-15)
    expect(mockCreateUpload.mock.calls[0][2]).not.toHaveProperty('consentAgreed');
    expect(mockUploaderStub.putVideo).toHaveBeenCalledWith(
      'https://storage.test/put?sig=SECRET',
      PICKED,
      expect.any(Function),
      expect.any(Object),
    );
    expect(mockCompleteUpload).toHaveBeenCalledWith(
      { baseUrl: 'https://example.test' },
      TOKEN,
      'u1',
    );
    // 남은 횟수·만료의 원천은 서버 — 끝나면 다시 물어본다
    expect(refetch).toHaveBeenCalled();
  });

  it('파일을 고르기 전에는 보내기 버튼이 눌리지 않는다', async () => {
    const { getByLabelText } = await render(<ResidentUploadScreen />);
    fireEvent.press(getByLabelText('이 영상 보내기'));
    expect(mockCreateUpload).not.toHaveBeenCalled();
  });

  it('상한을 넘는 영상은 서버를 때리기 전에 막고 이유를 보여준다', async () => {
    mockUploaderStub = stubUploader({
      pickVideo: jest.fn(async () => ({ ...PICKED, sizeBytes: 600 * 1024 * 1024 })),
    });
    const { getByLabelText, getByText } = await render(<ResidentUploadScreen />);
    await act(async () => fireEvent.press(getByLabelText('촬영해서 올리기')));

    expect(getByText(/영상이 너무 큽니다/)).toBeTruthy();
    fireEvent.press(getByLabelText('이 영상 보내기'));
    expect(mockCreateUpload).not.toHaveBeenCalled();
  });

  it('레이트리밋(429)은 서버 안내를 그대로 보여준다', async () => {
    mockCreateUpload.mockRejectedValue(
      new ApiClientError(429, {
        code: 'internal',
        message: '업로드 시도가 너무 많습니다. 약 6분 후 다시 시도해주세요.',
      }),
    );
    const { getByLabelText, getByText } = await render(<ResidentUploadScreen />);
    await act(async () => fireEvent.press(getByLabelText('저장된 영상 고르기')));
    await act(async () => fireEvent.press(getByLabelText('이 영상 보내기')));

    await waitFor(() =>
      expect(getByText('업로드 시도가 너무 많습니다. 약 6분 후 다시 시도해주세요.')).toBeTruthy(),
    );
  });

  it('취소는 아무 일도 일어나지 않은 것처럼 둔다', async () => {
    mockUploaderStub = stubUploader({ pickVideo: jest.fn(async () => null) });
    const { getByLabelText, queryByText } = await render(<ResidentUploadScreen />);
    await act(async () => fireEvent.press(getByLabelText('촬영해서 올리기')));
    expect(queryByText('마을잔치.mp4')).toBeNull();
    expect(mockCreateUpload).not.toHaveBeenCalled();
  });
});

describe('업로드 수단이 없는 플랫폼', () => {
  it('업로드 UI 대신 브라우저로 열라는 안내를 보여준다(되는 척하지 않는다)', async () => {
    mockUploaderStub = stubUploader({ supported: false });
    const { getByText, queryByLabelText } = await render(<ResidentUploadScreen />);
    expect(getByText(/웹 브라우저에서 열어 주세요/)).toBeTruthy();
    expect(queryByLabelText('촬영해서 올리기')).toBeNull();
    // 안내만 사라지고 검수 고지는 그대로 — 링크 정보 자체는 정상 표시된다
    expect(getByText(REVIEW_GATE_NOTICE)).toBeTruthy();
  });
});
