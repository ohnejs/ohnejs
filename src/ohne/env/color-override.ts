import { useEnv } from './use-env.ts';

/**
 * The ANSI color override resolved from env.
 * `NO_COLOR` (any non-empty value) forces color off; otherwise `FORCE_COLOR` decides.
 *
 * Returns `undefined` when neither is set.
 * The caller then falls back to TTY detection with `isColorStream` against its own stream.
 *
 * @example
 * ```ts
 * createPrompt({ color: colorOverride() })
 * pickANSIColors(colorOverride() ?? isColorStream(process.stdout))
 * ```
 */
export function colorOverride(): boolean | undefined {
  return useEnv().get('NO_COLOR') ? false : useEnv().get('FORCE_COLOR');
}
