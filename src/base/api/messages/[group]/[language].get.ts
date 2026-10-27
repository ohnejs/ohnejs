import { badRequest, defineHandler, notFound, useConfig, useMessages } from 'ohnejs';
import { canonicalizeLanguage, isEmpty, isNull, resolveCatalog } from 'ohnejs/utils';

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
    const result = resolveCatalog(useMessages().all(), group, language, fallback);
    if (isEmpty(result)) throw notFound(translate('api.messages.unknownGroup', { group }));
    return result;
  },
);
