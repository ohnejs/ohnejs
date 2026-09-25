import { parseDuration } from '../duration/parse-duration.ts';
import { isUndefined } from '../is/is-undefined.ts';
import { longTimeout } from '../timeout/long-timeout.ts';

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
   */
  timeout?: number | string;
}

/**
 * A drain primitive: admit work while open, refuse while closing, wait for in-flight work to finish.
 * Work a drain cannot wait out can be cancelled.
 *
 * It carries no domain knowledge - HTTP holds a ticket per request, a job queue holds one per job.
 */
export interface Gate {
  /**
   * Admits one unit of work while open, returning a release fn to call when it finishes.
   * Returns `null` the moment the gate is closing or closed, so the caller refuses the new unit.
   * The release fn is idempotent: a second call is a no-op.
   * `onCancel` is how `cancel` asks this unit to stop while it is in flight.
   */
  enter(onCancel?: (reason: unknown) => void): (() => void) | null;

  /**
   * Asks every unit still in flight to stop, calling the `onCancel` each passed to `enter` with `reason`.
   * A cancelled unit stays in flight until it releases, so await `settled` for it.
   *
   * @example
   * ```ts
   * const { drained } = await gate.close({ timeout: '10s' })
   * if (!drained) gate.cancel(new Error('shutting down')) // -> each unit's onCancel runs
   * await gate.settled()                                  // -> resolves once they release
   * ```
   */
  cancel(reason?: unknown): void;

  /**
   * Flips the gate to `closing` and waits for in-flight work to drain.
   * Resolves `{ drained: true, pending: 0 }` on a clean drain.
   * Resolves `{ drained: false, pending }` if the timeout wins first.
   * Idempotent: later calls return the first call's promise.
   */
  close(options?: GateCloseOptions): Promise<GateDrain>;

  /**
   * Resolves once no unit is in flight, at once when none is.
   * It outlives a timed-out `close`, still waiting for the units the timeout left in flight.
   *
   * @example
   * ```ts
   * const { drained } = await gate.close({ timeout: '10s' })
   * if (!drained) await gate.settled() // -> resolves once the stragglers release
   * ```
   */
  settled(): Promise<void>;

  /**
   * `'open'` while admitting, `'closing'` once `close` is awaiting the drain, `'closed'` once it resolved.
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
  const units = new Set<{ onCancel?: (reason: unknown) => void }>();
  let closePromise: Promise<GateDrain> | undefined;
  let onDrained: (() => void) | undefined;
  let idle: PromiseWithResolvers<void> | undefined;

  const settle = () => {
    if (units.size > 0) return;
    idle?.resolve();
    idle = undefined;
    if (state === 'closing') {
      state = 'closed';
      onDrained?.();
    }
  };

  return {
    enter(onCancel) {
      if (state !== 'open') return null;
      const unit = { onCancel };
      units.add(unit);
      return () => {
        if (units.delete(unit)) settle();
      };
    },
    cancel(reason) {
      for (const unit of units) unit.onCancel?.(reason);
    },
    close(options) {
      if (closePromise) return closePromise;
      state = 'closing';
      if (units.size === 0) {
        state = 'closed';
        return (closePromise = Promise.resolve({ drained: true, pending: 0 }));
      }
      return (closePromise = new Promise((resolve) => {
        const clearTimer = isUndefined(options?.timeout)
          ? undefined
          : longTimeout(() => {
              state = 'closed';
              resolve({ drained: false, pending: units.size });
            }, parseDuration(options.timeout));
        onDrained = () => {
          clearTimer?.();
          resolve({ drained: true, pending: 0 });
        };
      }));
    },
    settled() {
      if (units.size === 0) return Promise.resolve();
      return (idle ??= Promise.withResolvers<void>()).promise;
    },
    get state() {
      return state;
    },
    get pending() {
      return units.size;
    },
  };
}
