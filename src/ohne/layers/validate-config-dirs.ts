import type { Config } from './config.ts';

import { isPathInside, normalizePath } from '../../utils/index.ts';
import { ohneError } from '../error/ohne-error.ts';
import { DIR_DEFAULTS } from './config.ts';

/**
 * Throws when a layer's configured `dirs` nest inside one another.
 *
 * Each key is resolved to its set value or its `DIR_DEFAULTS` fallback, then every pair is compared.
 * Two directories overlap when they resolve to the same path or when one is nested beneath the other.
 * So a single override that lands on another key's default (`api: 'messages'`) is caught too.
 * The check is lexical; it never touches the disk.
 *
 * @example
 * ```ts
 * validateConfigDirs({ api: 'src', messages: 'src/messages' }, file)
 * // `api` contains `messages`
 *
 * validateConfigDirs({ api: 'messages' }, file)
 * // clashes with default `messages`
 *
 * validateConfigDirs({ api: 'routes' }, file)
 * // ok
 * ```
 */
export function validateConfigDirs(dirs: NonNullable<Config['dirs']>, configFile: string): void {
  const keys = Object.keys(DIR_DEFAULTS) as (keyof typeof DIR_DEFAULTS)[];
  const entries = keys.map((key) => ({ key, value: dirs[key] ?? DIR_DEFAULTS[key] }));

  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const a = entries[i];
      const b = entries[j];

      if (normalizePath(a.value) === normalizePath(b.value)) {
        throw ohneError({
          title: 'Overlapping directories in `dirs`',
          body: [
            `\`${a.key}\` and \`${b.key}\` both point at \`${normalizePath(a.value)}\`.`,
            'Each configured directory must be its own; point them at paths that do not nest.',
          ],
          path: configFile,
        });
      }

      if (isPathInside(a.value, b.value) || isPathInside(b.value, a.value)) {
        const [outer, inner] = isPathInside(a.value, b.value) ? [b, a] : [a, b];
        throw ohneError({
          title: 'Overlapping directories in `dirs`',
          body: [
            `\`${outer.key}\` (\`${outer.value}\`) contains \`${inner.key}\` (\`${inner.value}\`).`,
            'Each configured directory must be its own; point them at paths that do not nest.',
          ],
          path: configFile,
        });
      }
    }
  }
}
