/**
 * The rate a key is counted at: `limit` hits per `window` milliseconds.
 * Both are positive integers, and `(limit + 1) * window` is a safe integer.
 */
export interface RateLimitRate {
  /**
   * How many hits a key may make in one `window`.
   */
  limit: number;

  /**
   * The span `limit` refills over, in milliseconds.
   */
  window: number;
}

/**
 * Where a `RateLimiter` keeps its counts.
 * A key may spend its whole `limit` at once, then regains one hit every `window / limit`.
 *
 * A store shared across processes must decide and count in one atomic step.
 * Reading a count and writing it back in two steps lets two processes both pass the last free hit.
 */
export interface RateLimitStore {
  /**
   * Counts one hit against `key` and resolves `0` when it is allowed.
   * Past the budget it resolves the whole milliseconds until the next hit is allowed, and counts nothing.
   * A key last taken at a different rate starts over with its full budget.
   */
  take(key: string, rate: RateLimitRate): Promise<number>;

  /**
   * Counts `cost` hits against `key`, even past the budget, and resolves the wait `take` would answer now.
   * A `cost` of `0` counts nothing, so it only reads the wait.
   * A key charged past its budget waits until the whole overdraft has refilled.
   * A key last counted at a different rate starts over with its full budget.
   * `cost` is a whole number, and `cost * window` a safe integer.
   */
  charge?(key: string, rate: RateLimitRate, cost: number): Promise<number>;

  /**
   * Gives `key` its full budget back, whatever rate it was taken at.
   */
  reset(key: string): Promise<void>;

  /**
   * Verifies the store is reachable, run once before the server listens.
   */
  check?(): Promise<void>;

  /**
   * Releases what the store holds, run once after the server drains.
   */
  close?(): Promise<void>;
}
