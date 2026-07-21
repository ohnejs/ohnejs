import type { QueryIR } from '../ir.ts';

import { isUndefined } from '../../../utils/index.ts';
import { applyHook } from '../../hooks/apply-hook.ts';
import { useHooks } from '../../hooks/use-hooks.ts';

declare module 'ohne' {
  interface Hooks {
    /**
     * Filters the frozen `QueryIR` before a read terminal compiles it, so one scope reaches every read.
     * Fires once per SQL statement: `findMany`, `findFirst`, `count`, `exists`, and `pluck`'s column path.
     * A `paginate` fires it twice, once for its count and once for its row read, each a separate statement.
     * AND-inject a scoping condition here: a tenant key, a soft-delete `deletedAt IS NULL`, or an ACL clause.
     * The `QueryIR` is `Object.freeze`d, so mutating it throws; return a rebuilt IR, or nothing to keep it.
     * Rebuild by spreading the IR and folding your clause into `condition`, wrapped in an `and` when one exists.
     * It does not reach populated targets, junction `UUID` lists, child composites, or blocks; those bypass it.
     * Reach for `populate:targets` to scope populated relations.
     */
    'query:filter': (ir: QueryIR) => void | QueryIR | Promise<void | QueryIR>;
  }
}

/**
 * Runs the `query:filter` hook over a frozen `QueryIR`, or returns it untouched when none is registered.
 * Every read terminal calls this at its head, so a registered scope reaches every read the same way.
 */
export async function resolveIR(ir: QueryIR): Promise<QueryIR> {
  const callbacks = useHooks().get('query:filter');
  if (isUndefined(callbacks) || callbacks.length === 0) return ir;
  return applyHook('query:filter', ir);
}
