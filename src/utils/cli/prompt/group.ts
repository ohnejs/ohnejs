import type { PromptResult } from './is-cancel.ts';

import { CANCEL, isCancel } from './is-cancel.ts';

/**
 * A named sequence of prompt steps keyed by the result they produce.
 * Each step receives the results gathered so far and resolves to its own value, or `CANCEL`.
 *
 * @example
 * ```ts
 * const steps: GroupSteps<{ name: string; ts: boolean }> = {
 *   name: () => prompt.text({ message: 'Name?' }),
 *   ts: (results) => prompt.confirm({ message: `TypeScript for ${results.name}?` }),
 * }
 * ```
 */
export type GroupSteps<T> = {
  [K in keyof T]: (results: Partial<T>) => Promise<PromptResult<T[K]>>;
};

/**
 * Runs prompt steps in key order, threading the gathered results into each.
 * The first step the user cancels short-circuits the whole group to `CANCEL`, so there is one cancel path.
 *
 * @example
 * ```ts
 * const answers = await group({
 *   name: () => prompt.text({ message: 'Name?' }),
 *   ts: () => prompt.confirm({ message: 'TypeScript?' }),
 * })
 * if (isCancel(answers)) return
 * answers.name // string
 * ```
 */
export async function group<T extends Record<string, unknown>>(
  steps: GroupSteps<T>,
): Promise<PromptResult<T>> {
  const results: Partial<T> = {};
  for (const key of Object.keys(steps) as (keyof T)[]) {
    const value = await steps[key](results);
    if (isCancel(value)) return CANCEL;
    results[key] = value;
  }
  return results as T;
}
