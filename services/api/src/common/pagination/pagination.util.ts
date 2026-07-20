import type { Paginated } from '@gachinol/shared';

/** zPage 통과 후의 정규화된 페이지 파라미터 */
export interface PageParams {
  page: number;
  pageSize: number;
}

/** prisma findMany skip/take 계산 */
export const toSkipTake = ({ page, pageSize }: PageParams): { skip: number; take: number } => ({
  skip: (page - 1) * pageSize,
  take: pageSize,
});

/** Paginated<T> 조립 */
export const toPaginated = <T>(
  items: readonly T[],
  totalCount: number,
  { page, pageSize }: PageParams,
): Paginated<T> => ({ items, page, pageSize, totalCount });
