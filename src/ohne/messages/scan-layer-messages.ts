import type { OhneLayer } from '../project/resolve-ohne-layers.ts';
import type { MessageMeta } from './messages.ts';

import { listDir, readJSON } from '../../utils/fs/index.ts';
import {
  canonicalizeLanguage,
  dirname,
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
 * Nested objects and literal dotted keys both flatten to dot-notation keys.
 * A subdirectory prefixes its keys, so `dashboard/en.json`'s `save` becomes `dashboard.save`.
 * Results are sorted by file path so the output is deterministic.
 * Returns `[]` when the layer has no messages directory.
 * Throws when two files in the layer define the same key for the same language.
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

  for (const entry of entries.sort((a, b) => naturalCompare(a.relativePath, b.relativePath))) {
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

    for (const [rawKey, value] of Object.entries(flattenMessages(data))) {
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

function flattenMessages(value: Record<string, unknown>, prefix = ''): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    const path = prefix === '' ? key : `${prefix}.${key}`;
    if (isPlainObject(child)) Object.assign(result, flattenMessages(child, path));
    else result[path] = child;
  }
  return result;
}
