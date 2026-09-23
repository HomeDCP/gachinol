import {
  renditionLabelForHeight,
  selectPlaybackRendition,
  selectDistributionVideo,
  type RenditionSelectable,
} from './asset-selectors';

type Asset = RenditionSelectable & { id: string };

const asset = (overrides: Partial<Asset> & Pick<Asset, 'id'>): Asset => ({
  kind: 'rendition',
  status: 'ready',
  renditionLabel: null,
  ...overrides,
});

describe('renditionLabelForHeight', () => {
  it('높이(px) → 레이블 문자열 파생 — 레이블 파생은 이 함수 한 곳뿐이다', () => {
    expect(renditionLabelForHeight(720)).toBe('720p');
    expect(renditionLabelForHeight(360)).toBe('360p');
    expect(renditionLabelForHeight(1080)).toBe('1080p');
  });
});

describe('selectPlaybackRendition', () => {
  it('선호 레이블이 있으면 그것을 고른다', () => {
    const assets = [
      asset({ id: 'a', renditionLabel: '480p' }),
      asset({ id: 'b', renditionLabel: '720p' }),
    ];
    const picked = selectPlaybackRendition(assets, { preferredLabel: '720p' });
    expect(picked?.id).toBe('b');
  });

  it('선호 레이블 미적중이면 첫 ready 렌디션으로 폴백한다', () => {
    const assets = [
      asset({ id: 'first', renditionLabel: '480p' }),
      asset({ id: 'second', renditionLabel: '1080p' }),
    ];
    const picked = selectPlaybackRendition(assets, { preferredLabel: '720p' });
    expect(picked?.id).toBe('first');
  });

  it('MEDIA_RENDITION_HEIGHT가 바뀌어도(예: 1080) 그 레이블이 있으면 조용히 폴백하지 않는다', () => {
    const assets = [
      asset({ id: 'a', renditionLabel: '720p' }),
      asset({ id: 'b', renditionLabel: '1080p' }),
    ];
    const picked = selectPlaybackRendition(assets, {
      preferredLabel: renditionLabelForHeight(1080),
    });
    expect(picked?.id).toBe('b');
  });

  it("status가 'ready'가 아닌 자산은 제외한다(선호 레이블이라도)", () => {
    const assets = [
      asset({ id: 'pending-720', renditionLabel: '720p', status: 'pending' }),
      asset({ id: 'ready-480', renditionLabel: '480p', status: 'ready' }),
    ];
    const picked = selectPlaybackRendition(assets, { preferredLabel: '720p' });
    expect(picked?.id).toBe('ready-480');
  });

  it("kind가 'rendition'이 아닌 자산(썸네일·마스터 등)은 제외한다", () => {
    const assets = [
      asset({ id: 'thumb', kind: 'thumbnail', renditionLabel: '720p' }),
      asset({ id: 'master', kind: 'edited_master', renditionLabel: null }),
      asset({ id: 'rend-480', kind: 'rendition', renditionLabel: '480p' }),
    ];
    const picked = selectPlaybackRendition(assets, { preferredLabel: '720p' });
    expect(picked?.id).toBe('rend-480');
  });

  it('빈 배열이면 undefined', () => {
    expect(selectPlaybackRendition([], { preferredLabel: '720p' })).toBeUndefined();
  });

  it('ready 렌디션이 전혀 없으면(썸네일·pending뿐) undefined', () => {
    const assets = [
      asset({ id: 'thumb', kind: 'thumbnail' }),
      asset({ id: 'pending', status: 'pending' }),
    ];
    expect(selectPlaybackRendition(assets, { preferredLabel: '720p' })).toBeUndefined();
  });
});

describe('selectDistributionVideo', () => {
  it('현 세대 ready edited_master가 있으면 렌디션보다 마스터를 고른다(대장 #232 태스크③)', () => {
    const assets = [
      asset({ id: 'rend-720', renditionLabel: '720p' }),
      asset({ id: 'master', kind: 'edited_master', renditionLabel: null }),
      asset({ id: 'thumb', kind: 'thumbnail', renditionLabel: '720p' }),
    ];
    const picked = selectDistributionVideo(assets, { preferredLabel: '720p' });
    expect(picked?.id).toBe('master');
  });

  it("마스터가 status!=='ready'면(예: processing) 고르지 않고 렌디션으로 폴백한다", () => {
    const assets = [
      asset({ id: 'master-processing', kind: 'edited_master', renditionLabel: null, status: 'processing' }),
      asset({ id: 'rend-720', renditionLabel: '720p' }),
    ];
    const picked = selectDistributionVideo(assets, { preferredLabel: '720p' });
    expect(picked?.id).toBe('rend-720');
  });

  it('마스터가 아예 없으면(재마스터링하지 않는 기존 콘텐츠·auto_edit 이전 세대) 선호 레이블 렌디션으로 폴백한다', () => {
    const assets = [
      asset({ id: 'a', renditionLabel: '480p' }),
      asset({ id: 'b', renditionLabel: '720p' }),
      asset({ id: 'thumb', kind: 'thumbnail', renditionLabel: '720p' }),
    ];
    const picked = selectDistributionVideo(assets, { preferredLabel: '720p' });
    expect(picked?.id).toBe('b');
  });

  it('마스터도 없고 선호 레이블도 미적중이면 첫 ready 렌디션으로 폴백한다(전체 자산 목록을 받아도 동일)', () => {
    const assets = [
      asset({ id: 'rend-first', renditionLabel: '480p' }),
      asset({ id: 'thumb', kind: 'thumbnail', renditionLabel: '720p' }),
    ];
    const picked = selectDistributionVideo(assets, { preferredLabel: '720p' });
    expect(picked?.id).toBe('rend-first');
  });

  it("status가 'ready'가 아닌 렌디션도 마스터 부재 시 폴백 규칙상 제외된다(마스터 유무와 무관하게 selectReadyRendition 규칙이 그대로 적용)", () => {
    const assets = [
      asset({ id: 'pending-720', renditionLabel: '720p', status: 'pending' }),
      asset({ id: 'ready-480', renditionLabel: '480p', status: 'ready' }),
    ];
    const picked = selectDistributionVideo(assets, { preferredLabel: '720p' });
    expect(picked?.id).toBe('ready-480');
  });

  it('빈 배열이면 undefined', () => {
    expect(selectDistributionVideo([], { preferredLabel: '720p' })).toBeUndefined();
  });

  it('selectPlaybackRendition은 ready 마스터가 있어도 여전히 렌디션만 고른다(회귀 방지 — 시청 재생은 항상 저화질)', () => {
    const assets = [
      asset({ id: 'master', kind: 'edited_master', renditionLabel: null, status: 'ready' }),
      asset({ id: 'rend-720', renditionLabel: '720p' }),
    ];
    const picked = selectPlaybackRendition(assets, { preferredLabel: '720p' });
    expect(picked?.id).toBe('rend-720');
    expect(picked?.id).not.toBe('master');
  });
});
