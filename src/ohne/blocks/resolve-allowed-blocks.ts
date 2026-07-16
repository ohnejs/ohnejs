import { isUndefined, naturalCompare } from '../../utils/index.ts';

/**
 * The outcome of resolving a blocks field's `allow` option.
 * `empty` means no block type is left to hold; `unknown` names the first unregistered type.
 */
export type AllowedBlocks =
  | { ok: true; allowed: string[] }
  | { ok: false; reason: 'empty' }
  | { ok: false; reason: 'unknown'; block: string };

/**
 * Resolves a blocks field's allowed type names against the registered set.
 * An omitted `allow` means every registered block; an explicit list is validated name by name.
 * The result sorts by name, so no consumer's output shifts with declaration order.
 *
 * The one resolution the desired schema, codegen, and the query metadata all share.
 * Failures return, not throw - each consumer renders its own error with its own context.
 */
export function resolveAllowedBlocks(
  allow: readonly string[] | undefined,
  registered: readonly string[],
): AllowedBlocks {
  if (!isUndefined(allow)) {
    for (const block of allow) {
      if (!registered.includes(block)) return { ok: false, reason: 'unknown', block };
    }
  }
  const allowed = [...(allow ?? registered)].sort(naturalCompare);
  if (allowed.length === 0) return { ok: false, reason: 'empty' };
  return { ok: true, allowed };
}
