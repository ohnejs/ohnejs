import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { toolchain } from '../src/ohne/meta/toolchain.ts';
import { version } from '../src/ohne/meta/version.ts';
import { listDir, readFile, writeFileIfChanged } from '../src/utils/fs/index.ts';
import { isPlainObject } from '../src/utils/is/is-plain-object.ts';
import { isString } from '../src/utils/is/is-string.ts';
import { merge } from '../src/utils/merge/merge.ts';
import { codeFences } from '../src/utils/text/code-fences.ts';

/**
 * Rewrites the pins of every starter `package.json` shown in `docs/` to match `package.json`.
 * A starter is a `json` fence whose `dependencies.ohnejs` is a string, the shape `ohne init` writes.
 * Only the pinned fields move, so a page's own `name` or `scripts` survive.
 */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PINS = { dependencies: { ohnejs: version }, ...toolchain };

const changed: string[] = [];

for (const entry of (await listDir(resolve(ROOT, 'docs'), { ext: 'md' })) ?? []) {
  const source = (await readFile(entry.path))!;
  let next = source;

  for (const fence of codeFences(source).reverse()) {
    if (!fence.info.startsWith('json') || !fence.body.includes('"ohnejs"')) continue;
    const manifest: unknown = JSON.parse(fence.body);
    if (!isPlainObject(manifest) || !isPlainObject(manifest.dependencies)) continue;
    if (!isString(manifest.dependencies.ohnejs)) continue;
    const pinned = JSON.stringify(merge(manifest, PINS), null, 2);
    next = next.slice(0, fence.start) + pinned + next.slice(fence.end);
  }

  if (await writeFileIfChanged(entry.path, next)) changed.push(`docs/${entry.relativePath}`);
}

console.log(changed.length > 0 ? `Synced ${changed.join(', ')}` : 'Starter pins are in sync');
