import type { ArgsSchema, FlagValue } from '../../utils/cli/index.ts';
import type { Env } from './env.ts';

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
 */
function envFlags(): EnvFlag[] {
  const env = useEnv();
  const flags: EnvFlag[] = [];
  for (const name of env.names()) {
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
 *
 * @example
 * ```ts
 * runCommand(ohne, argv, { globals: envGlobals() })
 * ```
 */
export function envGlobals(): ArgsSchema {
  const schema: ArgsSchema = {};
  for (const { env, camel, kind } of envFlags()) {
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
 * Meant to run once, before dispatch.
 *
 * @example
 * ```ts
 * applyEnvFlags(process.argv.slice(2)) // --no-color -> NO_COLOR, --host x -> HOST, ...
 * ```
 */
export function applyEnvFlags(argv: string[]): void {
  const flags = envFlags();
  const booleans = flags.filter((flag) => flag.kind === 'boolean').map((flag) => flag.kebab);
  const { flags: parsed } = parseArgv(argv, { booleans });
  const byKebab: Record<string, FlagValue> = Object.create(null);
  for (const [key, value] of Object.entries(parsed)) byKebab[toKebabCase(key)] = value;
  const env = useEnv();

  for (const { env: name, kebab, kind } of flags) {
    const raw = byKebab[kebab];
    if (isUndefined(raw)) continue;
    const value = isArray(raw) ? last(raw) : raw;

    if (kind === 'boolean') {
      const bool = coerceToBoolean(value);
      if (!isBoolean(bool)) {
        throw new Error(`\`--${kebab}\` must be \`true\` or \`false\`, got \`${value}\`.`);
      }
      env.set(name, bool as Env[typeof name]);
    } else {
      if (!isString(value)) throw new Error(`\`--${kebab}\` needs a value.`);
      env.setRaw(name, value);
    }
  }
}
