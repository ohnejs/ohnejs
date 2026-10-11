import { type IntlData, registerIntlData } from '../../utils/i18n/intl-data.ts';
import { isNull } from '../../utils/is/is-null.ts';
import { isUndefined } from '../../utils/is/is-undefined.ts';
import { api } from './api.ts';

const RETRY_DELAY = 3000;

const loads = new Map<string, Promise<void>>();

/**
 * Loads a language's `Intl` data from `GET /intl/[language]` and registers it, once per language.
 * Call it for a language the browser has no `Intl` data for; the formatters then render it from the server's.
 * It settles once the first attempt has, whether the API answered or not, and never rejects.
 * A failed attempt keeps retrying in the background, and the data lands in place once it arrives.
 *
 * @example
 * ```ts
 * if (isUndefined(intlLanguage('bs'))) await loadIntlData('bs')
 * ```
 */
export function loadIntlData(language: string): Promise<void> {
  let load = loads.get(language);
  if (isUndefined(load)) {
    load = fill(language);
    loads.set(language, load);
  }
  return load;
}

/**
 * Fetches and registers the data, retrying after `RETRY_DELAY` while the API fails to answer.
 * A refused request, like a `404` for a language the server lacks too, stops for good.
 */
async function fill(language: string): Promise<void> {
  const data = await fetchIntlData(language);
  if (isUndefined(data)) {
    setTimeout(() => void fill(language), RETRY_DELAY);
    return;
  }
  if (!isNull(data)) registerIntlData(language, data);
}

/**
 * Fetches the data: `null` for a refused request, `undefined` when the API erred or never answered.
 */
async function fetchIntlData(language: string): Promise<IntlData | null | undefined> {
  try {
    const response = await api(`/intl/${encodeURIComponent(language)}`);
    if (response.ok) return (await response.json()) as IntlData;
    return response.status >= 500 ? undefined : null;
  } catch {
    return undefined;
  }
}
