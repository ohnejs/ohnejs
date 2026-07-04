import { badRequest, defineHandler, notFound, useConfig, useMessages } from 'ohne';
import {
  canonicalizeLanguage,
  isEmpty,
  isNull,
  isUndefined,
  languageFallbacks,
  messageGroup,
  uniqueArray,
} from 'ohne/utils';

import { translate } from '../../../../ohne/http/translate.ts';

/**
 * `GET /messages/:group/:language`
 *
 * Serves one group's messages for a language, keyed to its ICU template and origin language.
 * The group is the first dot-segment of a key, so `field` returns every `field.*` key.
 * A key missing in the requested language is filled from a less specific one, down to the default.
 * Each entry carries the language its template is written in.
 * The client formats a fallback value with that language's plural rules, not the active language's.
 * Responds `400` for a malformed language tag and `404` for a group with no keys.
 */
export default defineHandler(
  ({ params }): Record<string, { template: string; language: string }> => {
    const language = canonicalizeLanguage(params.language);
    if (isNull(language))
      throw badRequest(translate('api.messages.invalidLanguage', { language: params.language }));

    const configured = useConfig().messages.defaultLanguage;
    const fallback = canonicalizeLanguage(configured) ?? configured;
    const group = params.group;
    const catalogs = useMessages().all();

    const result: Record<string, { template: string; language: string }> = {};
    for (const lang of uniqueArray([...languageFallbacks(language), fallback]).reverse()) {
      const catalog = catalogs[lang];
      if (isUndefined(catalog)) continue;
      for (const [key, template] of Object.entries(catalog)) {
        if (messageGroup(key) === group) result[key] = { template, language: lang };
      }
    }

    if (isEmpty(result)) throw notFound(translate('api.messages.unknownGroup', { group }));
    return result;
  },
);
