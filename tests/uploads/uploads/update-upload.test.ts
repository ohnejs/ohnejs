import { rejects, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { HTTPError } from '../../../src/ohne/http/http-error.ts';
import { queryUntyped } from '../../../src/ohne/query/query.ts';
import { isValidationError } from '../../../src/ohne/query/write/errors.ts';
import { putUpload } from '../../../src/uploads/uploads/put-upload.ts';
import { updateUpload } from '../../../src/uploads/uploads/update-upload.ts';
import { bytes, storage, stream } from '../_fixture.ts';

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

  it('404s an unknown UUID', async () => {
    await rejects(
      updateUpload('missing', { description: 'x' }),
      (error: unknown) => error instanceof HTTPError && error.status === 404,
    );
  });
});
