import { hook, queryMetadata, queryUntyped, useDatabase, useDialect, usePrinter } from 'ohnejs';
import { chunk, isEmpty } from 'ohnejs/utils';

import type { UploadRow } from '../uploads/_row.ts';

import { uploadPath } from '../uploads/path.ts';
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

// Rows left public before a private folder locked its contents stay public, so no embedded link breaks.
hook('server:ready', async () => {
  if (isEmpty(uploadSecrets())) return;
  const paths = await publicInsidePrivate();
  if (paths.length === 0) return;
  usePrinter().warnBlock({
    title: 'Public uploads inside a private folder',
    body: [
      'These rows stay public although their folder is private:',
      '',
      ...paths.map((path) => `- \`${path}\``),
      '',
      'Make each one private in the dashboard or with `updateUpload`.',
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
 * The paths of public rows directly inside a private folder, sorted.
 * Each public row under a private folder has one on its path, so a public subfolder is listed once.
 */
async function publicInsidePrivate(): Promise<string[]> {
  const folders = (await queryUntyped('Uploads')
    .where({ kind: 'folder', private: true })
    .select('directory', 'name')
    .findMany()) as UploadRow[];
  const paths: string[] = [];
  for (const batch of chunk(folders.map(uploadPath), 900)) {
    const rows = (await queryUntyped('Uploads')
      .where({ private: false, directory: { in: batch } })
      .select('directory', 'name')
      .findMany()) as UploadRow[];
    paths.push(...rows.map(uploadPath));
  }
  return paths.sort();
}
