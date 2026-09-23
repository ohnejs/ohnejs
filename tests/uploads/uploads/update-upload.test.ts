import { deepStrictEqual, match, ok, rejects, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { useEnv } from '../../../src/ohne/env/use-env.ts';
import { HTTPError } from '../../../src/ohne/http/http-error.ts';
import { queryUntyped } from '../../../src/ohne/query/query.ts';
import { isValidationError } from '../../../src/ohne/query/write/errors.ts';
import { putUpload } from '../../../src/uploads/uploads/put-upload.ts';
import { updateUpload } from '../../../src/uploads/uploads/update-upload.ts';
import { bytes, storage, stream } from '../_fixture.ts';

useEnv().set('UPLOADS_SECRET', 'secret');

async function privacy(prefix: string): Promise<Record<string, unknown>> {
  const rows = await queryUntyped('Uploads')
    .whereAny((g) => [
      g.where({ directory: prefix }),
      g.where({ directory: { startsWith: `${prefix}/` } }),
    ])
    .findMany();
  return Object.fromEntries(rows.map((row) => [`${row.directory}/${row.name}`, row.private]));
}

async function failure(run: Promise<unknown>): Promise<Record<string, unknown>> {
  let caught: unknown;
  await rejects(run, (error: unknown) => {
    caught = error;
    return isValidationError(error);
  });
  return (caught as { errors: Record<string, unknown> }).errors;
}

async function privateFolder(directory: string, name: string): Promise<string> {
  const folder = await queryUntyped('Uploads').createOrThrow({
    kind: 'folder',
    directory,
    name,
    private: true,
  });
  return folder.UUID as string;
}

function insideFolder(folder: string): Record<string, unknown> {
  return { private: { key: 'uploads.errors.insidePrivateFolder', params: { folder } } };
}

describe('updateUpload', () => {
  it('sets the description and the focal point, touching no storage', async () => {
    const upload = await putUpload({ directory: 'meta', name: 'a.txt', body: stream(bytes('a')) });
    const before = new Map(storage.objects);
    const updated = await updateUpload(upload.UUID, {
      description: 'A letter',
      focalX: 0.25,
      focalY: 0.75,
    });
    strictEqual(updated.description, 'A letter');
    strictEqual(updated.focalX, 0.25);
    strictEqual(updated.focalY, 0.75);
    strictEqual(updated.path, 'meta/a.txt');
    strictEqual(storage.objects.size, before.size);
    strictEqual(await queryUntyped('UploadsJournal').count(), 0);
  });

  it('writes the description at the given locale', async () => {
    const upload = await putUpload({ directory: 'meta', name: 'b.txt', body: stream(bytes('b')) });
    await updateUpload(upload.UUID, { description: 'English' });
    const german = await updateUpload(upload.UUID, { description: 'Deutsch' }, { locale: 'de' });
    strictEqual(german.description, 'Deutsch');
    const english = await queryUntyped('Uploads').where({ UUID: upload.UUID }).findFirst();
    strictEqual(english?.description, 'English');
  });

  it('refuses a focal point outside 0..1', async () => {
    const upload = await putUpload({ directory: 'meta', name: 'c.txt', body: stream(bytes('c')) });
    await rejects(updateUpload(upload.UUID, { focalX: 2 }), isValidationError);
  });

  it('locks and unlocks a file, journaling the change for storage', async () => {
    const upload = await putUpload({ directory: 'meta', name: 'd.txt', body: stream(bytes('d')) });
    const locked = await updateUpload(upload.UUID, { private: true });
    strictEqual(locked.private, true);
    match(locked.url ?? '', /^\/uploads\/meta\/d\.txt\?e=\d+&s=/);
    strictEqual(storage.visibility.get('meta/d.txt'), true);
    strictEqual(await queryUntyped('UploadsJournal').count(), 0);
    const open = await updateUpload(upload.UUID, { private: false });
    strictEqual(open.private, false);
    strictEqual(storage.visibility.get('meta/d.txt'), false);
  });

  it('leaves storage alone when private does not change', async () => {
    const upload = await putUpload({ directory: 'meta', name: 'e.txt', body: stream(bytes('e')) });
    await updateUpload(upload.UUID, { private: false });
    await updateUpload(upload.UUID, { description: 'still public' });
    strictEqual(storage.visibility.has('meta/e.txt'), false);
  });

  it('treats a row from before private uploads, holding null, as public', async () => {
    const upload = await putUpload({ directory: 'meta', name: 'f.txt', body: stream(bytes('f')) });
    await queryUntyped('Uploads').where({ UUID: upload.UUID }).updateOrThrow({ private: null });
    const updated = await updateUpload(upload.UUID, { private: false });
    strictEqual(updated.private, false);
    strictEqual(storage.visibility.has('meta/f.txt'), false);
  });

  it('ignores private while no secret makes the layer keep private files', async () => {
    const upload = await putUpload({ directory: 'meta', name: 'g.txt', body: stream(bytes('g')) });
    useEnv().unset('UPLOADS_SECRET');
    try {
      const updated = await updateUpload(upload.UUID, { private: true, description: 'Note' });
      strictEqual(updated.private, false);
      strictEqual(updated.description, 'Note');
      strictEqual(storage.visibility.has('meta/g.txt'), false);
      strictEqual(await queryUntyped('UploadsJournal').count(), 0);
    } finally {
      useEnv().set('UPLOADS_SECRET', 'secret');
    }
  });

  it('applies a folder toggle to everything inside it', async () => {
    await putUpload({ directory: 'toggle/a', name: 'one.txt', body: stream(bytes('1')) });
    await putUpload({ directory: 'toggle/a/b', name: 'two.txt', body: stream(bytes('2')) });
    const folder = await queryUntyped('Uploads')
      .where({ directory: 'toggle', name: 'a' })
      .findFirst();
    ok(folder);
    const uuid = folder.UUID as string;

    const locked = await updateUpload(uuid, { private: true });
    strictEqual(locked.private, true);
    deepStrictEqual(await privacy('toggle/a'), {
      'toggle/a/b': true,
      'toggle/a/b/two.txt': true,
      'toggle/a/one.txt': true,
    });
    strictEqual(storage.visibility.get('toggle/a/one.txt'), true);
    strictEqual(storage.visibility.get('toggle/a/b/two.txt'), true);

    const open = await updateUpload(uuid, { private: false });
    strictEqual(open.private, false);
    deepStrictEqual(await privacy('toggle/a'), {
      'toggle/a/b': false,
      'toggle/a/b/two.txt': false,
      'toggle/a/one.txt': false,
    });
    strictEqual(storage.visibility.get('toggle/a/b/two.txt'), false);
    strictEqual(await queryUntyped('UploadsJournal').count(), 0);
  });

  it('refuses to make a file public inside a private folder', async () => {
    await privateFolder('pin', 'vault');
    const upload = await putUpload({
      directory: 'pin/vault',
      name: 'a.txt',
      body: stream(bytes('a')),
    });
    strictEqual(upload.private, true);
    deepStrictEqual(
      await failure(updateUpload(upload.UUID, { private: false })),
      insideFolder('pin/vault'),
    );
    const row = await queryUntyped('Uploads').where({ UUID: upload.UUID }).findFirst();
    strictEqual(row?.private, true);
    strictEqual(storage.visibility.get('pin/vault/a.txt'), true);
    strictEqual(await queryUntyped('UploadsJournal').count(), 0);
  });

  it('refuses to make a subfolder public inside a private folder, keeping its subtree locked', async () => {
    await privateFolder('pin-tree', 'vault');
    await putUpload({ directory: 'pin-tree/vault/sub', name: 'b.txt', body: stream(bytes('b')) });
    const sub = await queryUntyped('Uploads')
      .where({ directory: 'pin-tree/vault', name: 'sub' })
      .findFirst();
    ok(sub);
    deepStrictEqual(
      await failure(updateUpload(sub.UUID as string, { private: false })),
      insideFolder('pin-tree/vault'),
    );
    deepStrictEqual(await privacy('pin-tree/vault'), {
      'pin-tree/vault/sub': true,
      'pin-tree/vault/sub/b.txt': true,
    });
    strictEqual(storage.visibility.get('pin-tree/vault/sub/b.txt'), true);
  });

  it('edits a row left public inside a private folder, and locks it on request', async () => {
    const upload = await putUpload({ directory: 'mixed', name: 'c.txt', body: stream(bytes('c')) });
    await queryUntyped('Uploads')
      .where({ kind: 'folder', directory: '', name: 'mixed' })
      .updateOrThrow({ private: true });
    const edited = await updateUpload(upload.UUID, { description: 'Still public' });
    strictEqual(edited.private, false);
    strictEqual(edited.description, 'Still public');
    const locked = await updateUpload(upload.UUID, { private: true });
    strictEqual(locked.private, true);
    strictEqual(storage.visibility.get('mixed/c.txt'), true);
  });

  it('404s an unknown UUID', async () => {
    await rejects(
      updateUpload('missing', { description: 'x' }),
      (error: unknown) => error instanceof HTTPError && error.status === 404,
    );
  });
});
