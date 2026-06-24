import { isUndefined } from '../is/is-undefined.ts';

/**
 * Conflict resolver for a `Registry<V>`.
 * Called when a key is registered that already holds a value.
 * The returned value replaces the existing one.
 */
export type Merger<V> = (existing: V, incoming: V) => V;

/**
 * Options for `createRegistry`.
 */
export interface RegistryOptions<V> {
  /**
   * Folds an incoming value into the existing one on key collision.
   * If omitted, the incoming value replaces the existing one wholesale.
   */
  merge?: Merger<V>;
}

/**
 * Typed key-value store with a configurable conflict policy.
 *
 * `register` applies the policy on key collision.
 * Without a merger the incoming value wins; with one, `merge(existing, incoming)` decides the result.
 * The registry tracks nothing else - no provenance, no order beyond insertion.
 */
export interface Registry<V> {
  /**
   * Registers `value` under `key`.
   * On collision, applies `options.merge` if configured; otherwise replaces.
   */
  register(key: string, value: V): void;

  /**
   * Returns the value registered under `key`, or `undefined` if none.
   */
  get(key: string): V | undefined;

  /**
   * Returns `true` if a value has been registered under `key`.
   */
  has(key: string): boolean;

  /**
   * Removes `key`.
   * Returns `true` if it was present, `false` otherwise.
   */
  delete(key: string): boolean;

  /**
   * Removes every entry.
   */
  clear(): void;

  /**
   * Returns a fresh, null-prototype record of every registered entry.
   * Mutating the returned object does not affect the registry.
   */
  all(): Record<string, V>;

  /**
   * Returns every registered key in insertion order.
   */
  keys(): string[];

  /**
   * Number of registered entries.
   */
  readonly size: number;
}

/**
 * Creates a typed registry: a key-value store with a configurable conflict policy.
 *
 * By default, registering a key that already exists replaces the previous value.
 * Pass `options.merge` to fold the incoming value into the existing one instead.
 *
 * @example
 * ```ts
 * const r = createRegistry<number>()
 * r.register('a', 1)
 * r.register('a', 2)
 * r.get('a') // -> 2
 *
 * const sums = createRegistry<number>({
 *   merge: (existing, incoming) => existing + incoming,
 * })
 * sums.register('a', 1)
 * sums.register('a', 2)
 * sums.register('a', 3)
 * sums.get('a') // -> 6
 * ```
 */
export function createRegistry<V>(options?: RegistryOptions<V>): Registry<V> {
  const store = new Map<string, V>();
  const merge = options?.merge;

  const registry: Registry<V> = {
    register(key, value) {
      if (!isUndefined(merge) && store.has(key)) {
        store.set(key, merge(store.get(key)!, value));
      } else {
        store.set(key, value);
      }
    },
    get(key) {
      return store.get(key);
    },
    has(key) {
      return store.has(key);
    },
    delete(key) {
      return store.delete(key);
    },
    clear() {
      store.clear();
    },
    all() {
      const out: Record<string, V> = Object.create(null);
      for (const [k, v] of store) out[k] = v;
      return out;
    },
    keys() {
      return [...store.keys()];
    },
    get size() {
      return store.size;
    },
  };

  return registry;
}
