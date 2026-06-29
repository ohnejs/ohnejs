import type { Child } from './insert.ts';

import { effect } from '../utils/reactive/effect.ts';
import { ref } from '../utils/reactive/ref.ts';

/**
 * A reactive conditional child.
 *
 * `then` renders while `condition` is truthy; `otherwise`, when given, renders while it is falsy.
 * The branch swaps only when the truthiness flips, not on every value `condition` reads.
 *
 * @example
 * ```ts
 * const open = ref(false)
 *
 * h('aside', null, when(() => open.value, () => h('p', null, 'visible')))
 * ```
 */
export function when(
  condition: () => unknown,
  then: () => Child,
  otherwise?: () => Child,
): () => Child {
  const active = ref(false);
  effect(() => {
    active.value = Boolean(condition());
  });
  return () => (active.value ? then() : otherwise?.());
}
