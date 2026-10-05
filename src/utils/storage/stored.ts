/**
 * Reads the JSON value stored under `key` in `localStorage`, or `fallback` when it is absent or unreadable.
 * Blocked storage, as in a private window, and a malformed value both answer `fallback`.
 *
 * @example
 * ```ts
 * readStored('ohne-panels', { left: 272 }) // -> { left: 272 }, until a value is written
 * ```
 */
export function readStored<T>(key: string, fallback: T): T {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    return raw === null || raw === undefined ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

/**
 * Writes `value` as JSON under `key` in `localStorage`, doing nothing where storage is blocked or full.
 *
 * @example
 * ```ts
 * writeStored('ohne-panels', { left: 300 })
 * readStored('ohne-panels', { left: 272 }) // -> { left: 300 }
 * ```
 */
export function writeStored(key: string, value: unknown): void {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(value));
  } catch {}
}
