import { deepStrictEqual, rejects, strictEqual } from 'node:assert';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';

import { HTTPError } from '../../../src/ohne/http/http-error.ts';
import { queryUntyped } from '../../../src/ohne/query/query.ts';
import { isValidationError } from '../../../src/ohne/query/write/errors.ts';
import { createFolder } from '../../../src/uploads/uploads/create-folder.ts';
import { putUpload } from '../../../src/uploads/uploads/put-upload.ts';
import { replaceUpload } from '../../../src/uploads/uploads/replace-upload.ts';
import { bytes, JPEG_HEAD, png, storage, stream, text } from '../_fixture.ts';

function temps(): string[] {
  return [...storage.objects.keys()].filter((key) => key.startsWith('.tmp/'));
}

describe('replaceUpload', () => {
  it('swaps the bytes, hash, size, and dimensions, keeping the path', async () => {
    const upload = await putUpload({ directory: 'swap', name: 'pic.png', body: stream(png(2, 2)) });
    const next = png(300, 200);
    const replaced = await replaceUpload(upload.UUID, stream(next), { size: next.byteLength });
    strictEqual(replaced.UUID, upload.UUID);
    strictEqual(replaced.path, 'swap/pic.png');
    strictEqual(replaced.size, next.byteLength);
    strictEqual(replaced.hash, createHash('sha256').update(next).digest('hex'));
    strictEqual(replaced.width, 300);
    strictEqual(replaced.height, 200);
    deepStrictEqual(storage.objects.get('swap/pic.png'), next);
    deepStrictEqual(temps(), []);
    strictEqual(await queryUntyped('UploadsJournal').count(), 0);
  });

  it('refuses bytes that contradict the row type, cleaning the temp object', async () => {
    const upload = await putUpload({
      directory: 'swap',
      name: 'text.txt',
      body: stream(bytes('t')),
    });
    await rejects(replaceUpload(upload.UUID, stream(JPEG_HEAD)), (error: unknown) => {
      return (
        isValidationError(error) &&
        deepStrictEqual(error.errors, {
          name: {
            key: 'uploads.errors.contentMismatch',
            params: { type: 'text/plain', detected: 'image/jpeg' },
          },
        }) === undefined
      );
    });
    strictEqual(text(storage.objects.get('swap/text.txt')), 't');
    deepStrictEqual(temps(), []);
  });

  it('refuses a folder', async () => {
    const folder = await createFolder({ directory: 'swap', name: 'folder' });
    await rejects(replaceUpload(folder.UUID, stream(bytes('x'))), (error: unknown) => {
      return isValidationError(error) && error.errors.name === 'uploads.errors.notAFile';
    });
  });

  it('404s an unknown UUID', async () => {
    await rejects(
      replaceUpload('missing', stream(bytes('x'))),
      (error: unknown) => error instanceof HTTPError && error.status === 404,
    );
  });
});
