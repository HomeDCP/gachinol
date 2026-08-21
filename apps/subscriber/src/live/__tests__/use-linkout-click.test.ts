import { TelemetryEventName, toId } from '@gachinol/shared';
import type { LiveSessionId, ProductCard, ProductCardId } from '@gachinol/shared';
import { performLinkoutClick } from '../use-linkout-click';

const SESSION_ID = toId<LiveSessionId>('ls-1');

const card = (over: Partial<ProductCard> = {}): ProductCard => ({
  id: toId<ProductCardId>('pc-1'),
  name: '한라봉 5kg',
  url: 'https://smartstore.naver.com/shop/products/1',
  priceLabel: '25,000원',
  ...over,
});

function ctx() {
  const send = jest.fn();
  const openUrl = jest.fn().mockResolvedValue(true);
  return { send, openUrl, deps: { liveSessionId: SESSION_ID, sender: { send }, openUrl } };
}

describe('performLinkoutClick', () => {
  it('계측을 보내고 외부 URL로 이동한다', () => {
    const { send, openUrl, deps } = ctx();
    const target = card();

    expect(performLinkoutClick(target, deps)).toBe(true);

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        name: TelemetryEventName.CommerceLinkoutClick,
        payload: { liveSessionId: SESSION_ID, productCardId: target.id },
      }),
    );
    expect(openUrl).toHaveBeenCalledWith(target.url);
  });

  it('계측이 이동보다 먼저 나간다 — 문서 언로드로 취소되는 것을 막는다', () => {
    const order: string[] = [];
    const send = jest.fn(() => void order.push('send'));
    const openUrl = jest.fn(() => {
      order.push('open');
      return Promise.resolve(true);
    });

    performLinkoutClick(card(), { liveSessionId: SESSION_ID, sender: { send }, openUrl });

    expect(order).toEqual(['send', 'open']);
  });

  it('http(s)가 아닌 URL은 계측도 이동도 하지 않는다(저장형 XSS 최종 차단)', () => {
    for (const url of ['javascript:alert(1)', 'data:text/html,<script>', 'ftp://x/y', '']) {
      const { send, openUrl, deps } = ctx();
      expect(performLinkoutClick(card({ url }), deps)).toBe(false);
      expect(send).not.toHaveBeenCalled();
      expect(openUrl).not.toHaveBeenCalled();
    }
  });

  it('이동이 실패해도 계측은 되돌리지 않는다 — 클릭은 실제로 일어났다', async () => {
    const send = jest.fn();
    const openUrl = jest.fn().mockRejectedValue(new Error('no handler'));

    expect(() =>
      performLinkoutClick(card(), { liveSessionId: SESSION_ID, sender: { send }, openUrl }),
    ).not.toThrow();
    await Promise.resolve();

    expect(send).toHaveBeenCalledTimes(1);
  });
});
