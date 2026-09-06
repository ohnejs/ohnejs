import type { Env } from './env.ts';

import { createEnvRegistry, type EnvRegistry, nodeEnv } from '../../utils/env/index.ts';
import {
  coerceToBoolean,
  coerceToInteger,
  isBoolean,
  isDebugEnabled,
  isPort,
  MAX_PORT,
} from '../../utils/index.ts';

const registry: EnvRegistry<Env> = createEnvRegistry<Env>();

/**
 * Parses a boolean env var, accepting `1`/`true`/`0`/`false` case-insensitively.
 * Throws naming the var and the offending value when the raw string is none of those.
 * Pass it straight as a spec's `parse`; the registry supplies `name`.
 *
 * @example
 * ```ts
 * useEnv().define('MY_FLAG', { default: false, parse: boolEnv })
 * ```
 */
export function boolEnv(raw: string, name: string): boolean {
  const value = coerceToBoolean(raw);
  if (isBoolean(value)) return value;
  throw new Error(`\`${name}\` must be \`1\`/\`true\` or \`0\`/\`false\`, got \`${raw}\`.`);
}

registry.define('NODE_ENV', { default: 'development', parse: nodeEnv, flag: 'value' });
registry.define('PORT', {
  default: undefined,
  parse: (raw) => {
    const port = coerceToInteger(raw);
    if (!isPort(port))
      throw new Error(
        `\`PORT\` must be an integer between \`0\` and \`${MAX_PORT}\`, got \`${raw}\`.`,
      );
    return port;
  },
  flag: 'value',
});
registry.define('HOST', { default: undefined, parse: (raw) => raw, flag: 'value' });
registry.define('API_URL', { default: undefined, parse: (raw) => raw, flag: 'value' });
registry.define('DASHBOARD_URL', { default: undefined, parse: (raw) => raw, flag: 'value' });
registry.define('COOKIE_SECRET', { default: undefined, flag: 'value' });
registry.define('SILENT', { default: false, parse: boolEnv, flag: 'boolean' });
registry.define('DEBUG', {
  default: false,
  parse: (raw) => isDebugEnabled('ohne', raw),
  flag: 'boolean',
});
registry.define('NO_COLOR', { default: false, parse: (raw) => raw !== '', flag: 'boolean' });
registry.define('FORCE_COLOR', {
  default: undefined,
  parse: (raw) => coerceToBoolean(raw) !== false,
  flag: 'boolean',
});
registry.define('SKIP_CODEGEN', { default: false, parse: boolEnv, flag: 'boolean' });
registry.define('DASHBOARD_RELOAD', { default: false, parse: boolEnv, flag: 'boolean' });
registry.define('DATABASE', { default: undefined, parse: (raw) => raw, flag: 'value' });
registry.define('DB', { default: undefined, parse: (raw) => raw, flag: 'value' });
registry.define('FORCE_SYNC', { default: false, parse: boolEnv, flag: 'boolean' });

/**
 * Returns the process-wide env registry for `Env`.
 *
 * Resolution order: in-memory override, then `process.env`, then the spec's `default`.
 * `loadProjectEnv` fills `process.env` from the project's `.env` where the environment set nothing.
 * Use `set` to override a value for the current process (tests, runtime tweaks).
 * `set` never touches `process.env`.
 * Augment `Env` via `declare module 'ohne'` to add typed fields, then `define` them on first call.
 *
 * @example
 * ```ts
 * useEnv().get('SILENT')       // -> boolean
 * useEnv().set('SILENT', true)
 * useEnv().get('SILENT')       // -> true
 * useEnv().unset('SILENT')
 * ```
 */
export function useEnv(): EnvRegistry<Env> {
  return registry;
}
