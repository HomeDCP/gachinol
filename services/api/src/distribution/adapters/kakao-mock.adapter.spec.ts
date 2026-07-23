import type { PublishTargetItem } from '../distribution-job';
import { ChannelPublishError } from './channel-adapter';
import { KakaoMockAdapter } from './kakao-mock.adapter';

const target = (over: Partial<PublishTargetItem> = {}): PublishTargetItem => ({
  publicationId: 'pub-1' as never,
  platform: 'kakao',
  externalChannelId: 'kakao-aewol',
  credentialRef: 'kakao:aewol',
  idempotencyKey: 'pub-1',
  message: { title: '애월 해녀' },
  ...over,
});

describe('KakaoMockAdapter', () => {
  const adapter = new KakaoMockAdapter();

  it('platform=kakao', () => {
    expect(adapter.platform).toBe('kakao');
  });

  it('publish: 결정적 externalPostId/URL', async () => {
    const out = await adapter.publish(target());
    expect(out.externalPostId).toBe('kakao_mock_pub-1');
    expect(out.externalUrl).toBe('https://pf.kakao.com/kakao-aewol/kakao_mock_pub-1');
  });

  it('publish: externalChannelId fail- 접두 → ChannelPublishError throw', async () => {
    await expect(adapter.publish(target({ externalChannelId: 'fail-x' }))).rejects.toBeInstanceOf(
      ChannelPublishError,
    );
  });

  it('retract: no-op 성공', async () => {
    await expect(
      adapter.retract({ externalChannelId: 'kakao-aewol', externalPostId: 'p', credentialRef: 'c' }),
    ).resolves.toBeUndefined();
  });
});
