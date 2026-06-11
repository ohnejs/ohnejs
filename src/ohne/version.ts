import pkg from '../../package.json' with { type: 'json' };

/**
 * The current `ohne` version, sourced from `package.json`.
 *
 * @example
 * ```ts
 * import { version } from 'ohne'
 *
 * version // -> '0.0.1'
 * ```
 */
export const version: string = pkg.version;
