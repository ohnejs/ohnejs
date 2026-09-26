import { deepStrictEqual, match, ok, rejects, strictEqual } from 'node:assert';
import { after, describe, it } from 'node:test';

import type { StorageParts } from '../../../src/uploads/storage/adapter.ts';
import type { UploadSession } from '../../../src/uploads/uploads/types.ts';

import { useLayers } from '../../../src/ohne/layers/use-layers.ts';
import { usePrinter } from '../../../src/ohne/printer/use-printer.ts';
import { queryUntyped } from '../../../src/ohne/query/query.ts';
import { drainJournal } from '../../../src/uploads/storage/journal.ts';
import { sessionTemp, withSessionLock } from '../../../src/uploads/uploads/_session.ts';
import { completeUploadSession } from '../../../src/uploads/uploads/complete-upload-session.ts';
import { createUploadSession } from '../../../src/uploads/uploads/create-upload-session.ts';
import { putUpload } from '../../../src/uploads/uploads/put-upload.ts';
import { sweepUploadSessions } from '../../../src/uploads/uploads/sweep-upload-sessions.ts';
import { writeUploadChunk } from '../../../src/uploads/uploads/write-upload-chunk.ts';
import { bytes, db, holdSession, promptly, storage, stream } from '../_fixture.ts';

const LAYER = '/uploads-sessions-sweep';
useLayers().add({ path: LAYER, input: { uploads: { chunkSize: 16 } } });
after(() => useLayers().remove(LAYER));

const written: string[] = [];
usePrinter().configure({
  stream: {
    write: (chunk: string | Uint8Array) => {
      written.push(String(chunk));
      return true;
    },
  },
  color: false,
});

const RUNE = bytes('Death knights of Acherus, rise and serve the Scourge!');

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
 * Opens a session for `RUNE` at `directory`/`name` and sends its chunks up to `until`.
 */
async function upload(
  directory: string,
  name: string,
  until = RUNE.byteLength,
): Promise<UploadSession> {
  let session = await createUploadSession({ directory, name, size: RUNE.byteLength });
  while (session.offset < until) {
    const { offset, chunkSize } = session;
    const chunk = { offset, bytes: RUNE.subarray(offset, offset + chunkSize) };
    session = await writeUploadChunk(session.UUID, chunk);
  }
  return session;
}

/**
 * Leaves the lock of the session `uuid` as a holder that crashed 21 seconds ago would, never renewed since.
 */
async function crashedHolder(uuid: string): Promise<void> {
  await withSessionLock(uuid, async () => undefined);
  await db.run('INSERT INTO "ohne_locks" ("key", "nonce", "acquiredAt") VALUES (?, ?, ?)', [
    `uploads:session:${uuid}`,
    'crashed',
    Date.now() - 21_000,
  ]);
}

/**
 * The storage handle of the session `uuid`.
 */
async function tokenOf(uuid: string): Promise<string> {
  return (await row(uuid))?.token as string;
}

