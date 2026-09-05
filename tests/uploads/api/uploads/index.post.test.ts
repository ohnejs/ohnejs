import { ok, strictEqual } from 'node:assert';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';

import { queryUntyped } from '../../../../src/ohne/query/query.ts';
import indexPost from '../../../../src/uploads/api/uploads/index.post.ts';
import {
  bytes,
  call,
  errorsOf,
  JPEG_HEAD,
  route,
  storage,
  stream,
  text,
  userWith,
} from '../../_fixture.ts';

const upload = route('POST', '/uploads', indexPost);
const admin = await userWith('admin@example.com', ['uploads-admin']);
const nobody = await userWith('nobody@example.com', []);

describe('POST /uploads', () => {
  it('streams the body into a file and answers 201 with the record', async () => {
    const source = bytes('streamed through dispatch');
    const response = await call(
      upload,
      '/uploads?directory=Inbox/Today&name=Note.TXT',
      {},
      {
        bearer: admin,
        body: stream(source),
      },
    );
    strictEqual(response.status, 201);
    const record = (await response.json()) as Record<string, unknown>;
    strictEqual(record.path, 'inbox/today/note.txt');
    strictEqual(record.url, '/uploads/inbox/today/note.txt');
    strictEqual(record.type, 'text/plain');
    strictEqual(record.size, source.byteLength);
    strictEqual(record.hash, createHash('sha256').update(source).digest('hex'));
    strictEqual(text(storage.objects.get('inbox/today/note.txt')), 'streamed through dispatch');

    const user = await queryUntyped('Users').where({ email: 'admin@example.com' }).findFirst();
    strictEqual(record.author, user?.UUID);
  });

  it('reads the raw search params as text', async () => {
    const response = await call(
      upload,
      '/uploads?name=123',
      {},
      { bearer: admin, body: stream(bytes('n')) },
    );
    strictEqual(response.status, 201);
    strictEqual(((await response.json()) as { name: string }).name, '123');
  });

  it('400s a missing name or body', async () => {
    const noName = await call(
      upload,
      '/uploads?directory=x',
      {},
      { bearer: admin, body: stream(bytes('n')) },
    );
    strictEqual(noName.status, 400);
    const noBody = await call(upload, '/uploads?name=x.txt', {}, { bearer: admin });
    strictEqual(noBody.status, 400);
  });

  it('422s content that contradicts the extension, naming the key', async () => {
    const response = await call(
      upload,
      '/uploads?name=photo.png',
      {},
      { bearer: admin, body: stream(JPEG_HEAD) },
    );
    strictEqual(response.status, 422);
    strictEqual(errorsOf(await response.json()).name, 'uploads.errors.contentMismatch');
    ok(![...storage.objects.keys()].some((key) => key.startsWith('.tmp/')));
  });

  it('401s without a user and 403s without the capability', async () => {
    strictEqual(
      (await call(upload, '/uploads?name=a.txt', {}, { body: stream(bytes('a')) })).status,
      401,
    );
    const forbidden = await call(
      upload,
      '/uploads?name=a.txt',
      {},
      { bearer: nobody, body: stream(bytes('a')) },
    );
    strictEqual(forbidden.status, 403);
    strictEqual(storage.objects.has('a.txt'), false);
  });
});
