import { deepStrictEqual, ok, rejects, strictEqual } from 'node:assert';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';

import { useLayers } from '../../../src/ohne/layers/use-layers.ts';
import { queryUntyped } from '../../../src/ohne/query/query.ts';
import { isValidationError } from '../../../src/ohne/query/write/errors.ts';
import { putUpload } from '../../../src/uploads/uploads/put-upload.ts';
import { bytes, JPEG_HEAD, png, storage, stream, text } from '../_fixture.ts';

function sha256(source: Uint8Array): string {
  return createHash('sha256').update(source).digest('hex');
}

function temps(): string[] {
  return [...storage.objects.keys()].filter((key) => key.startsWith('.tmp/'));
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

async function failure(run: () => Promise<unknown>): Promise<Record<string, unknown>> {
  let caught: unknown;
  await rejects(run, (error: unknown) => {
    caught = error;
    return isValidationError(error);
  });
  return (caught as { errors: Record<string, unknown> }).errors;
}

describe('putUpload', () => {
  it('lands the row and the object at the canonical path, hashed and sized', async () => {
    const source = bytes('hello, uploads');
    const upload = await putUpload({
      directory: 'Photos/2024 Summer/',
      name: 'Sunset At Sea.TXT',
      body: stream(source),
    });
    strictEqual(upload.kind, 'file');
    strictEqual(upload.directory, 'photos/2024-summer');
    strictEqual(upload.name, 'sunset-at-sea.txt');
    strictEqual(upload.path, 'photos/2024-summer/sunset-at-sea.txt');
    strictEqual(upload.url, '/uploads/photos/2024-summer/sunset-at-sea.txt');
    strictEqual(upload.type, 'text/plain');
    strictEqual(upload.size, source.byteLength);
    strictEqual(upload.hash, sha256(source));
    strictEqual(upload.width, null);
    strictEqual(upload.author, null);
    strictEqual(text(storage.objects.get(upload.path)), 'hello, uploads');
    deepStrictEqual(temps(), []);

    const row = await queryUntyped('Uploads').where({ UUID: upload.UUID }).findFirst();
    strictEqual(row?.hash, sha256(source));
    strictEqual(await queryUntyped('UploadsJournal').count(), 0);
  });

  it('creates the missing folder rows on the way', async () => {
    await putUpload({ directory: 'docs/reports/q3', name: 'notes.txt', body: stream(bytes('n')) });
    const folders = await queryUntyped('Uploads')
      .where({ kind: 'folder' })
      .whereAny((g) => [g.where({ directory: 'docs' }), g.where({ directory: 'docs/reports' })])
      .findMany();
    deepStrictEqual(folders.map((folder) => `${folder.directory}/${folder.name}`).sort(), [
      'docs/reports',
      'docs/reports/q3',
    ]);
    ok(
      await queryUntyped('Uploads').where({ directory: '', name: 'docs', kind: 'folder' }).exists(),
    );
  });

  it('suffixes a taken name, keeping the extension', async () => {
    const first = await putUpload({ directory: 'dupes', name: 'a.txt', body: stream(bytes('1')) });
    const second = await putUpload({ directory: 'dupes', name: 'a.txt', body: stream(bytes('2')) });
    const third = await putUpload({ directory: 'dupes', name: 'a.txt', body: stream(bytes('3')) });
    strictEqual(first.name, 'a.txt');
    strictEqual(second.name, 'a-2.txt');
    strictEqual(third.name, 'a-3.txt');
    strictEqual(text(storage.objects.get('dupes/a-3.txt')), '3');
  });

  it('stores the dimensions of an image', async () => {
    const upload = await putUpload({
      directory: '',
      name: 'tiny.png',
      body: stream(png(640, 480)),
    });
    strictEqual(upload.type, 'image/png');
    strictEqual(upload.width, 640);
    strictEqual(upload.height, 480);
  });

  it('refuses a type outside uploads.types with typeNotAllowed', async () => {
    useLayers().add({ path: '/uploads-images', input: { uploads: { types: ['image'] } } });
    try {
      const errors = await failure(() =>
        putUpload({ directory: '', name: 'page.html', body: stream(bytes('<p>')) }),
      );
      deepStrictEqual(errors, {
        name: { key: 'uploads.errors.typeNotAllowed', params: { type: 'text/html' } },
      });
      ok(await putUpload({ directory: '', name: 'ok.png', body: stream(png(1, 1)) }));
    } finally {
      useLayers().remove('/uploads-images');
    }
  });

  it('refuses bytes that contradict the extension, cleaning the temp object', async () => {
    const errors = await failure(() =>
      putUpload({ directory: '', name: 'photo.png', body: stream(JPEG_HEAD) }),
    );
    deepStrictEqual(errors, {
      name: {
        key: 'uploads.errors.contentMismatch',
        params: { type: 'image/png', detected: 'image/jpeg' },
      },
    });
    deepStrictEqual(temps(), []);
    strictEqual(await queryUntyped('Uploads').where({ name: 'photo.png' }).count(), 0);
  });

  it('sanitizes an SVG and measures the result', async () => {
    const markup =
      '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 12" onload="x()">' +
      '<script>alert(1)</script><rect width="1" height="1"/></svg>';
    const upload = await putUpload({
      directory: 'art',
      name: 'logo.svg',
      body: stream(bytes(markup)),
    });
    const stored = text(storage.objects.get('art/logo.svg'));
    ok(!stored.includes('script'));
    ok(!stored.includes('onload'));
    ok(stored.startsWith('<svg'));
    strictEqual(upload.size, bytes(stored).byteLength);
    strictEqual(upload.hash, sha256(bytes(stored)));
    strictEqual(upload.width, 24);
    strictEqual(upload.height, 12);
  });

  it('refuses a .svg that holds no svg', async () => {
    const errors = await failure(() =>
      putUpload({ directory: '', name: 'fake.svg', body: stream(bytes('just text')) }),
    );
    deepStrictEqual(errors, { name: 'uploads.errors.notSVG' });
    deepStrictEqual(temps(), []);
  });

  it('removes the temp object when the row cannot be written', async () => {
    await rejects(
      putUpload({ directory: '', name: 'orphan.txt', body: stream(bytes('x')), author: 'nobody' }),
      isValidationError,
    );
    deepStrictEqual(temps(), []);
    strictEqual(storage.objects.has('orphan.txt'), false);
  });

  it('lands a file inside a private folder as private, locking its object', async () => {
    await queryUntyped('Uploads').createOrThrow({
      kind: 'folder',
      directory: '',
      name: 'vault',
      private: true,
    });
    const upload = await putUpload({
      directory: 'vault',
      name: 'secret.txt',
      body: stream(bytes('s')),
    });
    strictEqual(upload.private, true);
    strictEqual(upload.url, '/uploads/vault/secret.txt');
    strictEqual(storage.visibility.get('vault/secret.txt'), true);
    strictEqual(await queryUntyped('UploadsJournal').count(), 0);
  });

  it('creates the folders a private one implies as private too', async () => {
    const upload = await putUpload({
      directory: 'vault/deep/er',
      name: 'n.txt',
      body: stream(bytes('n')),
    });
    strictEqual(upload.private, true);
    strictEqual(storage.visibility.get('vault/deep/er/n.txt'), true);
    deepStrictEqual(await privacy('vault'), {
      'vault/deep': true,
      'vault/deep/er': true,
      'vault/deep/er/n.txt': true,
      'vault/secret.txt': true,
    });
  });

  it('lands a file in a public folder as public, touching no visibility', async () => {
    const upload = await putUpload({
      directory: 'open',
      name: 'plain.txt',
      body: stream(bytes('p')),
    });
    strictEqual(upload.private, false);
    strictEqual(storage.visibility.has('open/plain.txt'), false);
    deepStrictEqual(await privacy('open'), { 'open/plain.txt': false });
  });
});
