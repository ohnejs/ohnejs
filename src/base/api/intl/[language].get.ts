import { badRequest, defineHandler, notFound } from 'ohnejs';
import {
  canonicalizeLanguage,
  deriveIntlData,
  getOrSet,
  type IntlData,
  intlLanguage,
  isNull,
  isUndefined,
} from 'ohnejs/utils';

import { translate } from '../../../ohne/http/translate.ts';

const derived = new Map<string, IntlData>();

/**
 * `GET /intl/:language`
 *
 * Serves the `Intl` data the dashboard formats a language with: names, presets, relative time, separators.
 * A browser may list a language it has no data for; the dashboard then fetches this and formats from it.
 * The data comes from the server's own engine, read through the language's fallback chain.
 * Responds `400` for a malformed language tag and `404` for a language the server has no data for either.
 */
export default defineHandler(({ params }): IntlData => {
  const language = canonicalizeLanguage(params.language);
  if (isNull(language)) {
    throw badRequest(translate('api.messages.invalidLanguage', { language: params.language }));
  }
  const tag = intlLanguage(language);
  if (isUndefined(tag)) throw notFound(translate('api.intl.unknownLanguage', { language }));
  return getOrSet(derived, tag, () => deriveIntlData(tag));
});
