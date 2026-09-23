import { doesNotMatch, match, strictEqual } from 'node:assert';
import { afterEach, describe, it } from 'node:test';

import { useEnv } from '../../../src/ohne/env/use-env.ts';
import { applyHook } from '../../../src/ohne/hooks/apply-hook.ts';
import { usePrinter } from '../../../src/ohne/printer/use-printer.ts';
import { queryUntyped } from '../../../src/ohne/query/query.ts';
import '../../../src/uploads/boot/private.ts';
import '../_fixture.ts';

/**
 * Runs the ready hook and returns what the printer wrote.
 */
async function readyOutput(): Promise<string> {
  let written = '';
  usePrinter().configure({ stream: { write: (chunk: string) => ((written += chunk), true) } });
  try {
    await applyHook('server:ready', { host: 'localhost', port: 0 });
  } finally {
    usePrinter().configure({ stream: { write: () => true } });
  }
  return written;
}

describe('the private boot file', () => {
  afterEach(() => useEnv().unset('UPLOADS_SECRET'));

  it('fills private on rows older than the column, keeping their version', async () => {
    const row = await queryUntyped('Uploads').createOrThrow({
      kind: 'folder',
      directory: '',
      name: 'older',
      private: null,
    });
    await applyHook('schema:synced', { deletions: [], warnings: [] });
    const filled = await queryUntyped('Uploads').where({ UUID: row.UUID }).findFirst();
    strictEqual(filled?.private, false);
    strictEqual(filled?._updatedAt, row._updatedAt);
  });

  it('stays silent while no row is private', async () => {
    strictEqual(await readyOutput(), '');
  });

  it('warns once a row is private and no secret is set', async () => {
    await queryUntyped('Uploads').createOrThrow({
      kind: 'folder',
      directory: '',
      name: 'vault',
      private: true,
    });
    match(await readyOutput(), /UPLOADS_SECRET/);
    useEnv().set('UPLOADS_SECRET', 'secret');
    strictEqual(await readyOutput(), '');
  });

  it('lists public rows directly inside a private folder once a secret is set', async () => {
    const create = (row: Record<string, unknown>) => queryUntyped('Uploads').createOrThrow(row);
    await create({ kind: 'folder', directory: '', name: 'locked', private: true });
    await create({ kind: 'file', directory: 'locked', name: 'sealed.txt', private: true });
    await create({ kind: 'file', directory: 'locked', name: 'leak.txt', private: false });
    await create({ kind: 'folder', directory: 'locked', name: 'open', private: false });
    await create({ kind: 'file', directory: 'locked/open', name: 'deep.txt', private: false });
    doesNotMatch(await readyOutput(), /Public uploads/);
    useEnv().set('UPLOADS_SECRET', 'secret');
    const output = await readyOutput();
    match(output, /Public uploads inside a private folder/);
    match(output, /locked\/leak\.txt/);
    match(output, /locked\/open\b/);
    doesNotMatch(output, /sealed|deep/);
  });

  it('stays silent with a secret while every row inside a private folder is private', async () => {
    await queryUntyped('Uploads')
      .where({ directory: { in: ['locked', 'locked/open'] } })
      .updateOrThrow({ private: true });
    useEnv().set('UPLOADS_SECRET', 'secret');
    strictEqual(await readyOutput(), '');
  });
});
