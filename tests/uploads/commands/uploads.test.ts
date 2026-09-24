import { deepStrictEqual, doesNotMatch, match, strictEqual } from 'node:assert';
import { after, before, describe, it } from 'node:test';

import { useEnv } from '../../../src/ohne/env/use-env.ts';
import { usePrinter } from '../../../src/ohne/printer/use-printer.ts';
import uploads from '../../../src/uploads/commands/uploads.ts';
import { drainJournal } from '../../../src/uploads/storage/journal.ts';
import { putUpload } from '../../../src/uploads/uploads/put-upload.ts';
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
});
