/**
 * The operating-system families that change key bindings.
 * `mod` resolves to Command on `'mac'` and Control on `'win'` and `'linux'`.
 */
export type Platform = 'mac' | 'win' | 'linux';

/**
 * Detects the current platform from the host runtime.
 * Reads Node's `process.platform` first, then falls back to the browser `navigator`.
 * Returns `'linux'` when nothing else matches.
 *
 * @example
 * ```ts
 * detectPlatform() // -> 'mac' on darwin
 * ```
 */
export function detectPlatform(): Platform {
  const proc = (globalThis as { process?: { platform?: string } }).process;
  if (proc?.platform) {
    if (proc.platform === 'darwin') return 'mac';
    if (proc.platform === 'win32') return 'win';
    return 'linux';
  }

  const nav = (globalThis as { navigator?: { platform?: string; userAgent?: string } }).navigator;
  const hint = `${nav?.platform ?? ''} ${nav?.userAgent ?? ''}`;
  if (/Mac|iPhone|iPad/.test(hint)) return 'mac';
  if (/Win/.test(hint)) return 'win';
  return 'linux';
}
