import { activeContentLocale } from 'app/components/content-language-switcher.ts';
import { api, listenTrigger } from 'ohnejs/dashboard';
import { effect, isUndefined, untracked } from 'ohnejs/utils';

import type { UploadRecord } from '../../uploads/types.ts';

import { createMediaCache, type MediaCache } from './media-cache.ts';
import { MEDIA_REFRESH } from './media-library-state.ts';

/**
 * The dashboard's shared `Uploads` record cache, read by the media cells, controls, and picker.
 * Records read at the content locale, so their alt text is the one the viewer edits.
 * Every media mutation dispatches `media:refresh`, which re-fetches the cached records in one batch.
 */
export const mediaRecords: MediaCache = createMediaCache(fetchUploads);

listenTrigger(MEDIA_REFRESH, () => mediaRecords.refresh());

effect(() => {
  void activeContentLocale();
  untracked(() => mediaRecords.refresh());
});

/**
 * Reads the decorated records for `uuids` through the body-query endpoint; a failure resolves `undefined`.
 */
async function fetchUploads(
  uuids: readonly string[],
): Promise<readonly UploadRecord[] | undefined> {
  const locale = untracked(activeContentLocale);
  const body: Record<string, unknown> = { where: { UUID: { in: uuids } }, limit: uuids.length };
  if (!isUndefined(locale)) body.locale = locale;
  try {
    const response = await api('POST /collections/uploads/query', {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) return undefined;
    return (await response.json()) as UploadRecord[];
  } catch {
    return undefined;
  }
}
