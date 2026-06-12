/**
 * Copies entries from `source` into `target`, overwriting any existing values.
 *
 * Pair with `loadEnv` to make `.env` win over values already set in the environment.
 *
 * Mutates `target` in place.
 *
 * @example
 * ```ts
 * patchEnv({ FOO: 'a', BAR: 'b' }) // applies to process.env
 *
 * const target: NodeJS.ProcessEnv = { FOO: 'old' }
 * patchEnv({ FOO: 'new', BAR: 'added' }, target)
 * // -> target equals { FOO: 'new', BAR: 'added' }
 * ```
 */
export function patchEnv(
  source: Record<string, string>,
  target: NodeJS.ProcessEnv = process.env,
): void {
  Object.assign(target, source);
}
