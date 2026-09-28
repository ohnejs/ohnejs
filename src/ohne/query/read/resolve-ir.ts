import type { QueryIR } from '../ir.ts';

import { isUndefined } from '../../../utils/index.ts';
import { applyHook } from '../../hooks/apply-hook.ts';
import { useHooks } from '../../hooks/use-hooks.ts';

declare module 'ohnejs' {
  interface Hooks {
    /**
     * Filters the frozen `QueryIR` before a read terminal compiles it, so one scope reaches every read.
     * A read marked `unscoped` skips it.
     * Fires once per statement: `findMany`, `findFirst`, `count`, `exists`, `pluck`, and a write's read-back.
     * A `paginate` fires it twice, once for its count and once for its row read, each a separate statement.
     * AND-inject a scoping condition here: a tenant key, a soft-delete `deletedAt IS NULL`, or an ACL clause.
     * The `QueryIR` is `Object.freeze`d, so mutating it throws; return a rebuilt IR, or nothing to keep it.
     * Rebuild by spreading the IR and folding your clause into `condition`, in an `and` when one exists.
     * It does not reach populated targets, junction `UUID` lists, child composites, or blocks.
     * Scope populated relations with `populate:targets`, and updates and deletes with `record:condition`.
     */
    'query:filter': (ir: QueryIR) => void | QueryIR | Promise<void | QueryIR>;
  }
}

/**
 * Runs the `query:filter` hook over a frozen `QueryIR`, or returns it untouched when none is registered.
 * Every read terminal calls this at its head, so a registered scope reaches every read the same way.
 * A narrowed spread or a write's read-back arrives unfrozen, so this freezes the top level the hook sees.
 * An `unscoped` read returns untouched.
 */
export async function resolveIR(ir: QueryIR): Promise<QueryIR> {
  if (ir.unscoped) return ir;
  const callbacks = useHooks().get('query:filter');
  if (isUndefined(callbacks) || callbacks.length === 0) return ir;
  return applyHook('query:filter', Object.freeze(ir));
}
