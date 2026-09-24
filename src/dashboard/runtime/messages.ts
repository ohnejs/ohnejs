import { isNull } from '../../utils/is/is-null.ts';
import { isUndefined } from '../../utils/is/is-undefined.ts';
import { type Ref, ref } from '../../utils/reactive/ref.ts';
import { api } from './api.ts';

const RETRY_DELAY = 3000;

/**
 * One resolved message: its ICU template and the language that template is written in.
 * The language is the fallback lookup's origin, so the client formats it with matching plural rules.
 */
export interface MessageEntry {
  /**
   * The ICU MessageFormat template.
   */
  template: string;

  /**
   * The BCP-47 language the template is written in, for plural and number formatting.
   */
  language: string;
}

/**
 * One group's resolved messages for a language: a flat map of message key to its entry.
 * This is exactly the shape the `GET /messages/[group]/[language]` endpoint returns.
 */
export type MessageCatalog = Record<string, MessageEntry>;

const cells = new Map<string, Ref<MessageCatalog | undefined>>();

/**
 * Reactively reads a group's catalog for a language, fetching it from the API the first time.
 *
 * The result is `undefined` until the fetch resolves; callers fall back to the raw key meanwhile.
 * A `(language, group)` pair is fetched at most once: the cell is created before the request starts.
 * A missing catalog resolves to an empty one, so its keys render raw.
 * A fetch the API failed to answer does too, but is retried after a delay until an answer arrives.
 *
 * @example
 * ```ts
 * messageCatalog('en', 'nav')
 * // -> { 'nav.home': { template: 'Home', language: 'en' } } once loaded
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

/**
 * Stores the group's fetched catalog in `cell`.
 * A fetch the API failed to answer leaves an empty catalog and tries again after `RETRY_DELAY`.
 */
async function fill(
  cell: Ref<MessageCatalog | undefined>,
  language: string,
  group: string,
): Promise<void> {
  const catalog = await fetchCatalog(language, group);
  if (!isNull(catalog)) {
    cell.value = catalog;
    return;
  }
  cell.value ??= {};
  setTimeout(() => void fill(cell, language, group), RETRY_DELAY);
}

/**
 * Fetches a group's catalog for a language.
 * Answers `{}` for a refused request, like a `404`, and `null` when the API erred or never answered.
 */
async function fetchCatalog(language: string, group: string): Promise<MessageCatalog | null> {
  try {
    const path = `/messages/${encodeURIComponent(group)}/${encodeURIComponent(language)}`;
    const response = await api(path);
    if (response.ok) return (await response.json()) as MessageCatalog;
    return response.status >= 500 ? null : {};
  } catch {
    return null;
  }
}
