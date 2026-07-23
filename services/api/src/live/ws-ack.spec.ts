import { DomainException } from '../common/errors/domain.exception';
import { wsError, wsOk } from './ws-ack';

describe('ws-ack', () => {
  it('wsOk → {ok:true, data}', () => {
    expect(wsOk({ x: 1 })).toEqual({ ok: true, data: { x: 1 } });
  });

  it('DomainException → {ok:false, error:{code,message,details}}', () => {
    const ack = wsError(
      new DomainException('validation_failed', '너무 빠름', { reason: 'rate_limited', retryAfterMs: 500 }),
    );
    expect(ack).toEqual({
      ok: false,
      error: {
        code: 'validation_failed',
        message: '너무 빠름',
        details: { reason: 'rate_limited', retryAfterMs: 500 },
      },
    });
  });

  it('details 없는 DomainException → error.details 생략', () => {
    const ack = wsError(new DomainException('forbidden', '권한 없음'));
    expect(ack).toEqual({ ok: false, error: { code: 'forbidden', message: '권한 없음' } });
  });

  it('일반 Error → internal (메시지 은닉)', () => {
    const ack = wsError(new Error('DB 커넥션 폭발'));
    expect(ack).toEqual({ ok: false, error: { code: 'internal', message: '서버 내부 오류' } });
  });
});
