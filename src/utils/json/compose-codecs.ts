import type { JSONReviver } from './json-deserialize.ts';

import { keyBy } from '../array/key-by.ts';
import { isArray } from '../is/is-array.ts';
import { isPlainObject } from '../is/is-plain-object.ts';

/**
 * A typed JSON codec.
 * A named pair of `encode`/`decode` plus a `test` predicate.
 * `test` decides whether a value should be encoded by this codec.
 *
 * Used by `composeCodecs` to build the deep-walk encoder and the reviver.
 */
export interface JSONCodec<T> {
  /**
   * Unique identifier used as the sentinel key on the wire (`{ $<name>: ... }`).
   */
  name: string;

  /**
   * Predicate deciding whether `value` is one this codec encodes.
   * The first codec whose `test` returns `true` wins.
   */
  test: (value: unknown) => value is T;

  /**
   * Converts a matched value to a JSON-safe payload.
   * Container payloads (arrays, plain objects) are walked again so nested codec matches are tagged.
   * Primitive payloads are written as-is.
   */
  encode: (value: T) => unknown;

  /**
   * Reverses `encode`.
   * Receives the payload after nested sentinels have already been decoded.
   * The reviver runs bottom-up.
   */
  decode: (raw: unknown) => T;
}

/**
 * Result of `composeCodecs`.
 * `encode` is a deep-walk value transformer.
 * It exists because `JSON.stringify` runs `toJSON` (e.g. on `Date`) before a replacer sees the raw instance.
 * `reviver` is the standard `JSON.parse` reviver shape.
 */
export interface ComposedCodecs {
  /**
   * Deep-walks `value`, tagging matches as `{ $<name>: encoded }`.
   * Apply before `jsonSerialize`.
   */
  encode: (value: unknown) => unknown;

  /**
   * `JSON.parse`-compatible reviver.
   * Pass as the second argument to `jsonDeserialize` to undo the tags produced by `encode`.
   */
  reviver: JSONReviver;
}

/**
 * Composes typed codecs into an `encode`/`reviver` pair.
 * Use the result with `jsonSerialize` and `jsonDeserialize`.
 *
 * Wire format: a matched value becomes `{ $<name>: encoded }`.
 * The reviver only decodes objects with exactly one own key shaped `$<registered-name>`.
 * Unregistered shapes pass through untouched.
 *
 * Codecs are checked in the order they are passed.
 * The first matching `test` wins.
 *
 * @example
 * ```ts
 * const dateCodec: JSONCodec<Date> = {
 *   name: 'date',
 *   test: (v): v is Date => v instanceof Date,
 *   encode: (d) => d.toISOString(),
 *   decode: (raw) => new Date(raw as string),
 * }
 *
 * const { encode, reviver } = composeCodecs(dateCodec)
 *
 * const text = jsonSerialize(encode({ at: new Date('2026-06-11') }))
 * // -> '{"at":{"$date":"2026-06-11T00:00:00.000Z"}}'
 *
 * jsonDeserialize<{ at: Date }>(text, reviver).at instanceof Date
 * // -> true
 * ```
 */
export function composeCodecs(...codecs: JSONCodec<any>[]): ComposedCodecs {
  const byName = keyBy(codecs, (c) => c.name);

  function encode(value: unknown): unknown {
    for (const codec of codecs) {
      if (codec.test(value)) return { [`$${codec.name}`]: descend(codec.encode(value)) };
    }
    return descend(value);
  }

  function descend(value: unknown): unknown {
    if (isArray(value)) return value.map(encode);

    if (isPlainObject(value)) {
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(value)) out[key] = encode(value[key]);
      return out;
    }

    return value;
  }

  const reviver: JSONReviver = function reviver(_key, value) {
    if (!isPlainObject(value)) return value;

    const keys = Object.keys(value);
    if (keys.length !== 1) return value;

    const k = keys[0]!;
    if (k.length < 2 || k[0] !== '$') return value;

    const codec = byName[k.slice(1)];
    if (!codec) return value;

    return codec.decode(value[k]);
  };

  return { encode, reviver };
}
