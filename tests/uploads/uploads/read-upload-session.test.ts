import { deepStrictEqual, ok, rejects, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { HTTPError } from '../../../src/ohne/http/http-error.ts';
import { translate } from '../../../src/ohne/http/translate.ts';
import { queryUntyped } from '../../../src/ohne/query/query.ts';
import { createUploadSession } from '../../../src/uploads/uploads/create-upload-session.ts';
import { readUploadSession } from '../../../src/uploads/uploads/read-upload-session.ts';
import { holdSession, promptly, storage } from '../_fixture.ts';

/**
 * Creates a user named by `email` and resolves its `UUID`.
 */
async function user(email: string): Promise<string> {
  const created = await queryUntyped('Users').createOrThrow({
    email,
    password: 'pw-123456',
    roles: [],
  });
  return created.UUID as string;
}

/**
 * The session row `uuid`, `undefined` once it is gone.
 */
function row(uuid: string): Promise<Record<string, unknown> | undefined> {
  return queryUntyped('UploadsSessions').unscoped().where({ UUID: uuid }).findFirst();
}

/**
 * Sets fields of the session row `uuid` directly, as a crash or the clock would leave them.
 */
function tamper(uuid: string, fields: Record<string, unknown>): Promise<unknown> {
  return queryUntyped('UploadsSessions').unscoped().where({ UUID: uuid }).updateOrThrow(fields);
}

/**
 * The `HTTPError` `run` rejects with.
 */
async function refusal(run: () => Promise<unknown>): Promise<HTTPError> {
  let caught: unknown;
  await rejects(run, (error: unknown) => {
    caught = error;
    return error instanceof HTTPError;
  });
  return caught as HTTPError;
}

const jaina = await user('jaina@theramore.test');
const kael = await user('kael@quel-thalas.test');

describe('readUploadSession', () => {
  it('resolves the session its author reads, as create answered it', async () => {
    const session = await createUploadSession({
      directory: 'Theramore',
      name: 'Isle Map.png',
      size: 64,
      author: jaina,
    });

    deepStrictEqual(await readUploadSession(session.UUID, { author: jaina }), session);
  });

  it('reaches any session when no author is given, for server code', async () => {
    const session = await createUploadSession({ name: 'dalaran.txt', size: 5, author: jaina });

    deepStrictEqual(await readUploadSession(session.UUID), session);
  });

  it('answers the plain 404 for an unknown session and for a foreign one', async () => {
    const session = await createUploadSession({ name: 'sunwell.txt', size: 5, author: kael });

    for (const run of [
      () => readUploadSession(session.UUID, { author: jaina }),
      () => readUploadSession('01890a5d-ac96-774b-bcce-b302099a8057', { author: jaina }),
    ]) {
      const error = await refusal(run);
      strictEqual(error.status, 404);
      strictEqual(error.message, translate('api.http.notFound'));
    }
    ok(await row(session.UUID));
  });

  it('discards an expired session its author reads and answers sessionExpired', async () => {
    const session = await createUploadSession({ name: 'stratholme.txt', size: 5, author: jaina });
    const { token } = (await row(session.UUID))!;
    await tamper(session.UUID, { expiresAt: Date.now() - 1 });

    const error = await refusal(() => readUploadSession(session.UUID, { author: jaina }));

    strictEqual(error.status, 404);
    strictEqual(error.message, translate('uploads.errors.sessionExpired'));
    strictEqual(await row(session.UUID), undefined);
    strictEqual(storage.unfinished.has(token as string), false);
  });

  it('answers sessionExpired to every concurrent read of an expired session', async () => {
    const session = await createUploadSession({ name: 'lordaeron.txt', size: 5, author: jaina });
    await tamper(session.UUID, { expiresAt: Date.now() - 1 });

    const reads = await Promise.allSettled([
      readUploadSession(session.UUID, { author: jaina }),
      readUploadSession(session.UUID, { author: jaina }),
    ]);

    const expired = translate('uploads.errors.sessionExpired');
    deepStrictEqual(
      reads.map((read) => read.status === 'rejected' && (read.reason as HTTPError).message),
      [expired, expired],
    );
    strictEqual(await row(session.UUID), undefined);
  });

  it('keeps an expired session a stranger reads, answering the plain 404', async () => {
    const session = await createUploadSession({ name: 'silvermoon.txt', size: 5, author: kael });
    await tamper(session.UUID, { expiresAt: Date.now() - 1 });

    const error = await refusal(() => readUploadSession(session.UUID, { author: jaina }));

    strictEqual(error.message, translate('api.http.notFound'));
    ok(await row(session.UUID));
    await rejects(readUploadSession(session.UUID, { author: kael }));
  });

  it('discards a session whose handle a crash lost, answering sessionExpired', async () => {
    const session = await createUploadSession({ name: 'andorhal.txt', size: 5, author: jaina });
    await tamper(session.UUID, { token: null });

    const error = await refusal(() => readUploadSession(session.UUID, { author: jaina }));

    strictEqual(error.message, translate('uploads.errors.sessionExpired'));
    strictEqual(await row(session.UUID), undefined);
  });

  it('still answers sessionExpired when the discard fails, keeping the row for the sweep', async () => {
    const session = await createUploadSession({ name: 'hearthglen.txt', size: 5, author: jaina });
    await tamper(session.UUID, { expiresAt: Date.now() - 1 });
    storage.failNext('abort');

    const error = await refusal(() => readUploadSession(session.UUID, { author: jaina }));

    strictEqual(error.message, translate('uploads.errors.sessionExpired'));
    ok(await row(session.UUID));
    await rejects(readUploadSession(session.UUID, { author: jaina }));
    strictEqual(await row(session.UUID), undefined);
  });

  it('answers sessionExpired at once for an expired session a request holds, leaving it to the holder', async () => {
    const session = await createUploadSession({ name: 'scholomance.txt', size: 5, author: jaina });
    await tamper(session.UUID, { expiresAt: Date.now() - 1 });
    const release = await holdSession(session.UUID);
    try {
      const read = readUploadSession(session.UUID, { author: jaina }).catch(
        (error: HTTPError) => error.message,
      );

      strictEqual(await promptly(read), translate('uploads.errors.sessionExpired'));
      ok(await row(session.UUID));
    } finally {
      await release();
    }
  });
});
