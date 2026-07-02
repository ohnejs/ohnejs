import type { SetTarget } from './set-target.ts';

import { isPathInside, joinPath } from '../../../utils/index.ts';
import { generateMessages } from '../../codegen/generate-messages.ts';
import { DIR_DEFAULTS } from '../../layers/config.ts';
import { useLayers } from '../../layers/use-layers.ts';

/**
 * The message catalog target.
 *
 * Its closure is every layer's `dirs.messages`; `affectedBy` is containment against those directories.
 * The catalog depends on file contents, not just the set of files.
 * `regen` runs unconditionally and lets `generateMessages` write only when its output changes.
 * One scan emits the shared, node, and browser buckets together.
 * `invalidate` is a no-op for the same reason: there is no file-set snapshot to drop.
 */
export function createMessagesTarget(from: string): SetTarget {
  return {
    id: 'messages',
    affectedBy(changedPath) {
      return useLayers()
        .layers()
        .some((layer) =>
          isPathInside(
            changedPath,
            joinPath(layer.path, layer.input.dirs?.messages ?? DIR_DEFAULTS.messages),
          ),
        );
    },
    async regen() {
      return generateMessages(from);
    },
    invalidate() {},
  };
}
