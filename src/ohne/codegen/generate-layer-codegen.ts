import type { BucketCodegen, LayerCodegen, LayerCodegenContext } from '../layers/define-layer.ts';

import { codeSpan } from '../../utils/ansi/index.ts';
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

const PARENT_IS_FILE = {
  cause: 'a file sits where one of its parent directories belongs.',
  fix: 'Move that file aside, or pick another path.',
};

const NO_PERMISSION = {
  cause: 'you have no permission to write there.',
  fix: 'Make its directory writable, or pick another path.',
};

const WRITE_FAILURES: Record<string, { cause: string; fix: string }> = {
  EISDIR: { cause: 'a directory sits at that path.', fix: 'Point the path at a file.' },
  EACCES: NO_PERMISSION,
  EPERM: NO_PERMISSION,
  EROFS: { cause: 'its file system is read-only.', fix: 'Pick a path on a writable disk.' },
  EEXIST: PARENT_IS_FILE,
  ENOTDIR: PARENT_IS_FILE,
};

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
 * An entry whose `path` returns `undefined` is skipped; an empty path throws.
 * A path two entries claim throws, and so does one inside the codegen directory, which never prunes it.
 * A failed write throws a block naming the file, the layer, and the cause.
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
      const path = resolveCodegenPath(out, name, root, dir);
      claim(owners, path, name, `\`${relativePath(process.cwd(), path)}\``, out);
      jobs.push({ path, write: (code) => writeCodegenFile(path, code, name), entry });
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
 * Options for `writeCodegenPath`.
 */
export interface WriteCodegenPathOptions {
  /**
   * The layer that generates the file, named in every error.
   */
  layer: string;

  /**
   * Where to look up the app, whose root the path resolves against.
   * Omitted means the stack's closest layer, the app itself, or `process.cwd()` before a stack loads.
   */
  from?: string;
}

/**
 * What `writeCodegenPath` did.
 */
export interface WriteCodegenPathResult {
  /**
   * The absolute path of the file.
   */
  path: string;

  /**
   * Whether the file changed; `false` when it already held `code`.
   */
  written: boolean;
}

/**
 * Writes `code` to `out` in the project, exactly as a layer codegen path entry does.
 * Reach for it in a command that writes such a file on demand, so it fails the same way the entry does.
 *
 * `out` resolves against the app root, the nearest `package.json` above `options.from`.
 * So a command run with `--cwd` writes into that app, not the shell's directory.
 * An empty path throws, and so does one inside the codegen directory, which never prunes it.
 * A failed write throws a block naming the file, `options.layer`, and the cause.
 * The file is rewritten only when its contents change.
 * Throws when no `package.json` is found.
 */
export async function writeCodegenPath(
  out: string,
  code: string,
  options: WriteCodegenPathOptions,
): Promise<WriteCodegenPathResult> {
  const { layer, from = useLayers().layers().at(-1)?.path ?? process.cwd() } = options;
  const root = await appRoot(from);
  const dir = await codegenDir(from);
  if (isNull(root) || isNull(dir)) {
    throw ohneError({
      title: `No app found for codegen path ${codeSpan(out)}`,
      body: [
        'A codegen path resolves against your app root, the directory of its `package.json`.',
        'Run the command inside your app.',
      ],
    });
  }
  const path = resolveCodegenPath(out, layer, root, dir);
  return { path, written: await writeCodegenFile(path, code, layer) };
}

/**
 * Resolves a path entry's `out` against `root`, throwing when it is empty or inside the codegen `dir`.
 */
function resolveCodegenPath(out: string, layer: string, root: string, dir: string): string {
  if (out === '') {
    throw ohneError({
      title: 'Codegen path is empty',
      body: [
        `\`${layer}\` generates a file, but its path is empty, which names your app directory.`,
        'Set it to a file path, or leave it unset to skip the file.',
      ],
    });
  }
  const path = resolvePath(out, root);
  if (isPathInside(path, dir)) {
    throw ohneError({
      title: `Codegen path ${codeSpan(out)} is inside the codegen directory`,
      body: [
        `\`${layer}\` generates it, but a file there carries no banner, so a stale one would never be pruned.`,
        `Pick a path outside \`${relativePath(root, dir)}/\`.`,
      ],
      path,
    });
  }
  return path;
}

/**
 * Writes `code` to `path` when it changed, turning a filesystem failure into a block naming `layer`.
 */
async function writeCodegenFile(path: string, code: string, layer: string): Promise<boolean> {
  try {
    return await writeFileIfChanged(path, code);
  } catch (error) {
    const errno = (error as NodeJS.ErrnoException).code;
    if (isUndefined(errno)) throw error;
    const { cause, fix } = WRITE_FAILURES[errno] ?? {
      cause: `the write failed with \`${errno}\`.`,
      fix: 'Fix the cause, or pick another path.',
    };
    throw ohneError({
      title: `Cannot write codegen file ${codeSpan(relativePath(process.cwd(), path))}`,
      body: [`\`${layer}\` generates it, but ${cause}`, fix],
      path,
    });
  }
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
