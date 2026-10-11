import type { SearchParamValue } from '../../utils/search-params/coerce-token.ts';

import { isBoolean } from '../../utils/is/is-boolean.ts';
import { isRealNumber } from '../../utils/is/is-real-number.ts';
import { isString } from '../../utils/is/is-string.ts';
import { isUndefined } from '../../utils/is/is-undefined.ts';
import { effect } from '../../utils/reactive/effect.ts';
import { ref, type Ref } from '../../utils/reactive/ref.ts';
import { untracked } from '../../utils/reactive/untracked.ts';
import { stringifySearchParams } from '../../utils/search-params/stringify-search-params.ts';
import { navigate, useRoute } from './router.ts';

/**
 * How `useSearchParam` reads and writes its param.
 */
export interface SearchParamOptions<T> {
  /**
   * The value read while the param is absent or does not fit; writing it removes the param.
   */
  fallback: T;

  /**
   * How a write moves history: `'push'` adds an entry, so back undoes it.
   *
   * @default
   * 'replace'
   */
  history?: 'replace' | 'push';
}

type Scalar = string | number | boolean;

/**
 * Binds one search param of the current page to a ref, typed by its `fallback`.
 * Reading follows the URL; writing navigates within the page, which keeps it.
 * A string param reads any scalar as text, a number param only finite numbers, a boolean param only booleans.
 * A value of another type, or outside `choices`, reads as `fallback`.
 * A write once the location left the page's pathname is a no-op, so a teardown never lands on the next page.
 *
 * @example
 * ```ts
 * const view = useSearchParam('view', { fallback: 'grid', choices: ['grid', 'list'] })
 * const page = useSearchParam('page', { fallback: 1, history: 'push' })
 *
 * view.value     // -> 'grid' on `/media`, 'list' on `/media?view=list`
 * page.value = 2 // -> navigates to `/media?page=2`, pushing history
 * page.value = 1 // -> navigates to `/media`, the fallback removed
 * ```
 */
export function useSearchParam<const T extends Scalar>(
  name: string,
  options: SearchParamOptions<NoInfer<T>> & { choices: readonly T[] },
): Ref<T>;
export function useSearchParam(name: string, options: SearchParamOptions<string>): Ref<string>;
export function useSearchParam(name: string, options: SearchParamOptions<number>): Ref<number>;
export function useSearchParam(name: string, options: SearchParamOptions<boolean>): Ref<boolean>;
export function useSearchParam(
  name: string,
  options: SearchParamOptions<Scalar> & { choices?: readonly Scalar[] },
): Ref<Scalar> {
  const { fallback, history: mode = 'replace', choices } = options;
  const route = untracked(useRoute);
  const pathname = location.pathname;
  const current = ref(fallback);
  effect(() => {
    const value = coerce(route?.query[name], fallback);
    current.value = isUndefined(value) || choices?.includes(value) === false ? fallback : value;
  });
  return {
    get value() {
      return current.value;
    },
    set value(next) {
      if (location.pathname !== pathname) return;
      const query = untracked(() => route?.query);
      const search = stringifySearchParams({
        ...query,
        [name]: next === fallback ? undefined : next,
      });
      void navigate(pathname + (search === '' ? '' : `?${search}`) + location.hash, {
        replace: mode === 'replace',
      });
    },
  };
}

/**
 * Reads `value` as the type of `fallback`, or `undefined` when it does not fit.
 */
function coerce(value: SearchParamValue | undefined, fallback: Scalar): Scalar | undefined {
  if (isBoolean(fallback)) return isBoolean(value) ? value : undefined;
  if (!isString(fallback)) return isRealNumber(value) ? value : undefined;
  return isString(value) || isRealNumber(value) || isBoolean(value) ? String(value) : undefined;
}
