import type { DeepPrettify } from '../../types/deep-prettify.ts';

/**
 * The value kind an argument parses into.
 */
export type ArgType = 'string' | 'number' | 'boolean' | 'enum';

interface CommonArg {
  alias?: string | string[];
  description?: string;
  hidden?: boolean;
}

interface StringArg extends CommonArg {
  type: 'string';
  default?: string;
  required?: boolean;
}

interface NumberArg extends CommonArg {
  type: 'number';
  integer?: boolean;
  default?: number;
  required?: boolean;
}

interface BooleanArg extends CommonArg {
  type: 'boolean';
  default?: boolean;
}

interface EnumArg extends CommonArg {
  type: 'enum';
  options: readonly string[];
  default?: string;
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
