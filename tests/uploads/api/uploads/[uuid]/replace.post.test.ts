import { deepStrictEqual, strictEqual } from 'node:assert';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';

import replacePost from '../../../../../src/uploads/api/uploads/[uuid]/replace.post.ts';
import { createFolder } from '../../../../../src/uploads/uploads/create-folder.ts';
import { putUpload } from '../../../../../src/uploads/uploads/put-upload.ts';
import {
  bytes,
  call,
  errorsOf,
  png,
  route,
  storage,
  stream,
  text,
  userWith,
} from '../../../_fixture.ts';

const replace = route('POST', '/uploads/[uuid]/replace', replacePost);
const admin = await userWith('admin@example.com', ['uploads-admin']);

function send(uuid: string, body?: ReadableStream<Uint8Array>, bearer?: string): Promise<Response> {
  return call(replace, `/uploads/${uuid}/replace`, { uuid }, { bearer, body });
}

describe('POST /uploads/[uuid]/replace', () => {
  it('swaps the bytes and answers the record', async () => {
    const upload = await putUpload({ directory: 'rep', name: 'pic.png', body: stream(png(1, 1)) });
    const next = png(64, 32);
    const response = await send(upload.UUID, stream(next), admin);
    strictEqual(response.status, 200);
    const record = (await response.json()) as Record<string, unknown>;
    strictEqual(record.path, 'rep/pic.png');
    strictEqual(record.hash, createHash('sha256').update(next).digest('hex'));
    strictEqual(record.width, 64);
    deepStrictEqual(storage.objects.get('rep/pic.png'), next);
  });

  it('422s a folder, naming the key', async () => {
    const folder = await createFolder({ directory: 'rep', name: 'folder' });
    const response = await send(folder.UUID, stream(bytes('x')), admin);
    strictEqual(response.status, 422);
    strictEqual(errorsOf(await response.json()).name, 'uploads.errors.notAFile');
  });

  it('400s a missing body and 404s an unknown UUID', async () => {
    const upload = await putUpload({ directory: 'rep', name: 'a.txt', body: stream(bytes('a')) });
    strictEqual((await send(upload.UUID, undefined, admin)).status, 400);
    strictEqual((await send('missing', stream(bytes('x')), admin)).status, 404);
  });

  it('401s without a user', async () => {
    const upload = await putUpload({ directory: 'rep', name: 'b.txt', body: stream(bytes('b')) });
    strictEqual((await send(upload.UUID, stream(bytes('c')))).status, 401);
    strictEqual(text(storage.objects.get('rep/b.txt')), 'b');
  });
});
