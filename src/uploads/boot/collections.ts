import { ohneError, useConfig } from 'ohnejs';
import { isUndefined } from 'ohnejs/utils';

const COLLECTIONS = ['Uploads', 'UploadsJournal', 'UploadsSessions'];

assertCollections();

/**
 * Refuses a `disable.collections` that drops a collection the uploads layer ships, with an error block.
 * The layer reads and writes each of them at every boot, so it cannot run without one.
 * It runs as the file loads, since by `schema:synced` the sync has already dropped an empty table.
 */
function assertCollections(): void {
  const disabled = useConfig().disable.collections;
  const name = COLLECTIONS.find((collection) => disabled.includes(collection));
  if (isUndefined(name)) return;
  throw ohneError({
    title: `The uploads layer needs \`${name}\``,
    body: [
      'You list it in `disable.collections`, but the layer keeps its files and their bookkeeping there.',
      '',
      `Remove \`${name}\` from \`disable.collections\`.`,
      ...(name === 'UploadsSessions'
        ? ['To send every file whole, list `POST /uploads/sessions` in `disable.routes` instead.']
        : []),
    ],
  });
}
