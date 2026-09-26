import { deepStrictEqual, doesNotMatch, match, strictEqual } from 'node:assert';
import { after, before, describe, it } from 'node:test';

import { useEnv } from '../../../src/ohne/env/use-env.ts';
import { usePrinter } from '../../../src/ohne/printer/use-printer.ts';
import { queryUntyped } from '../../../src/ohne/query/query.ts';
import uploads from '../../../src/uploads/commands/uploads.ts';
import { drainJournal } from '../../../src/uploads/storage/journal.ts';
import { sessionTemp } from '../../../src/uploads/uploads/_session.ts';
import { abortUploadSession } from '../../../src/uploads/uploads/abort-upload-session.ts';
import { createUploadSession } from '../../../src/uploads/uploads/create-upload-session.ts';
import { putUpload } from '../../../src/uploads/uploads/put-upload.ts';
import { sweepUploadSessions } from '../../../src/uploads/uploads/sweep-upload-sessions.ts';
import { bytes, storage, stream } from '../_fixture.ts';

const HINT = /Run it again with --delete to delete them\./;

describe('ohne uploads prune', () => {
  const prune = uploads.subCommands!.prune!;
  let written = '';

  async function run(remove: boolean): Promise<string> {
    written = '';
    await prune.run!({ values: { delete: remove }, positionals: [] });
    return written;
  }

  function rows(output: string, prefix: string): string[] {
    return [...output.matchAll(/^│ {2}- (\S+)$/gm)]
      .map(([, path]) => path ?? '')
      .filter((path) => path.startsWith(`${prefix}/`));
  }

  /**
   * Opens an upload session for each of `names`, then expires them all, resolving their `UUID`s.
   * They open first, since opening a session sweeps the ones already expired.
   */
  async function expire(...names: string[]): Promise<string[]> {
    const opened: string[] = [];
    for (const name of names) {
      opened.push((await createUploadSession({ directory: 'undercity', name, size: 6 })).UUID);
    }
    await queryUntyped('UploadsSessions')
      .unscoped()
      .where({ UUID: { in: opened } })
      .updateOrThrow({ expiresAt: 1_000 });
    return opened;
  }

  async function strays(prefix: string): Promise<void> {
    await putUpload({ directory: prefix, name: 'kept.txt', body: stream(bytes('kept')) });
    storage.objects.set(`${prefix}/stray.txt`, bytes('stray'));
    storage.objects.set(`${prefix}/deep/lost.txt`, bytes('lost'));
  }

  before(() => {
    useEnv().set('NO_COLOR', true);
    usePrinter().configure({ stream: { write: (chunk: string) => ((written += chunk), true) } });
  });

  after(() => {
    usePrinter().configure({ stream: { write: () => true } });
    useEnv().unset('NO_COLOR');
  });

  it('prints a success line when no stored file is stray', async (t) => {
    const success = t.mock.method(usePrinter(), 'success');
    await putUpload({ directory: 'clean', name: 'kept.txt', body: stream(bytes('kept')) });

    match(await run(false), /^●  No stray files in \S+\n$/);
    strictEqual(success.mock.callCount(), 1);
  });

  it('warns with one row per stray file and the `--delete` hint, deleting nothing', async (t) => {
    const warn = t.mock.method(usePrinter(), 'warnBlock');
    await strays('horde');

    const output = await run(false);
    strictEqual(warn.mock.callCount(), 1);
    match(output, /^●  Found 2 stray files in \S+$/m);
    deepStrictEqual(rows(output, 'horde'), ['horde/deep/lost.txt', 'horde/stray.txt']);
    match(output, HINT);
    strictEqual(storage.objects.has('horde/stray.txt'), true);
    storage.objects.delete('horde/stray.txt');
    storage.objects.delete('horde/deep/lost.txt');
  });

  it('deletes the stray files with `--delete`, listing them in a success block', async (t) => {
    const successBlock = t.mock.method(usePrinter(), 'successBlock');
    await strays('alliance');

    const output = await run(true);
    strictEqual(successBlock.mock.callCount(), 1);
    match(output, /^●  Deleted 2 stray files in \S+$/m);
    deepStrictEqual(rows(output, 'alliance'), ['alliance/deep/lost.txt', 'alliance/stray.txt']);
    doesNotMatch(output, HINT);
    strictEqual(storage.objects.has('alliance/stray.txt'), false);
    strictEqual(storage.objects.has('alliance/deep/lost.txt'), false);
    strictEqual(storage.objects.has('alliance/kept.txt'), true);
  });

  it('lists a stray whose name holds backticks exactly', async () => {
    storage.objects.set('goblin/a`b`c.txt', bytes('stray'));

    deepStrictEqual(rows(await run(true), 'goblin'), ['goblin/a`b`c.txt']);
  });

  it('reports a delete that failed apart from the deleted ones, and fails the run', async (t) => {
    const errorBlock = t.mock.method(usePrinter(), 'errorBlock');
    await strays('scourge');
    storage.failNext('delete');

    const output = await run(true);
    strictEqual(errorBlock.mock.callCount(), 1);
    match(output, /^●  Deleted 1 stray file in \S+$/m);
    match(output, /^●  Could not delete 1 stray file$/m);
    deepStrictEqual(rows(output, 'scourge'), ['scourge/stray.txt', 'scourge/deep/lost.txt']);
    strictEqual(storage.objects.has('scourge/deep/lost.txt'), true);
    strictEqual(process.exitCode, 1);

    process.exitCode = 0;
    await drainJournal();
    strictEqual(storage.objects.has('scourge/deep/lost.txt'), false);
  });

  it('prints one dim line naming the expired upload sessions it swept', async () => {
    await expire('sylvanas.txt', 'varimathras.txt');

    const output = await run(false);
    match(output, /^●  Swept 2 expired upload sessions\n●  No stray files in \S+\n$/);
    strictEqual(await queryUntyped('UploadsSessions').unscoped().count(), 0);

    await expire('nathanos.txt');
    match(await run(false), /^●  Swept 1 expired upload session$/m);
  });

  it('sweeps once, so a session it could not discard is warned about once', async () => {
    await expire('putress.txt');
    storage.failNext('abort');

    const output = await run(false);
    strictEqual(output.match(/not discarded/g)?.length, 1);
    doesNotMatch(output, /Swept/);
    strictEqual(await sweepUploadSessions(2_000), 1);
  });

  it('sweeps the expired upload sessions before it lists the stored files', async (t) => {
    const order: string[] = [];
    const parts = storage.parts!;
    const { abort } = parts;
    t.mock.method(parts, 'abort', async (path: string, handle: string) => {
      order.push(`abort ${path}`);
      await abort(path, handle);
    });
    const { list } = storage;
    storage.list = (prefix) => {
      order.push('list');
      return list!(prefix);
    };
    try {
      const live = await createUploadSession({
        directory: 'undercity',
        name: 'jaina.txt',
        size: 6,
      });
      const [expired] = await expire('arthas.txt');

      await run(false);

      deepStrictEqual(order, [`abort ${sessionTemp(expired!)}`, 'list']);
      deepStrictEqual(await queryUntyped('UploadsSessions').unscoped().pluck('UUID'), [live.UUID]);
      await abortUploadSession(live.UUID);
    } finally {
      storage.list = list;
    }
  });
});
