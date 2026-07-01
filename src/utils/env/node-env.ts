/**
 * The three canonical Node runtime environments.
 *
 * `NODE_ENV` normalizes to one of these values.
 * `'production'` and `'test'` match exactly; every other value, and unset, is `'development'`.
 */
export type NodeEnv = 'production' | 'development' | 'test';

/**
 * Normalizes a raw `NODE_ENV` string to a `NodeEnv`.
 * `'production'` and `'test'` match exactly; every other value, and unset, is `'development'`.
 * Defaulting the unknown to `'development'` keeps production an explicit, deliberate choice.
 *
 * @example
 * ```ts
 * nodeEnv('production') // -> 'production'
 * nodeEnv('test')       // -> 'test'
 * nodeEnv('staging')    // -> 'development'
 * nodeEnv(undefined)    // -> 'development'
 * ```
 */
export function nodeEnv(raw: string | undefined = process.env.NODE_ENV): NodeEnv {
  if (raw === 'production') return 'production';
  if (raw === 'test') return 'test';
  return 'development';
}

/**
 * Whether the process runs in production, i.e. `NODE_ENV=production`.
 * Reads `process.env.NODE_ENV` unless a raw value is passed.
 *
 * @example
 * ```ts
 * isProduction('production')  // -> true
 * isProduction('development') // -> false
 * ```
 */
export function isProduction(raw: string | undefined = process.env.NODE_ENV): boolean {
  return nodeEnv(raw) === 'production';
}

/**
 * Whether the process runs in development, the default when `NODE_ENV` is unset or unrecognized.
 * Reads `process.env.NODE_ENV` unless a raw value is passed.
 *
 * @example
 * ```ts
 * isDevelopment('development') // -> true
 * isDevelopment('production')  // -> false
 * isDevelopment(undefined)     // -> true
 * ```
 */
export function isDevelopment(raw: string | undefined = process.env.NODE_ENV): boolean {
  return nodeEnv(raw) === 'development';
}

/**
 * Whether the process runs under test, i.e. `NODE_ENV=test`.
 * Reads `process.env.NODE_ENV` unless a raw value is passed.
 *
 * @example
 * ```ts
 * isTest('test')        // -> true
 * isTest('development') // -> false
 * ```
 */
export function isTest(raw: string | undefined = process.env.NODE_ENV): boolean {
  return nodeEnv(raw) === 'test';
}
