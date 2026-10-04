import type { ArgsSchema, FlagValue } from '../../utils/cli/index.ts';
import type { Env } from './env.ts';

import { codeSpan } from '../../utils/ansi/index.ts';
import { parseArgv } from '../../utils/cli/index.ts';
import {
  coerceToBoolean,
  isArray,
  isBoolean,
  isString,
  isUndefined,
  last,
  toCamelCase,
  toKebabCase,
} from '../../utils/index.ts';
import { useEnv } from './use-env.ts';

interface EnvFlag {
  env: keyof Env & string;
  kebab: string;
  camel: string;
  kind: 'boolean' | 'value';
}

/**
 * Every registered env var that opts into a CLI flag, resolved to its kebab flag and camel arg key.
 * The CLI reads the registry before any layer loads, so only the built-in env vars resolve here.
 * Given `only`, the env vars outside it are left out.
 */
function envFlags(only?: Iterable<keyof Env & string>): EnvFlag[] {
  const env = useEnv();
  const kept = isUndefined(only) ? undefined : new Set<string>(only);
  const flags: EnvFlag[] = [];
  for (const name of env.names()) {
    if (kept && !kept.has(name)) continue;
    const kind = env.flag(name);
    if (isUndefined(kind)) continue;
    const kebab = toKebabCase(name);
    flags.push({ env: name, kebab, camel: toCamelCase(kebab), kind });
  }
  return flags;
}

/**
 * The env vars' CLI flags as a `runCommand` `globals` schema.
 *
 * Each flagged var becomes one flag: a `'boolean'` var a switch, a `'value'` var a value flag.
 * `runCommand` uses it to recognize the flags on every subcommand and to list them in the root help.
 * The keys are the camelCase arg names; the raw values are applied by `applyEnvFlags`.
 * Given `only`, the schema holds just those env vars' flags.
 *
 * @example
 * ```ts
 * runCommand(ohne, argv, { globals: envGlobals() })
 * runCommand(create, argv, { globals: envGlobals(['NO_COLOR', 'SILENT']) })
 * ```
 */
export function envGlobals(only?: Iterable<keyof Env & string>): ArgsSchema {
  const schema: ArgsSchema = {};
  for (const { env, camel, kind } of envFlags(only)) {
    schema[camel] =
      kind === 'boolean'
        ? { type: 'boolean', description: `Sets ${env}` }
        : { type: 'string', description: `Sets ${env}` };
  }
  return schema;
}

/**
 * Applies the env-var flags found in `argv` as overrides on the env registry, highest priority.
 *
 * Only flags actually present are applied, so an absent flag never clobbers env or config.
 * A flag matches its env var's kebab name in any spelling, exactly as `resolveArgs` recognizes it.
 * A boolean flag sets the value directly.
 * A value flag routes its raw string through the env parser, so `--port 99999` fails like `PORT=99999`.
 * Given `only`, the flags of other env vars are neither parsed nor applied.
 * Meant to run once, before dispatch.
 *
 * @example
 * ```ts
 * applyEnvFlags(process.argv.slice(2)) // --no-color -> NO_COLOR, --host x -> HOST, ...
 * ```
 */
export function applyEnvFlags(argv: string[], only?: Iterable<keyof Env & string>): void {
  const env = useEnv();

  for (const { env: name, kebab, kind, value } of presentEnvFlags(argv, only)) {
    if (kind === 'boolean') {
      const bool = coerceToBoolean(value);
      if (!isBoolean(bool)) {
        throw new Error(
          `\`--${kebab}\` must be \`true\` or \`false\`, got ${codeSpan(`${value}`)}.`,
        );
      }
      env.set(name, bool as Env[typeof name]);
    } else {
      if (!isString(value)) throw new Error(`\`--${kebab}\` needs a value.`);
      env.setRaw(name, value);
    }
  }
}

/**
 * The env-var flags present in `argv`, each as one `--kebab=value` token, for a child process to apply.
 * Flags whose env var is named in `omit` are left out, so a value the parent sets for the child wins.
 *
 * @example
 * ```ts
 * envFlagArgs(['dev', '--host', '127.0.0.1', '--no-color', '--port', '4000'], ['PORT'])
 * // -> ['--host=127.0.0.1', '--no-color=true']
 * ```
 */
export function envFlagArgs(argv: string[], omit: Iterable<string> = []): string[] {
  const omitted = new Set(omit);
  return presentEnvFlags(argv)
    .filter(({ env }) => !omitted.has(env))
    .map(({ kebab, value }) => `--${kebab}=${value}`);
}

/**
 * The env-var flags present in `argv`, each with its last given value, limited to `only` when given.
 */
function presentEnvFlags(
  argv: string[],
  only?: Iterable<keyof Env & string>,
): Array<EnvFlag & { value: string | boolean }> {
  const flags = envFlags(only);
  const booleans = flags.filter((flag) => flag.kind === 'boolean').map((flag) => flag.kebab);
  const { flags: parsed } = parseArgv(argv, { booleans });
  const byKebab: Record<string, FlagValue> = Object.create(null);
  for (const [key, value] of Object.entries(parsed)) byKebab[toKebabCase(key)] = value;

  const present: Array<EnvFlag & { value: string | boolean }> = [];
  for (const flag of flags) {
    const raw = byKebab[flag.kebab];
    if (isUndefined(raw)) continue;
    present.push({ ...flag, value: isArray(raw) ? last(raw)! : raw });
  }
  return present;
}
