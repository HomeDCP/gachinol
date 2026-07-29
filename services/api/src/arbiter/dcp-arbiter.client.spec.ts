import { splitSseFrames, sseEventName } from './dcp-arbiter.client';

describe('splitSseFrames', () => {
  it('완성된 프레임만 떼고 나머지는 버퍼로 남긴다', () => {
    const { frames, rest } = splitSseFrames('event: a\ndata: 1\n\nevent: b\ndata: 2\n\nevent: par');
    expect(frames).toEqual(['event: a\ndata: 1', 'event: b\ndata: 2']);
    expect(rest).toBe('event: par'); // 잘린 프레임은 다음 청크와 이어붙인다
  });

  it('완성 프레임이 없으면 전부 버퍼', () => {
    expect(splitSseFrames('event: snap')).toEqual({ frames: [], rest: 'event: snap' });
  });

  it('CRLF 개행을 처리한다', () => {
    const { frames } = splitSseFrames('event: a\r\ndata: 1\r\n\r\n');
    expect(frames).toEqual(['event: a\r\ndata: 1']);
  });

  it('빈 프레임(keep-alive 개행)은 버린다', () => {
    expect(splitSseFrames('\n\n\n\n').frames).toEqual([]);
  });
});

describe('sseEventName', () => {
  it('event 필드를 읽는다', () => {
    expect(sseEventName('event: state_changed\ndata: {}')).toBe('state_changed');
    expect(sseEventName('data: {}\nevent: snapshot')).toBe('snapshot');
  });

  it('event 없으면 message(SSE 기본)', () => {
    expect(sseEventName('data: {}')).toBe('message');
  });

  it('주석(:)은 이벤트가 아니다 — keep-alive가 트리거를 유발하면 안 된다', () => {
    expect(sseEventName(': keep-alive')).toBe('message');
  });
});
