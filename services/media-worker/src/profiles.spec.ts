import type { JobPayloadMap } from '@gachinol/shared';
import { loadWorkerEnv } from './env';
import {
  autoEditProfile,
  editedMasterKey,
  masterProfile,
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
    expect(editedMasterKey(prefix)).toBe('contents/c1/g1/edited-master.mp4');
  });

  // ★ 대장 #232 태스크① — 舊 설계는 "렌디션과 같은 규격"이었다(마스터=720p/2500kbps).
  // 이제 마스터는 송출(YouTube/카카오) 규격으로 렌디션과 **분리**된다. 이 테스트는 그 분리를
  // 고정하려고 舊 단언을 **교체**한 것이다(조용히 지우지 않음).
  test('masterProfile — 송출 마스터 규격(1080p/8000kbps 기본, YouTube 권장치)', () => {
    expect(masterProfile(env)).toEqual({ height: 1080, vbrKbps: 8000 });
  });

  test('autoEditProfile — 마스터 규격과 렌디션 규격이 서로 다르다(舊: 같았음)', () => {
    const p = autoEditProfile(env);
    expect(p.master).toEqual({ height: 1080, vbrKbps: 8000 });
    expect(p.rendition).toEqual({ height: 720, vbrKbps: 2500, label: '720p' });
    expect(p.loudnormI).toBe(-16);
    // 마스터가 렌디션보다 고화질이어야 한다 — 이 부등식이 이번 작업의 핵심.
    expect(p.master.height).toBeGreaterThan(p.rendition.height);
    expect(p.master.vbrKbps).toBeGreaterThan(p.rendition.vbrKbps);
  });

  test('autoEditProfile — 렌디션 key는 여전히 transcode와 동일해야 배포본이 교체된다', () => {
    const prefix = 'contents/c1/g2/';
    const p = autoEditProfile(env);
    expect(renditionKey(prefix, p.rendition.label)).toBe(
      renditionKey(prefix, renditionProfile(env, { renditionLabels: [] } as never).label),
    );
  });

  test('env override — MEDIA_MASTER_HEIGHT/MEDIA_MASTER_VBR_KBPS 반영', () => {
    const custom = loadWorkerEnv({
      ...baseEnv,
      MEDIA_MASTER_HEIGHT: '1440',
      MEDIA_MASTER_VBR_KBPS: '12000',
    } as NodeJS.ProcessEnv);
    expect(masterProfile(custom)).toEqual({ height: 1440, vbrKbps: 12000 });
    // 렌디션은 마스터 env와 무관 — 여전히 기본값
    expect(autoEditProfile(custom).rendition).toEqual({ height: 720, vbrKbps: 2500, label: '720p' });
  });

  test('MEDIA_LOUDNORM_I — 음수 기본값(-16)이 검증을 통과하고 override도 된다', () => {
    expect(env.MEDIA_LOUDNORM_I).toBe(-16);
    const custom = loadWorkerEnv({ ...baseEnv, MEDIA_LOUDNORM_I: '-23' } as NodeJS.ProcessEnv);
    expect(autoEditProfile(custom).loudnormI).toBe(-23);
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
