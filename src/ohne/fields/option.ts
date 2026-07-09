import { hasKey } from '../../utils/index.ts';

/**
 * One option a field type declares under `defineField({ options })`.
 * Carries the value type `T`, whether it is `required`, and its `default` at the type level.
 * Authored with `option()`; a collection rarely writes this type by hand.
 */
export interface OptionDef<T = unknown, R extends boolean = false, D = undefined> {
  /**
   * Phantom carrier for the value type `T`, read back with `infer`; never set at runtime.
   */
  readonly __value?: T;

  /**
   * Whether the collection author must pass this option.
   */
  readonly required: R;

  /**
   * The value used when an optional option is omitted; `undefined` for a required option.
   */
  readonly default: D;
}

/**
 * Any `OptionDef`, used to constrain a record of declared options.
 */
export type AnyOptionDef = OptionDef<unknown, boolean, unknown>;

/**
 * Argument to `option()` for an optional option carrying a default.
 */
export interface OptionWithDefault<T> {
  /**
   * The value applied when the option is omitted.
   * Its type is widened to the primitive (`'a'` -> `string`); use `as const` to keep the literal.
   */
  default: T;

  /**
   * Forbidden here: a defaulted option is optional by definition.
   */
  required?: false;
}

/**
 * Argument to `option()` for a required option, which the collection author must pass.
 */
export interface OptionRequired {
  /**
   * Marks the option required.
   */
  required: true;

  /**
   * Forbidden here: a required option has no reachable default.
   */
  default?: never;
}

/**
 * The value type an `OptionDef` carries.
 */
export type OptionValue<O> = O extends OptionDef<infer T, boolean, unknown> ? T : never;

/**
 * The keys of `O` declared with `required: true`.
 */
export type RequiredOptionKeys<O> = {
  [K in keyof O]: O[K] extends OptionDef<unknown, true, unknown> ? K : never;
}[keyof O];

/**
 * The keys of `O` that are optional: the complement of `RequiredOptionKeys`.
 */
export type OptionalOptionKeys<O> = Exclude<keyof O, RequiredOptionKeys<O>>;

/**
 * The consumer-facing object a declared-options record resolves to.
 * Required options become required keys; optional options become `?:` keys.
 * Each half maps over `keyof Pick<O, ...>`, so the mapping stays homomorphic.
 * A homomorphic mapping keeps each option's own JSDoc, which shows on hover at a `field(...)` call.
 */
export type ResolveOptions<O> = {
  [K in keyof Pick<O, RequiredOptionKeys<O> & keyof O>]: OptionValue<O[K]>;
} & {
  [K in keyof Pick<O, OptionalOptionKeys<O> & keyof O>]?: OptionValue<O[K]>;
};

/**
 * Whether a declared-options record has at least one required option.
 */
export type HasRequiredOption<O> = [RequiredOptionKeys<O>] extends [never] ? false : true;

/**
 * The keys of `O` present after resolution: required options, and optional options carrying a default.
 * An optional option declared without a default stays absent when omitted, so it is not here.
 */
export type ResolvedRequiredKeys<O> = {
  [K in keyof O]: O[K] extends OptionDef<unknown, true, unknown>
    ? K
    : O[K] extends OptionDef<unknown, false, infer D>
      ? [D] extends [undefined]
        ? never
        : K
      : never;
}[keyof O];

/**
 * The keys of `O` still optional after resolution: optional options declared without a default.
 */
export type ResolvedOptionalKeys<O> = Exclude<keyof O, ResolvedRequiredKeys<O>>;

/**
 * A declared-options record after resolution, with every default applied.
 * A required option, and an optional option carrying a default, are always present.
 * An optional option declared without a default stays `?:`, since omission leaves it absent.
 * Distinct from `ResolveOptions`, the `field(...)` call-site shape where every default is omittable.
 */
export type ResolvedOptions<O> = {
  [K in keyof Pick<O, ResolvedRequiredKeys<O> & keyof O>]: OptionValue<O[K]>;
} & {
  [K in keyof Pick<O, ResolvedOptionalKeys<O> & keyof O>]?: OptionValue<O[K]>;
};

/**
 * Declares one option on a field type's `options` map.
 *
 * `required: true` and `default` are mutually exclusive: a required option has no reachable default.
 * A value type given only by `default` is widened to its primitive; pass a generic to keep a union.
 *
 * @example
 * ```ts
 * option()                            // -> OptionDef<unknown, false, undefined>
 * option<string>()                    // -> OptionDef<string, false, undefined>
 * option({ default: 255 })            // -> OptionDef<number, false, number>
 * option<'a' | 'b'>({ default: 'a' }) // -> OptionDef<'a' | 'b', false, 'a' | 'b'>
 * option<string>({ required: true })  // -> OptionDef<string, true, undefined>
 * ```
 */
export function option(): OptionDef<unknown, false, undefined>;
export function option<T>(): OptionDef<T, false, undefined>;
export function option<T>(spec: OptionWithDefault<T>): OptionDef<T, false, T>;
export function option<T = unknown>(spec: OptionRequired): OptionDef<T, true, undefined>;
export function option(spec?: OptionWithDefault<unknown> | OptionRequired): AnyOptionDef {
  return {
    required: spec?.required ?? false,
    default: spec && hasKey(spec, 'default') ? spec.default : undefined,
  };
}
