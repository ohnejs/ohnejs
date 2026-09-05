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
});
