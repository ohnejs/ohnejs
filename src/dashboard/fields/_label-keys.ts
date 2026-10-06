import type { DashboardMeta } from '../runtime/meta-types.ts';

import { isUndefined } from '../../utils/is/is-undefined.ts';

/**
 * The locale a label of `target` is cached under; `undefined` for the default one or an untranslated target.
 * A label read in one locale therefore never stands in for another locale's.
 */
export function labelScope(
  meta: DashboardMeta | undefined,
  target: string,
  locale: string | undefined,
): string | undefined {
  if (isUndefined(locale) || locale === meta?.defaultLocale) return undefined;
  const collection = meta?.collections.find((entry) => entry.name === target);
  return collection?.translatable === true ? locale : undefined;
}

/**
 * The key of the batch that resolves `target`'s labels in `scope`; a locale tag never holds a `:`.
 */
export function labelBatchKey(target: string, scope: string | undefined): string {
  return isUndefined(scope) ? target : `${target}@${scope}`;
}

/**
 * The cache key of one record's label in `scope`.
 */
export function labelKey(target: string, uuid: string, scope: string | undefined): string {
  return `${labelBatchKey(target, scope)}:${uuid}`;
}
