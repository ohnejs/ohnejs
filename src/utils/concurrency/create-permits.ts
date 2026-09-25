import { isUndefined } from '../is/is-undefined.ts';

/**
 * A try-acquire counter over in-flight work: a global limit, and an optional limit per key.
 * It never queues: a caller over a limit is refused at once and decides what to answer.
 */
export interface Permits {
  /**
   * Takes one permit, counted against `key` too when given, and returns a release fn to call when done.
   * Returns `null` when the global limit or the key's limit is reached, so the caller refuses the work.
   * The release fn is idempotent: a second call is a no-op.
   */
  acquire(key?: string): (() => void) | null;
}

/**
 * Creates `Permits`: at most `limit` held at once, and at most `perKey` under any one key.
 * A permit taken without a key counts only against `limit`.
 * A key is forgotten once its last permit is released, so keys never pile up.
 *
 * @example
 * ```ts
 * const permits = createPermits(8, 2)
 *
 * const release = permits.acquire('thrall') // -> release fn
 * permits.acquire('thrall')                 // -> release fn, Thrall now holds 2
 * permits.acquire('thrall')                 // -> null, Thrall's limit is reached
 * permits.acquire('jaina')                  // -> release fn, Jaina counts apart
 *
 * release?.()                               //    Thrall holds 1 again
 * permits.acquire('thrall')                 // -> release fn
 * ```
 */
export function createPermits(limit: number, perKey = Infinity): Permits {
  let held = 0;
  const heldBy = new Map<string, number>();

  return {
    acquire(key) {
      const count = isUndefined(key) ? 0 : (heldBy.get(key) ?? 0);
      if (held >= limit || count >= perKey) return null;
      held++;
      if (!isUndefined(key)) heldBy.set(key, count + 1);

      let released = false;
      return () => {
        if (released) return;
        released = true;
        held--;
        if (isUndefined(key)) return;
        const left = (heldBy.get(key) ?? 0) - 1;
        if (left > 0) heldBy.set(key, left);
        else heldBy.delete(key);
      };
    },
  };
}
