import { useDialect } from '../../database/use-database.ts';
import { ohneError } from '../../error/ohne-error.ts';
import { queryMetadata } from '../metadata.ts';
import { loadTranslations } from './loaders/translations.ts';

/**
 * Lists the locales at which one record holds a translation, in the configured locale order.
 *
 * A one-record read of `_translations`, through the loader every row read hydrates the field with.
 * A locale holds a translation when any row exists for the record there.
 * The probe spans the companion table and every owned locale-scoped derived table.
 * Rows at a locale the configuration no longer names never surface.
 * A non-translatable collection throws - no locale could hold anything.
 */
export async function translationLocales(collection: string, uuid: string): Promise<string[]> {
  const meta = queryMetadata(collection);
  if (meta.translatable !== true) {
    throw ohneError({
      title: `Cannot list translation locales on \`${collection}\``,
      body: [
        `Collection \`${collection}\` has no translatable field, so no locale holds a translation.`,
      ],
    });
  }
  const held = await loadTranslations(meta.fields._translations, [uuid], useDialect());
  return held[uuid] ?? [];
}
