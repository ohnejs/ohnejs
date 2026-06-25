import { parseDuration } from '../duration/parse-duration.ts';
import { isUndefined } from '../is/is-undefined.ts';

/**
 * Outcome of closing a `Gate`.
 */
export interface GateDrain {
  /**
   * `true` if every in-flight unit finished before the timeout, `false` if the timeout won first.
   */
  drained: boolean;

  /**
   * Units still in flight when `close` settled.
   * Always `0` when `drained` is `true`.
   */
  pending: number;
}

/**
 * Options for `Gate.close`.
 */
export interface GateCloseOptions {
  /**
   * How long to wait for in-flight work before giving up, as a `parseDuration` value.
   * Omitted means wait indefinitely.
   *
   * @example
   * ```ts
   * 5000   // 5 seconds, as raw milliseconds
   * '5s'   // 5 seconds
   * '1.5s' // 1500 milliseconds
   * '2m'   // 2 minutes
   * ```
   */
  timeout?: number | string;
}

/**
 * A drain primitive: admit work while open, refuse while closing, wait for in-flight work to finish.
 *
 * Each `enter` is one unit of work that must be released.
 * `close` flips the gate and refuses new units.
 * It resolves once the in-flight count reaches zero or the timeout wins.
 * It carries no domain knowledge - HTTP holds a ticket per request, a job queue holds one per job.
 */
export interface Gate {
  /**
   * Admits one unit of work while open, returning a release fn to call when it finishes.
   * Returns `null` the moment the gate is closing or closed, so the caller refuses the new unit.
   * The release fn is idempotent: a second call is a no-op.
   */
  enter(): (() => void) | null;

  /**
   * Flips the gate to `closing` and waits for in-flight work to drain.
   * Resolves `{ drained: true, pending: 0 }` on a clean drain.
   * Resolves `{ drained: false, pending }` if the timeout wins first.
   * Idempotent: later calls return the first call's promise.
   */
  close(options?: GateCloseOptions): Promise<GateDrain>;

  /**
   * `'open'` while admitting, `'closing'` once `close` is awaiting the drain, `'closed'` once settled.
   */
  readonly state: 'open' | 'closing' | 'closed';

  /**
   * Units of work currently in flight.
   */
  readonly pending: number;
}

/**
 * Creates a `Gate`: a standalone drain primitive with no domain knowledge.
 *
 * `enter` admits a unit of work and returns its release fn.
 * It returns `null` once closing, so callers refuse new work.
 * `close` waits for in-flight units to finish, bounded by an optional timeout.
 *
 * @example
 * ```ts
 * const gate = createGate()
 *
 * const release = gate.enter() // -> release fn, gate.pending is now 1
 * release?.()                  //    work done, gate.pending back to 0
 *
 * await gate.close()           // -> { drained: true, pending: 0 }
 * gate.enter()                 // -> null, the gate refuses new work
 * ```
 */
export function createGate(): Gate {
  let state: 'open' | 'closing' | 'closed' = 'open';
  let pending = 0;
  let closePromise: Promise<GateDrain> | undefined;
  let onDrained: (() => void) | undefined;

  const settle = () => {
    if (state === 'closing' && pending === 0) {
      state = 'closed';
      onDrained?.();
    }
  };

  return {
    enter() {
      if (state !== 'open') return null;
      pending++;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        pending--;
        settle();
      };
    },
    close(options) {
      if (closePromise) return closePromise;
      state = 'closing';
      if (pending === 0) {
        state = 'closed';
        return (closePromise = Promise.resolve({ drained: true, pending: 0 }));
      }
      return (closePromise = new Promise((resolve) => {
        const timer = isUndefined(options?.timeout)
          ? undefined
          : setTimeout(() => {
              state = 'closed';
              resolve({ drained: false, pending });
            }, parseDuration(options.timeout));
        onDrained = () => {
          if (timer) clearTimeout(timer);
          resolve({ drained: true, pending: 0 });
        };
      }));
    },
    get state() {
      return state;
    },
    get pending() {
      return pending;
    },
  };
}
