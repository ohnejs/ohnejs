import { badRequest, defineHandler, notFound, useConfig, useMessages } from 'ohne';
import {
  canonicalizeLanguage,
  isEmpty,
  isNull,
  isUndefined,
  languageFallbacks,
  uniqueArray,
} from 'ohne/utils';

/**
 * `GET /messages/:group/:language`
 *
 * Serves one group's messages for a language, as a flat map of key to ICU template.
 * The group is the first dot-segment of a key, so `field` returns every `field.*` key.
 * A key missing in the requested language is filled from a less specific one, down to the default.
 * Responds `400` for a malformed language tag and `404` for a group with no keys.
 */
export default defineHandler(({ params }): Record<string, string> => {
  const language = canonicalizeLanguage(params.language);
  if (isNull(language)) throw badRequest(`Invalid language \`${params.language}\``);

  const configured = useConfig().messages.defaultLanguage;
  const fallback = canonicalizeLanguage(configured) ?? configured;
  const group = params.group;
  const catalogs = useMessages().all();

  const result: Record<string, string> = {};
  for (const lang of uniqueArray([...languageFallbacks(language), fallback]).reverse()) {
    const catalog = catalogs[lang];
    if (isUndefined(catalog)) continue;
    for (const [key, template] of Object.entries(catalog)) {
      if (groupOf(key) === group) result[key] = template;
    }
  }

  if (isEmpty(result)) throw notFound(`Unknown message group \`${group}\``);
  return result;
});

function groupOf(key: string): string {
  const dot = key.indexOf('.');
  return dot === -1 ? key : key.slice(0, dot);
}
