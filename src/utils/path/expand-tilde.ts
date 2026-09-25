const TILDE = /^~(?=$|[/\\])/;

/**
 * Replaces a leading `~` segment in `path` with `home`.
 * Only a bare `~` or one followed by a separator counts, so `~bob` and `a/~` stay as they are.
 *
 * @example
 * ```ts
 * expandTilde('~/apps/x', '/home/me') // -> '/home/me/apps/x'
 * expandTilde('~', '/home/me')        // -> '/home/me'
 * expandTilde('~bob/x', '/home/me')   // -> '~bob/x'
 * expandTilde('./~/x', '/home/me')    // -> './~/x'
 * ```
 */
export function expandTilde(path: string, home: string): string {
  return path.replace(TILDE, () => home);
}
