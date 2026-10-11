import type { Child } from './insert.ts';

import { effect } from '../../utils/reactive/effect.ts';
import { ref } from '../../utils/reactive/ref.ts';
import { untracked } from '../../utils/reactive/untracked.ts';

/**
 * A reactive child rebuilt whenever `key` changes.
 *
 * `build` runs untracked, so a ref it reads while building never rebuilds it.
 * A `key` that reads the same value under `Object.is` keeps the built child, however often it re-runs.
 * Reach for it when a child derives everything once from a value and must start over when that value changes.
 *
 * @example
 * ```ts
 * const route = useRoute()!
 *
 * h('main', null, keyed(() => route.query.view, () => posts(route.query.view)))
 * // -> rebuilds `posts` only when `?view` changes
 * ```
 */
export function keyed(key: () => unknown, build: () => Child): () => Child {
  const current = ref<unknown>(undefined);
  effect(() => {
    current.value = key();
  });
  return () => {
    void current.value;
    return untracked(build);
  };
}
