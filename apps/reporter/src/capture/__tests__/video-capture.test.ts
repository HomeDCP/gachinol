import {
  GhostMediaError,
  assertRealCapturedVideo,
  captureVideoViaImagePicker,
  fileNameFromUri,
  resolveRecordedVideoSize,
  toCapturedRecordedVideo,
  type CameraLaunchResult,
  type CameraPicker,
  type CapturedVideo,
  type RecordedFileSystem,
} from '../video-capture';

const validVideo = (): CapturedVideo => ({
  uri: 'blob:https://reporter.example/abc',
  fileName: 'clip.mp4',
  mimeType: 'video/mp4',
  sizeBytes: 1024,
});

describe('assertRealCapturedVideo — 유령 미디어 방어', () => {
  it('정상 영상은 그대로 통과시킨다', () => {
    const video = validVideo();
    expect(assertRealCapturedVideo(video)).toBe(video);
  });

  it('[뮤테이션 재현] 빈 uri(expo-camera 웹 record()의 { uri: "" })를 차단한다', () => {
    expect(() => assertRealCapturedVideo({ ...validVideo(), uri: '' })).toThrow(GhostMediaError);
    expect(() => assertRealCapturedVideo({ ...validVideo(), uri: '' })).toThrow('촬영에 실패했습니다');
  });

  it('공백만 있는 uri도 차단한다', () => {
    expect(() => assertRealCapturedVideo({ ...validVideo(), uri: '   ' })).toThrow(GhostMediaError);
  });

  it('video/가 아닌 mimeType(예: SPA HTML 셸의 text/html)을 차단한다', () => {
    expect(() =>
      assertRealCapturedVideo({ ...validVideo(), mimeType: 'text/html' }),
    ).toThrow('영상 파일이 아닙니다');
  });

  it('0바이트를 차단한다', () => {
    expect(() => assertRealCapturedVideo({ ...validVideo(), sizeBytes: 0 })).toThrow(
      '영상 정보를 확인할 수 없습니다',
    );
  });

  it('음수 sizeBytes도 차단한다(방어적)', () => {
    expect(() => assertRealCapturedVideo({ ...validVideo(), sizeBytes: -1 })).toThrow(GhostMediaError);
  });
});

describe('fileNameFromUri', () => {
  it('마지막 세그먼트를 파일명으로 쓴다', () => {
    expect(fileNameFromUri('file:///a/b/clip.mov')).toBe('clip.mov');
  });
  it('세그먼트가 없으면 기본값', () => {
    expect(fileNameFromUri('')).toBe('video.mp4');
  });
});

describe('captureVideoViaImagePicker — 웹 촬영(ImagePicker 주입)', () => {
  function picker(result: CameraLaunchResult): CameraPicker {
    return { launchCameraAsync: jest.fn().mockResolvedValue(result) };
  }

  it('취소(canceled=true)는 null', async () => {
    const p = picker({ canceled: true, assets: null });
    await expect(captureVideoViaImagePicker(p)).resolves.toBeNull();
  });

  it('assets가 비어도 null(방어적 — canceled=false인데 배열이 빈 경우)', async () => {
    const p = picker({ canceled: false, assets: [] });
    await expect(captureVideoViaImagePicker(p)).resolves.toBeNull();
  });

  it('정상 결과를 CapturedVideo로 매핑한다(fileName·mimeType 기본값, duration ms→s 반올림)', async () => {
    const p = picker({
      canceled: false,
      assets: [
        {
          uri: 'blob:https://reporter.example/xyz',
          fileName: null,
          mimeType: undefined,
          fileSize: 5000,
          duration: 12500,
        },
      ],
    });
    await expect(captureVideoViaImagePicker(p)).resolves.toEqual({
      uri: 'blob:https://reporter.example/xyz',
      fileName: 'xyz', // fileName null → uri 마지막 세그먼트로 폴백
      mimeType: 'video/mp4', // mimeType undefined → 기본값
      sizeBytes: 5000,
      durationSec: 13, // 12500ms → 12.5s → round 13
    });
  });

  it('[뮤테이션 재현] uri가 빈 문자열인 결과는 GhostMediaError로 막는다(웹 record() 동형 상황)', async () => {
    const p = picker({
      canceled: false,
      assets: [{ uri: '', fileSize: 100, mimeType: 'video/mp4' }],
    });
    await expect(captureVideoViaImagePicker(p)).rejects.toThrow(GhostMediaError);
  });

  it('fileSize가 없거나 0이면 GhostMediaError로 막는다', async () => {
    const p = picker({
      canceled: false,
      assets: [{ uri: 'blob:https://reporter.example/xyz', mimeType: 'video/mp4' }],
    });
    await expect(captureVideoViaImagePicker(p)).rejects.toThrow('영상 정보를 확인할 수 없습니다');
  });
});

describe('resolveRecordedVideoSize — 네이티브 녹화 크기 실측(FileSystem 주입)', () => {
  it('존재하는 파일의 size를 그대로 반환한다', async () => {
    const fs: RecordedFileSystem = {
      getInfoAsync: jest.fn().mockResolvedValue({ exists: true, size: 20480 }),
    };
    await expect(resolveRecordedVideoSize(fs, 'file:///a.mp4')).resolves.toBe(20480);
  });

  it('파일이 존재하지 않으면 0', async () => {
    const fs: RecordedFileSystem = { getInfoAsync: jest.fn().mockResolvedValue({ exists: false }) };
    await expect(resolveRecordedVideoSize(fs, 'file:///missing.mp4')).resolves.toBe(0);
  });

  it('getInfoAsync가 실패해도(throw) 0으로 떨어진다(이후 단계 방어가 잡는다)', async () => {
    const fs: RecordedFileSystem = {
      getInfoAsync: jest.fn().mockRejectedValue(new Error('native module error')),
    };
    await expect(resolveRecordedVideoSize(fs, 'file:///a.mp4')).resolves.toBe(0);
  });
});

describe('toCapturedRecordedVideo — 네이티브 recordAsync() 결과 → CapturedVideo', () => {
  it('실측 크기를 sizeBytes로 채운다(구 주석 "recordAsync는 크기를 주지 않음"의 실제 해소)', async () => {
    const fs: RecordedFileSystem = {
      getInfoAsync: jest.fn().mockResolvedValue({ exists: true, size: 999888 }),
    };
    await expect(toCapturedRecordedVideo(fs, { uri: 'file:///rec.mp4' })).resolves.toEqual({
      uri: 'file:///rec.mp4',
      fileName: 'rec.mp4',
      mimeType: 'video/mp4',
      sizeBytes: 999888,
    });
  });

  it('[뮤테이션 재현] 실측 크기가 0(파일을 못 읽음)이면 예전엔 sizeBytes:0으로 무해하게 넘어갔지만 지금은 GhostMediaError', async () => {
    const fs: RecordedFileSystem = { getInfoAsync: jest.fn().mockResolvedValue({ exists: false }) };
    await expect(toCapturedRecordedVideo(fs, { uri: 'file:///rec.mp4' })).rejects.toThrow(
      GhostMediaError,
    );
  });
});
