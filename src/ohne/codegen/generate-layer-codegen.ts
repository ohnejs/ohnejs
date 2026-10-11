import type { BucketCodegen, LayerCodegen, LayerCodegenContext } from '../layers/define-layer.ts';

import { createCodeGenerator } from '../../utils/codegen/index.ts';
import { writeFileIfChanged } from '../../utils/fs/index.ts';
import {
  basename,
  isNull,
  isPathInside,
  isUndefined,
  joinPath,
  relativePath,
  resolvePath,
} from '../../utils/index.ts';
import { ohneError } from '../error/ohne-error.ts';
import { useLayers } from '../layers/use-layers.ts';
import { appRoot, BANNER, codegenDir } from './codegen-dir.ts';
import { withStackRegistries } from './with-stack-registries.ts';

const PLAIN_TS_NAME = /^[\w-]+(?:\.[\w-]+)*\.ts$/;

const OHNE_FILES = new Set([
  'collections.ts',
  'database.ts',
  'flows.ts',
  'layer-name.ts',
  'layers.ts',
  'messages.ts',
  'middleware.ts',
  'resolved-config.ts',
  'roles.ts',
  'routes.ts',
  'skills.ts',
]);

/**
 * Options for `generateLayerCodegen`.
 */
export interface GenerateLayerCodegenOptions {
  /**
   * Re-import the app's definitions fresh, past the module cache, and tell each entry's `code` to.
   * The dev supervisor sets it to pick up edits in its own long-lived process.
   *
   * @default
   * false
   */
  fresh?: boolean;

  /**
   * Whether to write the entries that target a project path.
   * `ohne prepare` and `ohne dev` turn it on; a booting process writes only its codegen directory.
   *
   * @default
   * false
   */
  paths?: boolean;
}

/**
 * Generates every file the stacked layers declare under `codegen` in their `ohne.layer.ts`.
 *
 * Layers run furthest-first.
 * Each entry's `code` runs against the loaded stack, so it reads the merged config.
 * The role, message, collection, block, and field-type registries hold the stack's own while it runs.
 * Layers come from the registered stack, so `loadLayers` must have run first.
 *
 * A bucket entry lands in its bucket under the app's `dirs.codegen` (default `.ohne`), banner first.
 * A `file` that is not a plain `.ts` name, or one two entries claim, throws naming the layer and the file.
 * So does a name ohne generates itself, like `routes.ts`, in any bucket.
 *
 * A path entry lands at its `path`, resolved against the app root, as `code` returns it.
 * Path entries are written only when `options.paths` is on.
 * An entry whose `path` returns `undefined` is skipped.
 * A path two entries claim throws, and so does one inside the codegen directory, which never prunes it.
 *
 * The app root is the nearest `package.json` above `from` (default `process.cwd()`).
 * Each file is rewritten only when its contents change.
 * Returns the absolute paths written, empty when no `package.json` is found.
 */
export async function generateLayerCodegen(
  from: string = process.cwd(),
  options: GenerateLayerCodegenOptions = {},
): Promise<string[]> {
  const root = await appRoot(from);
  const dir = await codegenDir(from);
  if (isNull(root) || isNull(dir)) return [];

  const { fresh = false, paths = false } = options;
  const owners = new Map<string, string>();
  const jobs: { path: string; write: (code: string) => Promise<boolean>; entry: LayerCodegen }[] =
    [];
  for (const layer of useLayers().layers()) {
    const name = layer.name ?? basename(layer.path);
    for (const entry of layer.codegen ?? []) {
      if ('bucket' in entry) {
        assertBucketFile(entry, name);
        const gen = createCodeGenerator({ dir: joinPath(dir, entry.bucket), banner: BANNER });
        const path = gen.path(entry.file);
        claim(owners, path, name, `\`${entry.bucket}/${entry.file}\``, entry.file);
        jobs.push({ path, write: (code) => gen.write(entry.file, code), entry });
        continue;
      }
      if (!paths) continue;
      const out = entry.path();
      if (isUndefined(out)) continue;
      const path = resolvePath(out, root);
      if (isPathInside(path, dir)) {
        throw ohneError({
          title: `Codegen path \`${out}\` is inside the codegen directory`,
          body: [
            `\`${name}\` declares it, but a path file carries no banner, so a stale one would never be pruned there.`,
            'Declare a `bucket` and `file` for it, or pick a path outside the directory.',
          ],
          path,
        });
      }
      claim(owners, path, name, `\`${relativePath(process.cwd(), path)}\``, out);
      jobs.push({ path, write: (code) => writeFileIfChanged(path, code), entry });
    }
  }
  if (jobs.length === 0) return [];

  const context: LayerCodegenContext = { fresh };
  return withStackRegistries(
    () =>
      Promise.all(
        jobs.map(async ({ path, write, entry }) => {
          await write(await entry.code(context));
          return path;
        }),
      ),
    { fresh },
  );
}

/**
 * Throws when a bucket entry's `file` is not a plain `.ts` name, or names a file ohne generates itself.
 */
function assertBucketFile(entry: BucketCodegen, layer: string): void {
  if (!PLAIN_TS_NAME.test(entry.file)) {
    throw ohneError({
      title: `Invalid codegen file \`${entry.file}\``,
      body: [
        `\`${layer}\` declares it, but a codegen file is a plain \`.ts\` name like \`my-types.ts\`.`,
        'Drop any directory; `bucket` already picks one.',
      ],
    });
  }
  if (OHNE_FILES.has(entry.file)) {
    throw ohneError({
      title: `Codegen file \`${entry.file}\` is reserved`,
      body: [
        `\`${layer}\` declares it, but ohne generates a file of that name itself.`,
        'Give the entry a file name of its own.',
      ],
    });
  }
}

/**
 * Records `layer` as the owner of `path`, throwing when another layer's entry already claims it.
 * `shown` names the target in the error body, `label` in its title.
 */
function claim(
  owners: Map<string, string>,
  path: string,
  layer: string,
  shown: string,
  label: string,
): void {
  const owner = owners.get(path);
  if (!isUndefined(owner)) {
    throw ohneError({
      title: `Codegen file \`${label}\` is claimed twice`,
      body: [
        `\`${owner}\` and \`${layer}\` both generate ${shown}.`,
        'Give each entry a file of its own.',
      ],
    });
  }
  owners.set(path, layer);
}