describe('sweepUploadSessions', () => {
  it('settles expired sessions by phase: open, sealed, and completed', async () => {
    const open = await upload('acherus', 'open.txt', 16);
    const token = await tokenOf(open.UUID);
    await putUpload({ directory: 'acherus', name: 'altar', body: stream(bytes('a')) });
    const sealed = await upload('acherus/altar', 'sealed.txt');
    await rejects(completeUploadSession(sealed.UUID));
    const completed = await upload('acherus', 'completed.txt');
    const { record } = await completeUploadSession(completed.UUID);
    for (const [index, session] of [open, sealed, completed].entries()) {
      await tamper(session.UUID, { expiresAt: 1_000 + index });
    }

    strictEqual(await sweepUploadSessions(2_000), 3);

    for (const session of [open, sealed, completed])
      strictEqual(await row(session.UUID), undefined);
    strictEqual(storage.unfinished.has(token), false);
    strictEqual(storage.objects.has(sessionTemp(sealed.UUID)), false);
    deepStrictEqual(storage.objects.get('acherus/completed.txt'), RUNE);
    ok(await queryUntyped('Uploads').where({ UUID: record.UUID }).exists());
  });

  it('leaves the pending move of a completed session to the journal', async () => {
    const session = await upload('acherus', 'moving.txt');
    storage.failNext('move');
    await completeUploadSession(session.UUID);
    await tamper(session.UUID, { expiresAt: 3_000 });

    strictEqual(await sweepUploadSessions(4_000), 1);

    strictEqual(await row(session.UUID), undefined);
    deepStrictEqual(storage.objects.get(sessionTemp(session.UUID)), RUNE);
    await drainJournal();
    deepStrictEqual(storage.objects.get('acherus/moving.txt'), RUNE);
    strictEqual(storage.objects.has(sessionTemp(session.UUID)), false);
  });

  it('discards a session whose handle a crash lost', async () => {
    const session = await upload('acherus', 'lost.txt', 0);
    await tamper(session.UUID, { token: null, expiresAt: 5_000 });

    strictEqual(await sweepUploadSessions(6_000), 1);

    strictEqual(await row(session.UUID), undefined);
  });

  it('warns about a session whose storage fails and keeps it for the next sweep', async () => {
    const session = await upload('acherus', 'stubborn.txt', 16);
    const token = await tokenOf(session.UUID);
    await tamper(session.UUID, { expiresAt: 7_000 });
    storage.failNext('abort');
    written.length = 0;

    strictEqual(await sweepUploadSessions(8_000), 0);

    match(
      written.join(''),
      new RegExp(`Upload session ${session.UUID} not discarded: memory storage abort failed`),
    );
    ok(await row(session.UUID));
    ok(storage.unfinished.has(token));
    strictEqual(await sweepUploadSessions(8_000), 1);
    strictEqual(await row(session.UUID), undefined);
    strictEqual(storage.unfinished.has(token), false);
  });

  it('warns about a session whose row the database refuses to delete and keeps it', async () => {
    const session = await upload('acherus', 'bound.txt', 16);
    await tamper(session.UUID, { expiresAt: 8_500 });
    await db.run(
      'CREATE TRIGGER "bound" BEFORE DELETE ON "UploadsSessions" BEGIN SELECT RAISE(ABORT, \'bound\'); END',
    );
    written.length = 0;
    try {
      strictEqual(await sweepUploadSessions(9_000), 0);
    } finally {
      await db.run('DROP TRIGGER "bound"');
    }

    match(written.join(''), new RegExp(`Upload session ${session.UUID} not discarded: .*bound`));
    ok(await row(session.UUID));
    strictEqual(await sweepUploadSessions(9_000), 1);
    strictEqual(await row(session.UUID), undefined);
  });

  it('counts a session whose row is gone by the time its lock is taken as settled', async () => {
    const first = await upload('acherus', 'first.txt', 16);
    const second = await upload('acherus', 'second.txt', 16);
    await tamper(first.UUID, { expiresAt: 9_000 });
    await tamper(second.UUID, { expiresAt: 9_001 });
    const parts = storage.parts as StorageParts;
    const { abort } = parts;
    parts.abort = async (path, handle) => {
      await queryUntyped('UploadsSessions').unscoped().where({ UUID: second.UUID }).delete();
      return abort(path, handle);
    };
    try {
      strictEqual(await sweepUploadSessions(10_000), 2);
    } finally {
      parts.abort = abort;
    }

    strictEqual(await row(first.UUID), undefined);
    strictEqual(await row(second.UUID), undefined);
  });

  it('settles only what expired before `before`, the oldest first, up to `limit`', async () => {
    const live = await upload('acherus', 'live.txt', 0);
    const expiring = [];
    for (const name of ['a.txt', 'b.txt', 'c.txt']) expiring.push(await upload('acherus', name, 0));
    const [oldest, middle, newest] = expiring as [UploadSession, UploadSession, UploadSession];
    await tamper(oldest.UUID, { expiresAt: 20_000 });
    await tamper(middle.UUID, { expiresAt: 30_000 });
    await tamper(newest.UUID, { expiresAt: 40_000 });

    strictEqual(await sweepUploadSessions(25_000), 1);
    strictEqual(await row(oldest.UUID), undefined);
    ok(await row(middle.UUID));

    strictEqual(await sweepUploadSessions(50_000, 1), 1);
    strictEqual(await row(middle.UUID), undefined);
    ok(await row(newest.UUID));

    strictEqual(await sweepUploadSessions(40_000), 0);
    strictEqual(await sweepUploadSessions(40_001), 1);
    strictEqual(await row(newest.UUID), undefined);

    strictEqual(await sweepUploadSessions(), 0);
    ok(await row(live.UUID));
  });

  it('skips a session a request holds without waiting, and settles it on the next sweep', async () => {
    const session = await upload('acherus', 'held.txt', 16);
    await tamper(session.UUID, { expiresAt: 60_000 });
    const release = await holdSession(session.UUID);
    try {
      strictEqual(await promptly(sweepUploadSessions(70_000)), 0);
      ok(await row(session.UUID));
    } finally {
      await release();
    }

    strictEqual(await sweepUploadSessions(70_000), 1);
    strictEqual(await row(session.UUID), undefined);
  });

  it('takes over a session whose holder crashed', async () => {
    const session = await upload('acherus', 'crashed.txt', 16);
    await tamper(session.UUID, { expiresAt: 60_000 });
    await crashedHolder(session.UUID);

    strictEqual(await promptly(sweepUploadSessions(70_000)), 1);

    strictEqual(await row(session.UUID), undefined);
  });
});
