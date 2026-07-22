import type { JobPayloadMap } from '@gachinol/shared';
import { loadWorkerEnv } from './env';
import {
  previewKey,
  previewProfile,
  renditionKey,
  renditionProfile,
  thumbnailKey,
  thumbnailProfile,
} from './profiles';

const baseEnv = {
  REDIS_URL: 'redis://localhost:6379',
  S3_ENDPOINT: 'http://localhost:9000',
  S3_ACCESS_KEY: 'a',
  S3_SECRET_KEY: 'b',
};

describe('profiles', () => {
  const env = loadWorkerEnv({ ...baseEnv } as NodeJS.ProcessEnv);

  test('renditionProfile — env 높이/VBR + payload label 우선', () => {
    const payload: JobPayloadMap['transcode'] = {
      contentId: 'c1' as never,
      sourceAssetId: 'a1' as never,
      renditionLabels: ['720p'],
    };
    expect(renditionProfile(env, payload)).toEqual({ height: 720, vbrKbps: 2500, label: '720p' });
  });

  test('renditionProfile — payload label 없으면 `${height}p`', () => {
    const payload: JobPayloadMap['transcode'] = {
      contentId: 'c1' as never,
      sourceAssetId: 'a1' as never,
      renditionLabels: [],
    };
    expect(renditionProfile(env, payload).label).toBe('720p');
  });

  test('previewProfile — payload maxHeight/maxBitrate 우선, label=preview-{h}p', () => {
    const payload: JobPayloadMap['preview'] = {
      contentId: 'c1' as never,
      sourceAssetId: 'a1' as never,
      maxHeight: 360,
      maxBitrateKbps: 600,
    };
    expect(previewProfile(env, payload)).toEqual({
      maxHeight: 360,
      maxBitrateKbps: 600,
      label: 'preview-360p',
    });
  });

  test('previewProfile — payload 0/미지정 시 env 기본값', () => {
    const payload = {
      contentId: 'c1' as never,
      sourceAssetId: 'a1' as never,
      maxHeight: 0,
      maxBitrateKbps: 0,
    } as unknown as JobPayloadMap['preview'];
    expect(previewProfile(env, payload)).toEqual({
      maxHeight: 360,
      maxBitrateKbps: 600,
      label: 'preview-360p',
    });
  });

  test('thumbnailProfile — env 전량', () => {
    expect(thumbnailProfile(env)).toEqual({ width: 640, atSec: 1 });
  });

  test('key 규약 — outputKeyPrefix 하위 파일명', () => {
    const prefix = 'contents/c1/g1/';
    expect(renditionKey(prefix, '720p')).toBe('contents/c1/g1/rendition/720p.mp4');
    expect(previewKey(prefix)).toBe('contents/c1/g1/preview.mp4');
    expect(thumbnailKey(prefix)).toBe('contents/c1/g1/thumbnail.jpg');
  });

  test('env override — MEDIA_RENDITION_HEIGHT/MEDIA_PREVIEW_HEIGHT 반영', () => {
    const custom = loadWorkerEnv({
      ...baseEnv,
      MEDIA_RENDITION_HEIGHT: '1080',
      MEDIA_RENDITION_VBR_KBPS: '5000',
      MEDIA_PREVIEW_HEIGHT: '240',
      MEDIA_THUMBNAIL_WIDTH: '320',
      MEDIA_THUMBNAIL_AT_SEC: '0',
    } as NodeJS.ProcessEnv);
    expect(custom.MEDIA_RENDITION_HEIGHT).toBe(1080);
    expect(renditionProfile(custom, { renditionLabels: [] } as never).height).toBe(1080);
    expect(thumbnailProfile(custom)).toEqual({ width: 320, atSec: 0 });
  });
});

describe('loadWorkerEnv fail-fast', () => {
  test('필수 키 누락 시 누락 키를 나열하며 throw', () => {
    expect(() => loadWorkerEnv({} as NodeJS.ProcessEnv)).toThrow(/REDIS_URL/);
  });
});
