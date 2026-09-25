import { deepStrictEqual, ok, rejects, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { useEnv } from '../../../src/ohne/env/use-env.ts';
import { HTTPError } from '../../../src/ohne/http/http-error.ts';
import { queryMetadata } from '../../../src/ohne/query/metadata.ts';
import { queryUntyped } from '../../../src/ohne/query/query.ts';
import { isValidationError } from '../../../src/ohne/query/write/errors.ts';
import { moveUpload } from '../../../src/uploads/uploads/move-upload.ts';
import { putUpload } from '../../../src/uploads/uploads/put-upload.ts';
import { bytes, db, storage, stream, text } from '../_fixture.ts';

useEnv().set('UPLOADS_SECRET', 'secret');

const SEGMENT = 'silvermoon'.repeat(26).slice(0, 255);

async function put(directory: string, name: string, content: string): Promise<string> {
  const upload = await putUpload({ directory, name, body: stream(bytes(content)) });
  return upload.UUID;
}

async function folderUUID(directory: string, name: string): Promise<string> {
  const row = await queryUntyped('Uploads').where({ directory, name, kind: 'folder' }).findFirst();
  ok(row);
  return row.UUID as string;
}

async function paths(prefix: string): Promise<string[]> {
  const rows = await queryUntyped('Uploads')
    .whereAny((g) => [
      g.where({ directory: prefix }),
      g.where({ directory: { startsWith: `${prefix}/` } }),
    ])
    .findMany();
  return rows.map((row) => `${row.directory}/${row.name}`).sort();
}

async function privacy(prefix: string): Promise<Record<string, unknown>> {
  const rows = await queryUntyped('Uploads')
    .whereAny((g) => [
      g.where({ directory: prefix }),
      g.where({ directory: { startsWith: `${prefix}/` } }),
    ])
    .findMany();
  return Object.fromEntries(rows.map((row) => [`${row.directory}/${row.name}`, row.private]));
}

async function privateFolder(directory: string, name: string): Promise<void> {
  await queryUntyped('Uploads').createOrThrow({ kind: 'folder', directory, name, private: true });
}

function objects(prefix: string): string[] {
  return [...storage.objects.keys()].filter((key) => key.startsWith(prefix)).sort();
}

async function lockFolder(directory: string, name: string): Promise<void> {
  await queryUntyped('Uploads')
    .where({ kind: 'folder', directory, name })
    .updateOrThrow({ private: true });
}

async function failure(run: () => Promise<unknown>): Promise<Record<string, unknown>> {
  let caught: unknown;
  await rejects(run, (error: unknown) => {
    caught = error;
    return isValidationError(error);
  });
  return (caught as { errors: Record<string, unknown> }).errors;
}

/**
 * Rewrites a row's columns in raw SQL past the sanitizers, and moves the object `from` `to` when given.
 * That is a row stored before names and folder segments were capped at 255 bytes.
 */
async function legacy(
  uuid: string,
  columns: { directory?: string; name?: string },
  from?: string,
  to?: string,
): Promise<void> {
  const { table } = queryMetadata('Uploads');
  for (const [column, value] of Object.entries(columns)) {
    await db.run(`UPDATE "${table}" SET "${column}" = ? WHERE "UUID" = ?`, [value, uuid]);
  }
  if (from && to) {
    storage.objects.set(to, storage.objects.get(from)!);
    storage.objects.delete(from);
  }
}

describe('moveUpload', () => {
  it('renames a file, moving its object and canonicalizing the name', async () => {
    const uuid = await put('rename', 'a.txt', 'one');
    const moved = await moveUpload(uuid, { name: 'B Renamed.TXT' });
    strictEqual(moved.name, 'b-renamed.txt');
    strictEqual(moved.path, 'rename/b-renamed.txt');
    strictEqual(text(storage.objects.get('rename/b-renamed.txt')), 'one');
    strictEqual(storage.objects.has('rename/a.txt'), false);
    strictEqual(await queryUntyped('UploadsJournal').count(), 0);
  });

  it('moves a file into another directory, creating the folders on the way', async () => {
    const uuid = await put('from', 'deep.txt', 'd');
    const moved = await moveUpload(uuid, { directory: 'to/deeper/still' });
    strictEqual(moved.path, 'to/deeper/still/deep.txt');
    strictEqual(text(storage.objects.get('to/deeper/still/deep.txt')), 'd');
    ok(await queryUntyped('Uploads').where({ directory: 'to/deeper', name: 'still' }).exists());
  });

  it('keeps a file extension', async () => {
    const uuid = await put('ext', 'keep.txt', 'k');
    const errors = await failure(() => moveUpload(uuid, { name: 'keep.md' }));
    deepStrictEqual(errors, { name: 'uploads.errors.extensionChange' });
    strictEqual(text(storage.objects.get('ext/keep.txt')), 'k');
  });

  it('moves a folder, rewriting every descendant and the object prefix', async () => {
    await put('tree/a', 'one.txt', '1');
    await put('tree/a/b', 'two.txt', '2');
    const uuid = await folderUUID('tree', 'a');

    const moved = await moveUpload(uuid, { directory: 'tree/moved', name: 'x' });
    strictEqual(moved.path, 'tree/moved/x');
    deepStrictEqual(await paths('tree'), [
      'tree/moved',
      'tree/moved/x',
      'tree/moved/x/b',
      'tree/moved/x/b/two.txt',
      'tree/moved/x/one.txt',
    ]);
    deepStrictEqual(objects('tree/'), ['tree/moved/x/b/two.txt', 'tree/moved/x/one.txt']);
    strictEqual(text(storage.objects.get('tree/moved/x/b/two.txt')), '2');
  });

  it('refuses to move a folder into itself', async () => {
    await put('self/a/b', 'leaf.txt', 'l');
    const uuid = await folderUUID('self', 'a');
    for (const directory of ['self/a', 'self/a/b']) {
      const errors = await failure(() => moveUpload(uuid, { directory }));
      deepStrictEqual(errors, { directory: 'uploads.errors.folderIntoItself' });
    }
    deepStrictEqual(objects('self/'), ['self/a/b/leaf.txt']);
  });

  it('answers the record untouched when nothing changes', async () => {
    const uuid = await put('same', 'still.txt', 's');
    const unchanged = await moveUpload(uuid, { directory: 'Same/', name: 'Still.TXT' });
    strictEqual(unchanged.path, 'same/still.txt');
    strictEqual(await queryUntyped('UploadsJournal').count(), 0);
  });

  it('locks a file moved into a private folder', async () => {
    await privateFolder('lock', 'vault');
    const uuid = await put('lock', 'in.txt', 'i');
    const moved = await moveUpload(uuid, { directory: 'lock/vault' });
    strictEqual(moved.private, true);
    strictEqual(storage.visibility.get('lock/vault/in.txt'), true);
    strictEqual(await queryUntyped('UploadsJournal').count(), 0);
  });

  it('locks a folder moved into a private one, with everything inside it', async () => {
    await put('cascade/src', 'one.txt', '1');
    await put('cascade/src/sub', 'two.txt', '2');
    await privateFolder('cascade', 'vault');
    const uuid = await folderUUID('cascade', 'src');
    const moved = await moveUpload(uuid, { directory: 'cascade/vault' });
    strictEqual(moved.private, true);
    deepStrictEqual(await privacy('cascade/vault'), {
      'cascade/vault/src': true,
      'cascade/vault/src/one.txt': true,
      'cascade/vault/src/sub': true,
      'cascade/vault/src/sub/two.txt': true,
    });
    strictEqual(storage.visibility.get('cascade/vault/src/one.txt'), true);
    strictEqual(storage.visibility.get('cascade/vault/src/sub/two.txt'), true);
    strictEqual(await queryUntyped('UploadsJournal').count(), 0);
  });

  it('leaves a public file public when renamed inside a private folder', async () => {
    const uuid = await put('rename-in/vault', 'brochure.txt', 'b');
    await lockFolder('rename-in', 'vault');
    const renamed = await moveUpload(uuid, { name: 'brochure-2026.txt' });
    strictEqual(renamed.path, 'rename-in/vault/brochure-2026.txt');
    strictEqual(renamed.private, false);
    strictEqual(storage.visibility.has('rename-in/vault/brochure-2026.txt'), false);
    strictEqual(await queryUntyped('UploadsJournal').count(), 0);
  });

  it('leaves a public folder and its subtree public when renamed inside a private folder', async () => {
    await put('rename-tree/vault/open', 'one.txt', '1');
    await lockFolder('rename-tree', 'vault');
    const uuid = await folderUUID('rename-tree/vault', 'open');
    await moveUpload(uuid, { name: 'shared' });
    deepStrictEqual(await privacy('rename-tree/vault'), {
      'rename-tree/vault/shared': false,
      'rename-tree/vault/shared/one.txt': false,
    });
  });

  it('keeps a private file private when moved out', async () => {
    await privateFolder('keep', 'vault');
    const uuid = await put('keep/vault', 'stay.txt', 's');
    const moved = await moveUpload(uuid, { directory: 'keep' });
    strictEqual(moved.path, 'keep/stay.txt');
    strictEqual(moved.private, true);
    strictEqual(await queryUntyped('UploadsJournal').count(), 0);
    strictEqual(storage.visibility.get('keep/stay.txt'), true);
  });

  it('422s a move into a path a file holds, moving nothing', async () => {
    const file = await put('into', 'notes', 'n');
    const other = await put('into', 'b.txt', 'b');
    await rejects(moveUpload(other, { directory: 'into/notes' }), (error: unknown) => {
      if (!isValidationError(error)) return false;
      deepStrictEqual(error.errors, {
        directory: { key: 'uploads.errors.notAFolder', params: { path: 'into/notes' } },
      });
      return true;
    });
    deepStrictEqual(await paths('into'), ['into/b.txt', 'into/notes']);
    strictEqual(text(storage.objects.get('into/b.txt')), 'b');
    await moveUpload(file, { name: 'notes-2' });
  });

  it('422s a rename or move past 768 bytes, the deepest descendant included, moving nothing', async () => {
    const directory = `quelthalas/${SEGMENT}/${SEGMENT}`;
    const file = await put(directory, 'sunwell.txt', 'Kael');
    const folder = await folderUUID('', 'quelthalas');
    for (const [uuid, to] of [
      [file, { name: `${SEGMENT.slice(0, 250)}.txt` }],
      [folder, { name: SEGMENT }],
      [folder, { directory: SEGMENT }],
    ] as const) {
      await rejects(moveUpload(uuid, to), (error: unknown) => {
        if (!isValidationError(error)) return false;
        deepStrictEqual(error.errors, {
          directory: { key: 'uploads.errors.pathTooLong', params: { max: 768 } },
        });
        return true;
      });
    }
    deepStrictEqual(await paths(directory), [`${directory}/sunwell.txt`]);
    strictEqual(text(storage.objects.get(`${directory}/sunwell.txt`)), 'Kael');
    strictEqual(
      await queryUntyped('Uploads').where({ directory: '', name: SEGMENT }).exists(),
      false,
    );
    strictEqual(await queryUntyped('UploadsJournal').count(), 0);
  });

  it('renames a folder already past 768 bytes to a shorter path', async () => {
    const legacy = await queryUntyped('Uploads').createOrThrow({
      kind: 'folder',
      directory: '',
      name: 'lordaeron',
    });
    const directory = `lordaeron/${SEGMENT}/${SEGMENT}/${SEGMENT}`;
    await queryUntyped('Uploads').createOrThrow({ kind: 'folder', directory, name: 'capital' });
    const renamed = await moveUpload(legacy.UUID as string, { name: 'brill' });
    strictEqual(renamed.path, 'brill');
    deepStrictEqual(await paths(`brill/${SEGMENT}/${SEGMENT}/${SEGMENT}`), [
      `brill/${SEGMENT}/${SEGMENT}/${SEGMENT}/capital`,
    ]);
  });

  it('keeps a legacy name past 255 bytes on its object when moved', async () => {
    const uuid = await put('arathi', 'a.txt', 'Thoradin');
    const name = `${'x'.repeat(296)}.txt`;
    await legacy(uuid, { name }, 'arathi/a.txt', `arathi/${name}`);
    const moved = await moveUpload(uuid, { directory: 'stromgarde' });
    strictEqual(moved.path, `stromgarde/${name}`);
    strictEqual(text(storage.objects.get(`stromgarde/${name}`)), 'Thoradin');
    deepStrictEqual(objects('arathi/'), []);
  });

  it('keeps a row inside a legacy folder past 255 bytes on its object when renamed', async () => {
    const uuid = await put('gilneas', 'a.txt', 'Greymane');
    const directory = 'g'.repeat(300);
    await legacy(uuid, { directory }, 'gilneas/a.txt', `${directory}/a.txt`);
    const renamed = await moveUpload(uuid, { name: 'b.txt' });
    strictEqual(renamed.path, `${directory}/b.txt`);
    strictEqual(text(storage.objects.get(`${directory}/b.txt`)), 'Greymane');
  });

  it('moves a legacy folder past 255 bytes with its subtree and objects together', async () => {
    const child = await put('alterac/keep', 'crown.txt', 'Perenolde');
    const folder = await folderUUID('alterac', 'keep');
    const name = 'k'.repeat(300);
    await legacy(folder, { name }, 'alterac/keep/crown.txt', `alterac/${name}/crown.txt`);
    await legacy(child, { directory: `alterac/${name}` });
    await moveUpload(folder, { directory: 'ruins' });
    deepStrictEqual(await paths('ruins'), [`ruins/${name}`, `ruins/${name}/crown.txt`]);
    strictEqual(text(storage.objects.get(`ruins/${name}/crown.txt`)), 'Perenolde');
  });

  it('caps a legacy name past 255 bytes when it is renamed, the object following', async () => {
    const uuid = await put('kultiras', 'a.txt', 'Proudmoore');
    const name = `${'y'.repeat(296)}.txt`;
    await legacy(uuid, { name }, 'kultiras/a.txt', `kultiras/${name}`);
    const renamed = await moveUpload(uuid, { name: `${'z'.repeat(296)}.txt` });
    strictEqual(renamed.name, `${'z'.repeat(251)}.txt`);
    strictEqual(text(storage.objects.get(`kultiras/${renamed.name}`)), 'Proudmoore');
    deepStrictEqual(objects('kultiras/'), [`kultiras/${renamed.name}`]);
  });

  it('404s an unknown UUID', async () => {
    await rejects(
      moveUpload('missing', { name: 'x.txt' }),
      (error: unknown) => error instanceof HTTPError && error.status === 404,
    );
  });
});
