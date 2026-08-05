import type { OhneLayer } from '../project/resolve-ohne-layers.ts';
import type { MessageMeta } from './messages.ts';

import { listDir, readJSON } from '../../utils/fs/index.ts';
import {
  canonicalizeLanguage,
  dirname,
  hasKey,
  isNull,
  isPlainObject,
  isString,
  isUndefined,
  joinPath,
  naturalCompare,
  relativePath,
} from '../../utils/index.ts';
import { ohneError } from '../error/ohne-error.ts';

/**
 * Reads every message file in one layer's messages directory.
 *
 * Each `.json` file is named after a BCP-47 language tag; its stem is the canonical language.
 * A `_`-prefixed file or directory is skipped, so a draft catalog can sit beside the live ones.
 * Nested objects and literal dotted keys both flatten to dot-notation keys.
 * A subdirectory prefixes its keys, so `dashboard/en.json`'s `save` becomes `dashboard.save`.
 * Results are sorted by file path so the output is deterministic.
 * Returns `[]` when the layer has no messages directory.
 * Throws when two files in the layer define the same key for the same language.
 * Throws too when one file lands on the same flattened key twice, nested and as a literal dotted key.
 *
 * @example
 * ```ts
 * await scanLayerMessages({ name: 'app', dir: '/app' }, 'messages')
 * // -> [
 * //      {
 * //        key: 'field.required',
 * //        language: 'en',
 * //        template: '...',
 * //        file: '...',
 * //        layer: 'app',
 * //      }
 * //    ]
 * ```
 */
export async function scanLayerMessages(
  layer: OhneLayer,
  messages: string,
): Promise<MessageMeta[]> {
  const entries = await listDir(joinPath(layer.dir, messages), { ext: 'json', files: true });
  if (isNull(entries)) return [];

  const seen = new Map<string, string>();
  const result: MessageMeta[] = [];
  const catalogs = entries
    .filter((entry) => !entry.relativePath.split('/').some((segment) => segment.startsWith('_')))
    .sort((a, b) => naturalCompare(a.relativePath, b.relativePath));

  for (const entry of catalogs) {
    const language = canonicalizeLanguage(entry.stem);
    if (isNull(language)) {
      throw ohneError({
        title: `Invalid message language \`${entry.stem}\``,
        body: `A message file is named after a BCP-47 language tag, like \`en.json\` or \`de-AT.json\`.`,
        path: entry.path,
      });
    }

    const data = await readJSON(entry.path);
    if (!isPlainObject(data)) {
      throw ohneError({
        title: 'Invalid message file',
        body: 'A message file must hold a JSON object of keys to ICU template strings.',
        path: entry.path,
      });
    }

    const dir = dirname(entry.relativePath);
    const prefix = dir === '.' ? '' : dir.split('/').join('.');

    const flat: Record<string, unknown> = {};
    flattenMessages(data, '', flat, (key) => {
      throw ohneError({
        title: `Duplicate message \`${prefix === '' ? key : `${prefix}.${key}`}\` for \`${language}\``,
        body: [
          'The file defines the same flattened key twice, nested and as a literal dotted key.',
          'Keep one definition.',
        ],
        path: entry.path,
      });
    });

    for (const [rawKey, value] of Object.entries(flat)) {
      const key = prefix === '' ? rawKey : `${prefix}.${rawKey}`;
      if (!isString(value)) {
        throw ohneError({
          title: `Message \`${key}\` is not a string`,
          body: 'Every message value must be an ICU template string.',
          path: entry.path,
        });
      }

      const id = `${language}\t${key}`;
      const clash = seen.get(id);
      if (!isUndefined(clash)) {
        throw ohneError({
          title: `Duplicate message \`${key}\` for \`${language}\``,
          body: [
            `Two files in layer \`${layer.name}\` define the same key for the same language.`,
            '',
            `- \`${relativePath(process.cwd(), clash)}\``,
            `- \`${relativePath(process.cwd(), entry.path)}\``,
          ],
        });
      }
      seen.set(id, entry.path);
      result.push({ key, language, template: value, file: entry.path, layer: layer.name });
    }
  }

  return result;
}

/**
 * Flattens nested objects into dot-notation keys, calling `clash` when two entries land on one key.
 * A nested object and a literal dotted key can collide; last-wins would silently drop a translation.
 */
function flattenMessages(
  value: Record<string, unknown>,
  prefix: string,
  result: Record<string, unknown>,
  clash: (key: string) => void,
): void {
  for (const [key, child] of Object.entries(value)) {
    const path = prefix === '' ? key : `${prefix}.${key}`;
    if (isPlainObject(child)) {
      flattenMessages(child, path, result, clash);
      continue;
    }
    if (hasKey(result, path)) clash(path);
    result[path] = child;
  }
}
