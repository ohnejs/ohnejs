import type { DuplicateContext } from '../../collections/define-collection.ts';
import type { LocaleCode } from '../../collections/known-locales.ts';
import type { CollectionQueryMeta } from '../metadata.ts';
import type { QueryRecord } from '../read/find.ts';

import { first, isArray, isFunction, isNull, isUndefined } from '../../../utils/index.ts';
import { useCollections } from '../../collections/use-collections.ts';
import { effectiveLocale, queryLocales } from '../locale.ts';
import { queryMetadata } from '../metadata.ts';
import { copyInput, type CopyInputOptions } from './copy-input.ts';

/**
 * The create a duplicate runs: the new record's locale and input, and every other locale's values.
 */
export interface DuplicateDraft {
  /**
   * The locale the new record is created at, `null` on a collection with no translatable field.
   */
  locale: LocaleCode | null;

  /**
   * The new record's write input at `locale`.
   */
  input: Record<string, unknown>;

  /**
   * The translatable values of every other locale the source holds, keyed by locale.
   */
  locales: Record<string, Record<string, unknown>>;
}

/**
 * Reads the source at one locale, `null` for the chain's default, answering `undefined` when out of reach.
 */
export type DuplicateReader = (locale: LocaleCode | null) => Promise<QueryRecord | undefined>;

const BASE: CopyInputOptions = {
  only: 'all',
  uniques: 'drop',
  operation: 'create',
  values: 'read',
};

const BASE_UNHELD: CopyInputOptions = {
  only: 'shared',
  uniques: 'drop',
  operation: 'create',
  values: 'read',
};

const FILL: CopyInputOptions = {
  only: 'translatable',
  uniques: 'drop',
  operation: 'create',
  values: 'read',
};

/**
 * Builds the create that duplicates a record, reading the source once per locale it holds.
 *
 * The new record is created at `locale` when given, else the default locale if held, else the first held one.
 * Held means held where `read` reaches the source, so a locale its scope hides never copies.
 * A source that does not hold that locale gives only its shared values there, never another locale's.
 * Every other held locale becomes a `locales` entry with its translatable values.
 * A source read without `_translations` duplicates at the new record's locale alone.
 * Each input runs through the collection's `duplicate` function, then re-projects through the same clamp.
 * Top-level `unique`, unreadable, and `copy: false` fields drop from the default input.
 * A value the function returns for one is kept.
 * Answers `undefined` when `read` cannot reach the source at any locale it asks for.
 */
export async function duplicateDraft(
  collection: string,
  locale: LocaleCode | null,
  read: DuplicateReader,
): Promise<DuplicateDraft | undefined> {
  const meta = queryMetadata(collection);
  if (meta.translatable !== true) {
    const source = await read(null);
    if (isUndefined(source)) return undefined;
    const input = await shaped(meta, source, effectiveLocale(null) as LocaleCode, BASE);
    return { locale: null, input, locales: {} };
  }

  const opened = await openSource(locale, read);
  if (isUndefined(opened)) return undefined;
  const held = isArray<LocaleCode[]>(opened.record._translations)
    ? opened.record._translations
    : undefined;
  const base = locale ?? (isUndefined(held) ? opened.at : baseLocale(held));
  const source = base === opened.at ? opened.record : await read(base);
  if (isUndefined(source)) return undefined;
  const options = isUndefined(held) || held.includes(base) ? BASE : BASE_UNHELD;
  const input = await shaped(meta, source, base, options);

  const locales: Record<string, Record<string, unknown>> = {};
  for (const code of held ?? []) {
    if (code === base) continue;
    const record = await read(code);
    if (isUndefined(record)) return undefined;
    locales[code] = await shaped(meta, record, code, FILL);
  }
  return { locale: base, input, locales };
}

/**
 * Reads the source at `locale`, or without one at the first configured locale it reaches, the default first.
 * A read scope's `where` can hide a record at one locale and show it at another.
 */
async function openSource(
  locale: LocaleCode | null,
  read: DuplicateReader,
): Promise<{ record: QueryRecord; at: LocaleCode } | undefined> {
  if (!isNull(locale)) {
    const record = await read(locale);
    return isUndefined(record) ? undefined : { record, at: locale };
  }
  const { defaultLocale, locales } = queryLocales();
  for (const code of [defaultLocale, ...locales.filter((other) => other !== defaultLocale)]) {
    const record = await read(code === defaultLocale ? null : (code as LocaleCode));
    if (!isUndefined(record)) return { record, at: code as LocaleCode };
  }
  return undefined;
}

/**
 * The locale a duplicate creates at without an explicit one: the default if held, else the first held one.
 */
function baseLocale(held: readonly LocaleCode[]): LocaleCode {
  const defaultLocale = queryLocales().defaultLocale as LocaleCode;
  if (held.includes(defaultLocale)) return defaultLocale;
  return first(held) ?? defaultLocale;
}

/**
 * Projects one locale's input, then hands it to the collection's `duplicate` function and clamps the result.
 * The clamp takes given values, so a field the default input dropped keeps what the function picks.
 */
async function shaped(
  meta: CollectionQueryMeta,
  source: QueryRecord,
  locale: LocaleCode,
  options: CopyInputOptions,
): Promise<Record<string, unknown>> {
  const input = copyInput(meta.fields, source, options);
  const hook = useCollections().get(meta.collection)?.collection.duplicate;
  if (!isFunction(hook)) return input;
  const context: DuplicateContext = { source, input, locale };
  return copyInput(meta.fields, await hook(context), {
    ...options,
    uniques: 'keep',
    values: 'given',
  });
}
