import type { DeepPrettify } from '../../types/deep-prettify.ts';

/**
 * The value kind an argument parses into.
 */
export type ArgType = 'string' | 'number' | 'boolean' | 'enum';

/**
 * Fields shared by every argument definition.
 */
interface CommonArg {
  /**
   * Alternate name or names for the flag, in addition to its canonical key.
   * A single-character alias becomes a short flag (`-p`); longer ones become extra long flags.
   */
  alias?: string | string[];

  /**
   * Help text shown next to the flag in `--help` output.
   */
  description?: string;

  /**
   * Omit the flag from `--help` output.
   *
   * @default
   * false
   */
  hidden?: boolean;
}

/**
 * A string-valued argument.
 */
interface StringArg extends CommonArg {
  /**
   * Discriminant marking this as a string argument.
   */
  type: 'string';

  /**
   * Value used when the flag is absent.
   */
  default?: string;

  /**
   * Fail parsing when the flag is absent and no `default` is set.
   *
   * @default
   * false
   */
  required?: boolean;
}

/**
 * A number-valued argument.
 */
interface NumberArg extends CommonArg {
  /**
   * Discriminant marking this as a number argument.
   */
  type: 'number';

  /**
   * Truncate the value toward zero to a whole number.
   *
   * @default
   * false
   */
  integer?: boolean;

  /**
   * Value used when the flag is absent.
   */
  default?: number;

  /**
   * Fail parsing when the flag is absent and no `default` is set.
   *
   * @default
   * false
   */
  required?: boolean;
}

/**
 * A boolean-valued argument.
 * Always present in the resolved options, so it has no `required` field.
 */
interface BooleanArg extends CommonArg {
  /**
   * Discriminant marking this as a boolean argument.
   */
  type: 'boolean';

  /**
   * Value used when the flag is absent.
   *
   * @default
   * false
   */
  default?: boolean;
}

/**
 * An argument constrained to a fixed set of string values.
 */
interface EnumArg extends CommonArg {
  /**
   * Discriminant marking this as an enum argument.
   */
  type: 'enum';

  /**
   * The allowed values. Parsing fails when the input is none of them.
   */
  options: readonly string[];

  /**
   * Value used when the flag is absent. Must be one of `options`.
   */
  default?: string;

  /**
   * Fail parsing when the flag is absent and no `default` is set.
   *
   * @default
   * false
   */
  required?: boolean;
}

/**
 * A single argument definition.
 * The `type` field discriminates the shape: `enum` requires `options`, `number` accepts `integer`.
 */
export type ArgSchema = StringArg | NumberArg | BooleanArg | EnumArg;

/**
 * A set of argument definitions keyed by canonical (camelCase) name.
 */
export type ArgsSchema = Record<string, ArgSchema>;

type ArgValue<A extends ArgSchema> = A extends { type: 'boolean' }
  ? boolean
  : A extends { type: 'number' }
    ? number
    : A extends { type: 'enum'; options: readonly (infer O)[] }
      ? O
      : A extends { type: 'string' }
        ? string
        : never;

type IsDefined<A extends ArgSchema> = A extends { type: 'boolean' }
  ? true
  : A extends { default: {} }
    ? true
    : A extends { required: true }
      ? true
      : false;

/**
 * Maps an `ArgsSchema` to the typed options object `resolveArgs` produces on success.
 * A `boolean` arg, an arg with a `default`, and a `required` arg are always present.
 * Every other arg is optional.
 *
 * @example
 * ```ts
 * type Opts = ResolvedArgs<{
 *   name: { type: 'string'; required: true }
 *   port: { type: 'number'; default: 3000 }
 *   force: { type: 'boolean' }
 *   mode: { type: 'enum'; options: ['dev', 'prod'] }
 * }>
 * // -> { name: string; port: number; force: boolean; mode?: 'dev' | 'prod' }
 * ```
 */
export type ResolvedArgs<S extends ArgsSchema> = DeepPrettify<
  { [K in keyof S as IsDefined<S[K]> extends true ? K : never]: ArgValue<S[K]> } & {
    [K in keyof S as IsDefined<S[K]> extends true ? never : K]?: ArgValue<S[K]>;
  }
>;

/**
 * Identity helper that captures an `ArgsSchema` with its literal types intact.
 * Use it to define a schema once and reuse the inferred shape with `resolveArgs` and the command layer.
 *
 * @example
 * ```ts
 * const args = defineArgs({
 *   name: { type: 'string', required: true },
 *   port: { type: 'number', default: 3000, alias: 'p' },
 * })
 * ```
 */
export function defineArgs<const S extends ArgsSchema>(schema: S): S {
  return schema;
}
