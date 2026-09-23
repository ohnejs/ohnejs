import { hook, queryMetadata, queryUntyped, useDatabase, useDialect, usePrinter } from 'ohnejs';
import { isEmpty } from 'ohnejs/utils';

import { uploadSecrets } from '../uploads/sign.ts';

// Before the socket opens, so no read ever meets a row that predates the column.
hook('schema:synced', fillPrivate);

hook('server:ready', async () => {
  if (!isEmpty(uploadSecrets())) return;
  if (!(await queryUntyped('Uploads').where({ private: true }).exists())) return;
  usePrinter().warn(
    '`UPLOADS_SECRET` is unset, so the layer keeps no private files: ' +
      'every row marked private is served to anyone',
  );
});

/**
 * Sets `private` to `false` on every row that predates the column, where it landed `null`.
 * `_updatedAt` stays, since nothing a reader sees changes, so cached previews keep their version.
 */
async function fillPrivate(): Promise<void> {
  const dialect = useDialect();
  const meta = queryMetadata('Uploads');
  const column = dialect.quote(meta.fields.private.column as string);
  await useDatabase().run(
    `UPDATE ${dialect.quote(meta.table)} SET ${column} = ? WHERE ${column} IS NULL`,
    [dialect.serialize('boolean', false)],
  );
}
