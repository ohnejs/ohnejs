import { isUndefined } from '../../utils/is/is-undefined.ts';
import { type Ref, ref } from '../../utils/reactive/ref.ts';
import { api } from './api.ts';

/**
 * One language's messages for a single group: a flat map of message key to ICU template.
 * This is exactly the shape the `GET /messages/:group/:language` endpoint returns.
 */
export type MessageCatalog = Record<string, string>;

const cells = new Map<string, Ref<MessageCatalog | undefined>>();

/**
 * Reactively reads a group's catalog for a language, fetching it from the API the first time.
 *
 * Reading inside a reactive render subscribes to the catalog, so the render updates once it loads.
 * The result is `undefined` until the fetch resolves; callers fall back to the raw key meanwhile.
 * A `(language, group)` pair is fetched at most once: the cell is created before the request starts.
 * Concurrent reads share that cell, and later reads hit the cache.
 *
 * A failed or missing fetch resolves to an empty catalog, so a broken request degrades to raw keys.
 * The empty result is cached, so it does not retry on every render.
 *
 * @example
 * ```ts
 * messageCatalog('en', 'nav') // -> undefined, then { 'nav.home': 'Home' } once loaded
 * ```
 */
export function messageCatalog(language: string, group: string): MessageCatalog | undefined {
  const id = `${language}\t${group}`;
  let cell = cells.get(id);
  if (isUndefined(cell)) {
    cell = ref<MessageCatalog | undefined>(undefined);
    cells.set(id, cell);
    void fill(cell, language, group);
  }
  return cell.value;
}

async function fill(
  cell: Ref<MessageCatalog | undefined>,
  language: string,
  group: string,
): Promise<void> {
  cell.value = await fetchCatalog(language, group);
}

async function fetchCatalog(language: string, group: string): Promise<MessageCatalog> {
  try {
    const path = `/messages/${encodeURIComponent(group)}/${encodeURIComponent(language)}`;
    const response = await api(path);
    return response.ok ? ((await response.json()) as MessageCatalog) : {};
  } catch {
    return {};
  }
}
