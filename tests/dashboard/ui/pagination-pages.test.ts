import { deepStrictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { paginationPages } from '../../../src/dashboard/ui/pagination-pages.ts';

describe('paginationPages', () => {
  it('yields nothing without pages', () => {
    deepStrictEqual(paginationPages(1, 0), []);
  });

  it('yields the single page alone', () => {
    deepStrictEqual(paginationPages(1, 1), [1]);
  });

  it('lists every page when the window covers them', () => {
    deepStrictEqual(paginationPages(1, 5), [1, 2, 3, 4, 5]);
    deepStrictEqual(paginationPages(4, 7), [1, 2, 3, 4, 5, 6, 7]);
  });

  it('appends the last page with an ellipsis past the window', () => {
    deepStrictEqual(paginationPages(1, 10), [1, 2, 3, 4, '...', 10]);
  });

  it('joins the first page directly across a one-page gap', () => {
    deepStrictEqual(paginationPages(5, 20), [1, 2, 3, 4, 5, 6, 7, 8, '...', 20]);
  });

  it('opens an ellipsis once the gap widens', () => {
    deepStrictEqual(paginationPages(6, 20), [1, '...', 3, 4, 5, 6, 7, 8, 9, '...', 20]);
  });

  it('windows both sides around a middle page', () => {
    deepStrictEqual(paginationPages(10, 20), [1, '...', 7, 8, 9, 10, 11, 12, 13, '...', 20]);
  });

  it('joins the last page directly across a one-page gap', () => {
    deepStrictEqual(paginationPages(16, 20), [1, '...', 13, 14, 15, 16, 17, 18, 19, 20]);
  });

  it('ends flush when the window reaches the last page', () => {
    deepStrictEqual(paginationPages(17, 20), [1, '...', 14, 15, 16, 17, 18, 19, 20]);
  });
});
