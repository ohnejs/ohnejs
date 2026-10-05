import pkg from '../../../package.json' with { type: 'json' };

/**
 * The current `ohnejs` version, sourced from `package.json`.
 *
 * @example
 * ```ts
 * import { version } from 'ohnejs'
 *
 * console.log(`ohne v${version}`)
 * ```
 */
export const version: string = pkg.version;
