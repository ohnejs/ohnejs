/**
 * The name of the package manager in a user agent like `npm_config_user_agent`.
 * It is the first token, up to its `/version`.
 * Returns `undefined` for an absent or empty user agent.
 *
 * @example
 * ```ts
 * launcherName('npm/11.16.0 node/v26.3.0 darwin arm64') // -> 'npm'
 * launcherName('pnpm/11.5.1 npm/? node/v26.3.0')        // -> 'pnpm'
 * launcherName(undefined)                               // -> undefined
 * ```
 */
export function launcherName(userAgent: string | undefined): string | undefined {
  return userAgent?.match(/^[^\s/]+/)?.[0];
}
