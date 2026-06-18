import type { ArgSchema, ArgsSchema, ResolvedArgs } from './define-args.ts';

import { last } from '../../array/last.ts';
import { toArray } from '../../array/to-array.ts';
import { toCamelCase } from '../../case/to-camel-case.ts';
import { toKebabCase } from '../../case/to-kebab-case.ts';
import { coerceToBoolean } from '../../coerce/coerce-to-boolean.ts';
import { coerceToInteger } from '../../coerce/coerce-to-integer.ts';
import { coerceToNumber } from '../../coerce/coerce-to-number.ts';
import { didYouMean } from '../../did-you-mean/did-you-mean.ts';
import { isArray } from '../../is/is-array.ts';
import { isBoolean } from '../../is/is-boolean.ts';
import { isNumber } from '../../is/is-number.ts';
import { isString } from '../../is/is-string.ts';
import { isUndefined } from '../../is/is-undefined.ts';
import { parseArgv } from './parse-argv.ts';

/**
 * Why a flag failed to resolve.
 * `unknown`: not declared in the schema; `missing`: required but absent; `invalid`: wrong value.
 */
export type ArgErrorKind = 'unknown' | 'missing' | 'invalid';

/**
 * A single resolution failure.
 */
export interface ArgError {
  /**
   * The failure category.
   */
  kind: ArgErrorKind;

  /**
   * The flag name involved, without the leading dash.
   */
  name: string;

  /**
   * Human-readable explanation, ready to print.
   */
  message: string;

  /**
   * Closest known flag or option, when one is near enough to suggest.
   */
  suggestion?: string;
}

/**
 * The outcome of `resolveArgs`.
 * `values` is present and fully typed only when `ok` is `true`; otherwise `errors` lists every failure.
 * `positionals` is always carried through from the parse.
 */
export type ResolveArgsResult<S extends ArgsSchema> =
  | { ok: true; values: ResolvedArgs<S>; positionals: string[] }
  | { ok: false; errors: ArgError[]; positionals: string[] };

/**
 * Parses `argv` against a schema and resolves typed option values.
 * Applies aliases, coercion, defaults, and required checks, and reports unknown flags with a hint.
 * A long flag matches its schema key in camelCase or kebab-case, so `--full-flag` resolves `fullFlag`.
 * A scalar flag repeated under one name takes its last value.
 * When a flag is given under both its canonical name and an alias, the canonical name wins.
 *
 * @example
 * ```ts
 * const schema = { port: { type: 'number', default: 3000, alias: 'p' } } as const
 *
 * resolveArgs(schema, ['-p', '8080'])
 * // -> { ok: true, values: { port: 8080 }, positionals: [] }
 *
 * const bad = resolveArgs(schema, ['--prot', '80'])
 * if (!bad.ok) bad.errors[0].suggestion // -> 'port'
 * ```
 */
export function resolveArgs<const S extends ArgsSchema>(
  schema: S,
  argv: string[],
): ResolveArgsResult<S> {
  const names = Object.keys(schema);
  const aliasToName = new Map<string, string>();
  const canonByForm = new Map<string, string>();
  const booleans: string[] = [];

  for (const name of names) {
    canonByForm.set(toCamelCase(name), name);
    const def = schema[name]!;
    const aliases = toArray(def.alias ?? []);
    for (const alias of aliases) aliasToName.set(alias, name);
    if (def.type === 'boolean') booleans.push(name, toKebabCase(name), ...aliases);
  }

  const parsed = parseArgv(argv, { booleans });
  const errors: ArgError[] = [];
  const values: Record<string, string | number | boolean> = {};

  for (const flag of Object.keys(parsed.flags)) {
    if (aliasToName.has(flag) || canonByForm.has(toCamelCase(flag))) continue;
    const suggestion = didYouMean(toCamelCase(flag), names);
    errors.push({
      kind: 'unknown',
      name: flag,
      message: `Unknown flag \`--${flag}\`${suggestion ? `. Did you mean \`--${suggestion}\`?` : ''}`,
      ...(suggestion ? { suggestion } : {}),
    });
  }

  for (const name of names) {
    const def = schema[name]!;
    const raw = pickRaw(parsed.flags, name, def.alias);

    if (isUndefined(raw)) {
      if (def.type === 'boolean') values[name] = def.default ?? false;
      else if (!isUndefined(def.default)) values[name] = def.default;
      else if (def.required) {
        errors.push({ kind: 'missing', name, message: `Missing required flag \`--${name}\`` });
      }
      continue;
    }

    const result = coerceValue(def, raw, name);
    if ('error' in result) errors.push({ kind: 'invalid', name, message: result.error });
    else values[name] = result.value;
  }

  if (errors.length > 0) return { ok: false, errors, positionals: parsed.positionals };
  return { ok: true, values: values as ResolvedArgs<S>, positionals: parsed.positionals };
}

function pickRaw(
  flags: Record<string, string | boolean | Array<string | boolean>>,
  name: string,
  alias: string | string[] | undefined,
): string | boolean | undefined {
  const target = toCamelCase(name);
  for (const key of Object.keys(flags)) {
    if (toCamelCase(key) !== target) continue;
    const value = flags[key];
    return isArray(value) ? last(value) : value;
  }
  for (const key of toArray(alias ?? [])) {
    const value = flags[key];
    if (isUndefined(value)) continue;
    return isArray(value) ? last(value) : value;
  }
  return undefined;
}

function coerceValue(
  def: ArgSchema,
  raw: string | boolean,
  name: string,
): { value: string | number | boolean } | { error: string } {
  switch (def.type) {
    case 'string':
      if (isString(raw)) return { value: raw };
      return { error: `Flag \`--${name}\` expects a value` };

    case 'number': {
      if (!isString(raw)) return { error: `Flag \`--${name}\` expects a number` };
      const parsed = def.integer ? coerceToInteger(raw) : coerceToNumber(raw);
      if (isNumber(parsed)) return { value: parsed };
      return { error: `Flag \`--${name}\` expects a number, got \`${raw}\`` };
    }

    case 'boolean': {
      const parsed = coerceToBoolean(raw);
      if (isBoolean(parsed)) return { value: parsed };
      return { error: `Flag \`--${name}\` expects a boolean, got \`${raw}\`` };
    }

    case 'enum': {
      if (isString(raw) && def.options.includes(raw)) return { value: raw };
      const list = def.options.map((option) => `\`${option}\``).join(', ');
      const hint = isString(raw) ? didYouMean(raw, def.options) : undefined;
      const suffix = hint ? `. Did you mean \`${hint}\`?` : '';
      return { error: `Flag \`--${name}\` must be one of ${list}${suffix}` };
    }
  }
}
