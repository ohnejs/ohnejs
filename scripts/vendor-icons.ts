import { writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isUndefined } from '../src/utils/is/is-undefined.ts';

/**
 * The Iconify distribution of Tabler this vendoring is pinned to.
 * Iconify ships the optimized bodies the dashboard renders; Tabler's own package ships raw nodes.
 * Bump it, run `pnpm vendor:icons`, and commit the two generated files.
 */
const VERSION = '1.2.38';

/**
 * The Tabler release the pinned Iconify distribution carries, for the generated headers.
 */
const TABLER = '3.46.0';

const SOURCE = `https://cdn.jsdelivr.net/npm/@iconify-json/tabler@${VERSION}/icons.json`;

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHAPES = resolve(ROOT, 'src/ohne/dashboard/icon-shapes.json');
const NAMES = resolve(ROOT, 'src/utils/icon/icon-name.ts');

interface IconifySet {
  prefix: string;
  width: number;
  height: number;
  icons: Record<string, { body: string; width?: number; height?: number }>;
}

const response = await fetch(SOURCE);
if (!response.ok) throw new Error(`${SOURCE} answered ${response.status}`);
const set = (await response.json()) as IconifySet;

if (set.prefix !== 'tabler') throw new Error(`Expected the tabler set, got \`${set.prefix}\``);
if (set.width !== 24 || set.height !== 24) {
  throw new Error(`Expected a 24x24 grid, got ${set.width}x${set.height}`);
}

const names = Object.keys(set.icons).sort();
const off = names.filter((name) => {
  const icon = set.icons[name];
  return !isUndefined(icon?.width) || !isUndefined(icon?.height);
});
if (off.length > 0) throw new Error(`Off-grid icons: ${off.join(', ')}`);

const shapes: Record<string, string> = {};
for (const name of names) shapes[name] = set.icons[name]!.body;
await writeFile(SHAPES, `${JSON.stringify(shapes)}\n`);

const union = names.map((name) => `  | '${name}'`).join('\n');
await writeFile(
  NAMES,
  `/**
 * Every icon name in the Tabler set, as Tabler names them.
 *
 * Generated from Tabler \`${TABLER}\` by \`pnpm vendor:icons\`; edit that script, never this file.
 * Type-only, so naming an icon ships no shape data.
 *
 * @example
 * \`\`\`ts
 * const menu: IconName = 'brand-github' // -> ok
 * const typo: IconName = 'brand-githbu' // -> Type '"brand-githbu"' is not assignable to 'IconName'
 * \`\`\`
 */
export type IconName =
${union};
`,
);

console.log(`Vendored ${names.length} Tabler ${TABLER} icons.`);
