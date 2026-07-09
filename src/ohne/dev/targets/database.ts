import type { SetTarget } from './set-target.ts';

import { isPathInside, joinPath } from '../../../utils/index.ts';
import { generateDatabase } from '../../codegen/generate-database.ts';
import { DIR_DEFAULTS } from '../../layers/config.ts';
import { useLayers } from '../../layers/use-layers.ts';

const DIRS = ['collections', 'fields', 'migrations'] as const;

/**
 * The database target.
 *
 * Its closure is every layer's `dirs.collections`, `dirs.fields`, and `dirs.migrations`.
 * The generated types depend on file contents, not just the set of files.
 * `regen` runs unconditionally and lets `generateDatabase` write only when its output changes.
 * Definitions re-import fresh, so an edited collection or field type is read again.
 * `invalidate` is a no-op for the same reason: there is no file-set snapshot to drop.
 */
export function createDatabaseTarget(from: string): SetTarget {
  return {
    id: 'database',
    affectedBy(changedPath) {
      return useLayers()
        .layers()
        .some((layer) =>
          DIRS.some((dir) =>
            isPathInside(
              changedPath,
              joinPath(layer.path, layer.input.dirs?.[dir] ?? DIR_DEFAULTS[dir]),
            ),
          ),
        );
    },
    async regen() {
      return generateDatabase(from, { fresh: true });
    },
    invalidate() {},
  };
}
