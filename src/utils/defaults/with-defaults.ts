import { unique } from '../array/unique.ts';
import { parseDotNotation } from '../dot-notation/parse-dot-notation.ts';
import { isArray } from '../is/is-array.ts';
import { isPlainObject } from '../is/is-plain-object.ts';
import { isUndefined } from '../is/is-undefined.ts';

/**
 * Per-path merging strategy for `withDefaults`.
 *
 * - `'replace'` - input wins entirely; defaults are discarded.
 * - `'defaults'` - recurse into objects (per key) and arrays (per index); longer side fills the rest.
 * - `'concat'` - arrays only: `[...input, ...defaults]`. No-op on non-arrays.
 * - `'concat-unique'` - same as `'concat'`, then deduped via `unique`.
 */
export type WithDefaultsStrategy = 'replace' | 'defaults' | 'concat' | 'concat-unique';

/**
 * Options for `withDefaults`.
 */
export interface WithDefaultsOptions {
  /**
   * Per-path strategy overrides keyed by dot-notation path.
   * Object keys use `.key`, array indices use `[n]`: `foo.bar`, `items[0].tag`.
   * Paths are normalised via `parseDotNotation`, so invalid paths throw at call time.
   *
   * @default
   * {}
   */
  strategies?: Record<string, WithDefaultsStrategy>;
}

/**
 * Fills `input` with values from `defaults` for any missing key.
 * Input wins per leaf; plain objects recurse, arrays replace.
 *
 * Per-path strategies override the default behavior.
 * To reach inside an array, set its path to `'defaults'`, `'concat'`, or `'concat-unique'`.
 * Arrays do not auto-descend just because a child path is targeted.
 *
 * Non-plain values (`Date`, `RegExp`, `Set`, `Map`, class instances) are treated as leaves.
 * They are replaced wholesale.
 * Reach for `merge` if you need collection-aware merging.
 *
 * Neither input is mutated.
 * `__proto__`, `constructor`, and `prototype` keys in either side are dropped to prevent prototype pollution.
 *
 * @example
 * ```ts
 * withDefaults({ a: 1 }, { a: 2, b: 3 })
 * // -> { a: 1, b: 3 }
 *
 * withDefaults({ tags: ['x'] }, { tags: ['y', 'z'] })
 * // -> { tags: ['x'] }
 *
 * withDefaults(
 *   { tags: ['x'] },
 *   { tags: ['y', 'z'] },
 *   { strategies: { tags: 'concat-unique' } }
 * )
 * // -> { tags: ['x', 'y', 'z'] }
 *
 * withDefaults(
 *   { items: [{ name: 'A' }] },
 *   { items: [{ kind: 'x' }, { kind: 'y' }] },
 *   { strategies: { items: 'defaults' } }
 * )
 * // -> { items: [{ name: 'A', kind: 'x' }, { kind: 'y' }] }
 * ```
 */
export function withDefaults<T>(input: T, defaults: undefined, options?: WithDefaultsOptions): T;
export function withDefaults<T>(input: undefined, defaults: T, options?: WithDefaultsOptions): T;
export function withDefaults<A extends object, B extends object>(
  input: A,
  defaults: B,
  options?: WithDefaultsOptions,
): A & B;
export function withDefaults(
  input: unknown,
  defaults: unknown,
  options: WithDefaultsOptions = {},
): unknown {
  const strategies = normaliseStrategies(options.strategies);
  return apply(input, defaults, '', strategies);
}

const POISONED = new Set(['__proto__', 'constructor', 'prototype']);

function apply(
  input: unknown,
  defaults: unknown,
  path: string,
  strategies: Map<string, WithDefaultsStrategy>,
): unknown {
  const strategy = strategies.get(path);

  if (strategy === 'replace') {
    return isUndefined(input) ? defaults : input;
  }

  if (strategy === 'concat' || strategy === 'concat-unique') {
    if (isArray(input) && isArray(defaults)) {
      const combined = [...input, ...defaults];
      return strategy === 'concat-unique' ? unique(combined) : combined;
    }
  }

  if (isUndefined(input)) return defaults;
  if (isUndefined(defaults)) return input;

  if (isPlainObject(input) && isPlainObject(defaults)) {
    const result: Record<string, unknown> = {};
    const keys = new Set<string>();
    for (const k of Object.keys(input)) if (!POISONED.has(k)) keys.add(k);
    for (const k of Object.keys(defaults)) if (!POISONED.has(k)) keys.add(k);
    for (const key of keys) {
      const childPath = path === '' ? key : `${path}.${key}`;
      result[key] = apply(input[key], defaults[key], childPath, strategies);
    }
    return result;
  }

  if (strategy === 'defaults' && isArray(input) && isArray(defaults)) {
    const length = Math.max(input.length, defaults.length);
    return Array.from({ length }, (_, i) =>
      apply(input[i], defaults[i], `${path}[${i}]`, strategies),
    );
  }

  return input;
}

function normaliseStrategies(
  raw: Record<string, WithDefaultsStrategy> | undefined,
): Map<string, WithDefaultsStrategy> {
  const map = new Map<string, WithDefaultsStrategy>();
  if (!raw) return map;
  for (const key of Object.keys(raw)) map.set(canonicalise(key), raw[key]);
  return map;
}

function canonicalise(path: string): string {
  const segments = parseDotNotation(path);
  let out = '';
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    if (s.kind === 'index') out += `[${s.value}]`;
    else out += i === 0 ? s.value : `.${s.value}`;
  }
  return out;
}
