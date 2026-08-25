import { last } from '../../utils/array/last.ts';

/**
 * The page entries a `pagination` renders, ported 1-to-1 from Pruvious v4's window math.
 *
 * A window of up to seven pages centers on the current page.
 * When the window misses the first page, `1` is prepended, with an ellipsis only when the gap is
 * more than one page; the last page is appended the same way.
 * A single page yields `[1]`, and the component renders nothing for it.
 *
 * @example
 * ```ts
 * paginationPages(1, 5)   // -> [1, 2, 3, 4, 5]
 * paginationPages(5, 20)  // -> [1, 2, 3, 4, 5, 6, 7, 8, '...', 20]
 * paginationPages(10, 20) // -> [1, '...', 7, 8, 9, 10, 11, 12, 13, '...', 20]
 * ```
 */
export function paginationPages(currentPage: number, lastPage: number): (number | '...')[] {
  const pages: (number | '...')[] = [];

  for (let i = Math.max(1, currentPage - 3); i <= Math.min(lastPage, currentPage + 3); i++) {
    pages.push(i);
  }

  if (lastPage > 0 && pages[0] !== 1) {
    if (currentPage - 4 > 1) {
      pages.unshift('...');
    }

    pages.unshift(1);
  }

  if (lastPage > 1 && last(pages) !== lastPage) {
    if (currentPage + 4 < lastPage) {
      pages.push('...');
    }

    pages.push(lastPage);
  }

  return pages;
}
