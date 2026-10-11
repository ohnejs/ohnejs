import { intlLanguage } from '../../utils/i18n/intl-language.ts';
import { isNull } from '../../utils/is/is-null.ts';
import { isUndefined } from '../../utils/is/is-undefined.ts';
import { type Ref, ref } from '../../utils/reactive/ref.ts';
import { api } from './api.ts';
import { dashboardConfig } from './config.ts';
import { loadIntlData } from './intl.ts';

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

interface Cell {
  catalog: Ref<MessageCatalog | undefined>;
  loaded: Promise<void>;
}

const cells = new Map<string, Cell>();

/**
 * Loads everything a language renders with: every group's catalog, each group in its own parallel request.
 * A language the browser has no `Intl` data for loads the server's alongside, through `loadIntlData`.
 * A later `messageCatalog` read for a loaded group answers at once and starts no fetch.
 * A group loads at most once per language, so a second call for the same language fetches nothing.
 * It settles once every group's first attempt has, whether the API answered or not.
 * It never rejects, so a caller can await it before rendering.
 * A group whose first attempt failed keeps retrying in the background.
 * Its catalog then lands in place, and every live `t` call re-renders in it.
 *
 * @example
 * ```ts
 * await loadLanguage('de')
 *
 * messageCatalog('de', 'nav') // -> { 'nav.home': { template: 'Start', language: 'de' } }
 * ```
 */
export async function loadLanguage(language: string): Promise<void> {
  const catalogs = dashboardConfig().messageGroups.map((group) => open(language, group).loaded);
  const intl = isUndefined(intlLanguage(language)) ? [loadIntlData(language)] : [];
  await Promise.all([...catalogs, ...intl]);
}

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
  return open(language, group).catalog.value;
}

/**
 * The cell for a group's catalog in a language, created with its fetch the first time it is asked for.
 * `loaded` is the first attempt, which settles whether or not the API answered.
 */
function open(language: string, group: string): Cell {
  const id = `${language}\t${group}`;
  let cell = cells.get(id);
  if (isUndefined(cell)) {
    const catalog = ref<MessageCatalog | undefined>(undefined);
    cell = { catalog, loaded: fill(catalog, language, group) };
    cells.set(id, cell);
  }
  return cell;
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
  if (isNull(catalog)) {
    cell.value ??= {};
    setTimeout(() => void fill(cell, language, group), RETRY_DELAY);
    return;
  }
  cell.value = catalog;
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
