import { hook, queryMetadata, queryUntyped, useDatabase, useDialect, usePrinter } from 'ohnejs';
import { isUndefined } from 'ohnejs/utils';

import { useUploadsConfig } from '../config.ts';
import { hasUploadSecret } from '../images/sign.ts';
import { useStorage } from '../storage/use-storages.ts';

// Before the socket opens, so no read ever meets a row that predates the column.
hook('schema:synced', fillPrivate);

hook('server:ready', async () => {
  if (hasUploadSecret() || !(await anyPrivate())) return;
  usePrinter().warn('`UPLOADS_SECRET` is unset, so private files have no links and no variants');
});

hook('server:ready', async () => {
  const { publicURL, storage } = useUploadsConfig();
  if (isUndefined(publicURL) || !isUndefined(useStorage().setPrivate)) return;
  if (!(await anyPrivate())) return;
  usePrinter().warnBlock({
    title: 'Private uploads are readable at `publicURL`',
    body: [
      `The \`${storage}\` storage cannot hide an object, so anyone who knows a private file's path opens it at \`${publicURL}\`.`,
      '',
      'Use a storage with `setPrivate`, such as `@ohnejs/s3` with tagging, or drop `uploads.publicURL`.',
    ].join('\n'),
  });
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

/**
 * Whether any row is private, read past every app scope.
 */
function anyPrivate(): Promise<boolean> {
  return queryUntyped('Uploads').unscoped().where({ private: true }).exists();
}
