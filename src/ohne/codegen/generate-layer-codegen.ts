import type { LayerCodegen } from '../layers/define-layer.ts';

import { createCodeGenerator } from '../../utils/codegen/index.ts';
import { basename, isNull, isUndefined, joinPath } from '../../utils/index.ts';
import { ohneError } from '../error/ohne-error.ts';
import { useLayers } from '../layers/use-layers.ts';
import { BANNER, codegenDir } from './codegen-dir.ts';

const PLAIN_TS_NAME = /^[\w-]+(?:\.[\w-]+)*\.ts$/;

/**
 * Generates every file the stacked layers declare under `codegen` in their `ohne.layer.ts`.
 *
 * Layers run furthest-first.
 * Each entry's `code` runs against the loaded stack, so it reads the merged config.
 * Layers come from the registered stack, so `loadLayers` must have run first.
 * Output lands in the entry's bucket under the app's `dirs.codegen` (default `.ohne`), banner first.
 * A `file` that is not a plain `.ts` name, or one two entries claim, throws naming the layer and the file.
 *
 * The app root is the nearest `package.json` above `from` (default `process.cwd()`).
 * Each file is rewritten only when its contents change.
 * Returns the absolute paths written, empty when no `package.json` is found.
 */
export async function generateLayerCodegen(from: string = process.cwd()): Promise<string[]> {
  const dir = await codegenDir(from);
  if (isNull(dir)) return [];

  const owners = new Map<string, string>();
  const entries: LayerCodegen[] = [];
  for (const layer of useLayers().layers()) {
    const name = layer.name ?? basename(layer.path);
    for (const entry of layer.codegen ?? []) {
      if (!PLAIN_TS_NAME.test(entry.file)) {
        throw ohneError({
          title: `Invalid codegen file \`${entry.file}\``,
          body: [
            `\`${name}\` declares it, but a codegen file is a plain \`.ts\` name like \`my-types.ts\`.`,
            'Drop any directory; `bucket` already picks one.',
          ],
        });
      }
      const target = `${entry.bucket}/${entry.file}`;
      const owner = owners.get(target);
      if (!isUndefined(owner)) {
        throw ohneError({
          title: `Codegen file \`${entry.file}\` is claimed twice`,
          body: [
            `\`${owner}\` and \`${name}\` both generate \`${target}\`.`,
            'Give each entry a file name of its own.',
          ],
        });
      }
      owners.set(target, name);
      entries.push(entry);
    }
  }

  return Promise.all(
    entries.map(async (entry) => {
      const gen = createCodeGenerator({ dir: joinPath(dir, entry.bucket), banner: BANNER });
      await gen.write(entry.file, await entry.code());
      return gen.path(entry.file);
    }),
  );
}
