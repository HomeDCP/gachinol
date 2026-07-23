import { publishJobId } from './distribution-job';

/**
 * publishJobId 결정성·집합 민감성 — 동시성 clobber 방지의 핵심.
 * 같은 pubId 집합 → 같은 jobId(멱등 재큐), 다른 집합 → 다른 jobId(전체 distribute와 채널별 retry 격리).
 */
describe('publishJobId', () => {
  it('접두 형식 publish:<content>:g<gen>-<hash> (BullMQ 콜론 2개 제약 준수)', () => {
    const id = publishJobId('c-1', 1, ['pub-a']);
    expect(id).toMatch(/^publish:c-1:g1-[0-9a-f]{12}$/);
    // BullMQ 커스텀 jobId: 콜론 포함 시 정확히 3파트만 허용
    expect(id.split(':')).toHaveLength(3);
  });

  it('같은 집합 → 같은 jobId (멱등)', () => {
    expect(publishJobId('c-1', 1, ['pub-a', 'pub-b'])).toBe(
      publishJobId('c-1', 1, ['pub-a', 'pub-b']),
    );
  });

  it('순서 무관 — 정렬 후 해시', () => {
    expect(publishJobId('c-1', 1, ['pub-b', 'pub-a'])).toBe(
      publishJobId('c-1', 1, ['pub-a', 'pub-b']),
    );
  });

  it('다른 집합 → 다른 jobId (채널 B·C 동시 retry가 서로 clobber 안 함)', () => {
    const b = publishJobId('c-1', 1, ['pub-b']);
    const c = publishJobId('c-1', 1, ['pub-c']);
    const all = publishJobId('c-1', 1, ['pub-a', 'pub-b', 'pub-c']);
    expect(new Set([b, c, all]).size).toBe(3);
  });

  it('generation·content가 다르면 다른 jobId', () => {
    expect(publishJobId('c-1', 1, ['pub-a'])).not.toBe(publishJobId('c-1', 2, ['pub-a']));
    expect(publishJobId('c-1', 1, ['pub-a'])).not.toBe(publishJobId('c-2', 1, ['pub-a']));
  });
});
