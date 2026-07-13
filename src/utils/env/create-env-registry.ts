import { isUndefined } from '../is/is-undefined.ts';
import { ref, type Ref } from '../reactive/ref.ts';

/**
 * Specification for a single env var registered with `EnvRegistry.define`.
 */
export interface EnvSpec<T> {
  /**
   * Value returned by `get` when the env var is unset and no override has been applied.
   */
  default: T;

  /**
   * Converts the raw env-var string into the typed value.
   * Defaults to identity (the raw string passes through).
   * The var name arrives as the second argument, so a parser can name it when it throws.
   * Compose with single-arg parsers like `parseInteger`, `parseNumber`, or `parseBoolean`.
   */
  parse?: (raw: string, name: string) => T;

  /**
   * How this var is surfaced as a CLI flag, for tools that mirror env vars onto flags.
   * `'boolean'` is a switch (`--force-sync` / `--no-force-sync`); `'value'` takes a value (`--host x`).
   * Omitted means the var has no flag.
   */
  flag?: 'boolean' | 'value';
}

/**
 * Typed env-var registry.
 *
 * Each var is registered with `define`, gets a parser and a default, and can be read with `get`.
 * Reads consult an in-memory override first, then `process.env`, then the default.
 * Overrides are set with `set` and cleared with `unset` - `process.env` is never mutated.
 */
export interface EnvRegistry<E extends object> {
  /**
   * Registers `name` with the given spec.
   * Overwrites any previous spec for the same key.
   */
  define<K extends keyof E & string>(name: K, spec: EnvSpec<E[K]>): void;

  /**
   * Returns the resolved value for `name`.
   *
   * Resolution order:
   * 1. Override set via `set(name, ...)`.
   * 2. `process.env[name]` passed through the registered `parse` (identity by default).
   * 3. The spec's `default`.
   *
   * Throws when `name` was never `define`d.
   */
  get<K extends keyof E & string>(name: K): E[K];

  /**
   * Sets an in-memory override for `name`.
   * Subsequent `get` calls return `value` until `unset` is called.
   * Does not mutate `process.env`.
   */
  set<K extends keyof E & string>(name: K, value: E[K]): void;

  /**
   * Sets an in-memory override for `name` from a raw string, parsed as a `process.env[name]` value would be.
   * Runs the registered `parse` (identity by default), so a flag's value gets the exact env validation.
   * Does not mutate `process.env`.
   */
  setRaw<K extends keyof E & string>(name: K, raw: string): void;

  /**
   * Removes any in-memory override for `name`.
   * Returns `true` if an override was cleared.
   */
  unset<K extends keyof E & string>(name: K): boolean;

  /**
   * Returns `true` when an override exists or `process.env[name]` is set.
   */
  has<K extends keyof E & string>(name: K): boolean;

  /**
   * Returns every defined var name in registration order.
   */
  names(): readonly (keyof E & string)[];

  /**
   * Returns the CLI flag kind registered for `name` via its spec, or `undefined` when it has none.
   */
  flag<K extends keyof E & string>(name: K): 'boolean' | 'value' | undefined;
}

interface Slot {
  has: boolean;
  value: unknown;
}

/**
 * Creates a typed env-var registry.
 *
 * `get` returns the override (if any), then the parsed `process.env` value (if any), then the default.
 * `set` stores an in-memory override; `unset` clears it.
 * `process.env` is read but never mutated.
 *
 * @example
 * ```ts
 * interface Env { PORT: number; SILENT: boolean }
 *
 * const env = createEnvRegistry<Env>()
 * env.define('PORT',   { default: 3000,  parse: parseInteger })
 * env.define('SILENT', { default: false, parse: parseBoolean })
 *
 * env.get('PORT')   // -> 3000 (or parsed process.env.PORT)
 * env.set('SILENT', true)
 * env.get('SILENT') // -> true (override wins)
 * env.unset('SILENT')
 * env.get('SILENT') // -> false (or parsed process.env.SILENT)
 * ```
 */
export function createEnvRegistry<E extends object>(): EnvRegistry<E> {
  const specs = new Map<string, EnvSpec<unknown>>();
  const slots = new Map<string, Ref<Slot>>();

  function slot(name: string): Ref<Slot> {
    let s = slots.get(name);
    if (isUndefined(s)) {
      s = ref<Slot>({ has: false, value: undefined });
      slots.set(name, s);
    }
    return s;
  }

  return {
    define(name, spec) {
      specs.set(name, spec as EnvSpec<unknown>);
      slot(name);
    },
    get(name) {
      const s = slot(name).value;
      if (s.has) return s.value as never;
      const spec = specs.get(name);
      if (isUndefined(spec)) throw new Error(`Env var not defined: ${name}`);
      const raw = process.env[name];
      if (isUndefined(raw)) return spec.default as never;
      return (isUndefined(spec.parse) ? raw : spec.parse(raw, name)) as never;
    },
    set(name, value) {
      slot(name).value = { has: true, value };
    },
    setRaw(name, raw) {
      const spec = specs.get(name);
      if (isUndefined(spec)) throw new Error(`Env var not defined: ${name}`);
      slot(name).value = {
        has: true,
        value: isUndefined(spec.parse) ? raw : spec.parse(raw, name),
      };
    },
    unset(name) {
      const s = slots.get(name);
      if (isUndefined(s) || !s.value.has) return false;
      s.value = { has: false, value: undefined };
      return true;
    },
    has(name) {
      if (slot(name).value.has) return true;
      return !isUndefined(process.env[name]);
    },
    names() {
      return [...specs.keys()] as unknown as readonly (keyof E & string)[];
    },
    flag(name) {
      return specs.get(name)?.flag;
    },
  };
}
