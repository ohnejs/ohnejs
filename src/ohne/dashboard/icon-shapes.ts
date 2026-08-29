import { readFileSync } from 'node:fs';

import type { IconName } from '../../utils/icon/icon-name.ts';

import { dirname, hasKey, resolvePath } from '../../utils/index.ts';

/**
 * The vendored Tabler shapes, beside this module.
 * `pnpm vendor:icons` writes it; a missing file means a broken install, so the read throws.
 */
const FILE = resolvePath('icon-shapes.json', dirname(import.meta.filename));

let shapes: Record<string, string> | undefined;

/**
 * Parses the shape table on first use and keeps it.
 * The dashboard server reads it per icon request, the collection validator once per declared icon.
 * A project whose collections name no icon never reads the file.
 * One that does pays a single parse of roughly 7ms and holds about 2.5MB for the process lifetime.
 * The API server pays that as readily as the dashboard one, since both validate the collections.
 */
function table(): Record<string, string> {
  shapes ??= JSON.parse(readFileSync(FILE, 'utf8')) as Record<string, string>;
  return shapes;
}

/**
 * The SVG body of one icon: the markup that belongs inside a 24x24 `svg` element.
 *
 * Returns `undefined` when the set carries no icon under that name.
 * The lookup is own-only, so an inherited name like `constructor` is a miss rather than a function.
 *
 * @example
 * ```ts
 * iconShape('note') // -> '<path fill="none" stroke="currentColor" ... />'
 * iconShape('nope') // -> undefined
 * ```
 */
export function iconShape(name: string): string | undefined {
  const all = table();
  return hasKey(all, name) ? all[name] : undefined;
}

/**
 * Narrows an arbitrary string to an icon the set actually carries.
 *
 * @example
 * ```ts
 * isIconName('note')        // -> true
 * isIconName('nope')        // -> false
 * isIconName('constructor') // -> false
 * ```
 */
export function isIconName(name: string): name is IconName {
  return hasKey(table(), name);
}

/**
 * Every icon name in the set, sorted, for suggesting a near miss.
 *
 * @example
 * ```ts
 * iconNames().slice(0, 2) // -> ['a-b', 'a-b-2']
 * ```
 */
export function iconNames(): string[] {
  return Object.keys(table());
}
