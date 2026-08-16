import { residentUploadKeys } from '../keys';

describe('residentUploadKeys', () => {
  test('all — invalidate용 prefix 앵커', () => {
    expect(residentUploadKeys.all).toEqual(['resident-uploads']);
  });

  test('list — status 없으면 빈 필터 객체', () => {
    expect(residentUploadKeys.list({})).toEqual(['resident-uploads', 'list', {}]);
  });

  test('list — status가 키에 반영된다', () => {
    expect(residentUploadKeys.list({ status: 'awaiting_branch_review' })).toEqual([
      'resident-uploads',
      'list',
      { status: 'awaiting_branch_review' },
    ]);
  });

  test('list — 같은 필터는 항상 같은 키(참조 동등 아님, 값 동등)', () => {
    expect(residentUploadKeys.list({ status: 'approved' })).toEqual(
      residentUploadKeys.list({ status: 'approved' }),
    );
  });

  test('list — 다른 status는 다른 키', () => {
    expect(residentUploadKeys.list({ status: 'approved' })).not.toEqual(
      residentUploadKeys.list({ status: 'rejected' }),
    );
  });

  test('all은 모든 list 키의 prefix다 — invalidateQueries({queryKey: all})가 전 필터를 잡는다', () => {
    const listKey = residentUploadKeys.list({ status: 'awaiting_branch_review' });
    expect(listKey.slice(0, residentUploadKeys.all.length)).toEqual([...residentUploadKeys.all]);
  });
});
