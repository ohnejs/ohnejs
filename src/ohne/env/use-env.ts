import type { Env } from './env.ts';

import { createEnvRegistry, type EnvRegistry } from '../../utils/env/index.ts';
import {
  coerceToBoolean,
  coerceToInteger,
  isDebugEnabled,
  isPort,
  MAX_PORT,
  parseBoolean,
} from '../../utils/index.ts';

const registry: EnvRegistry<Env> = createEnvRegistry<Env>();

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
});
registry.define('HOST', { default: undefined, parse: (raw) => raw });
registry.define('API_URL', { default: undefined, parse: (raw) => raw });
registry.define('COOKIE_SECRET', { default: undefined });
registry.define('SILENT', { default: false, parse: parseBoolean });
registry.define('DEBUG', { default: false, parse: (raw) => isDebugEnabled('ohne', raw) });
registry.define('NO_COLOR', { default: false, parse: (raw) => raw !== '' });
registry.define('FORCE_COLOR', {
  default: undefined,
  parse: (raw) => coerceToBoolean(raw) !== false,
});
registry.define('SKIP_CODEGEN', { default: false, parse: parseBoolean });

/**
 * Returns the process-wide env registry for `Env`.
 *
 * Resolution order: in-memory override, then `process.env`, then the spec's `default`.
 * Use `set` to override a value for the current process (tests, runtime tweaks).
 * `process.env` is not mutated.
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
