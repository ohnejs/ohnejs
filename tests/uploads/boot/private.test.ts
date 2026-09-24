import { match, strictEqual } from 'node:assert';
import { afterEach, describe, it } from 'node:test';

import { useEnv } from '../../../src/ohne/env/use-env.ts';
import { applyHook } from '../../../src/ohne/hooks/apply-hook.ts';
import { useLayers } from '../../../src/ohne/layers/use-layers.ts';
import { usePrinter } from '../../../src/ohne/printer/use-printer.ts';
import { queryUntyped } from '../../../src/ohne/query/query.ts';
import '../../../src/uploads/boot/private.ts';
import { storage } from '../_fixture.ts';

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

  it('warns when publicURL serves a storage that cannot hide a private row', async () => {
    useEnv().set('UPLOADS_SECRET', 'secret');
    useLayers().add({
      path: '/private-public-url',
      input: { uploads: { publicURL: 'https://cdn.example.com' } },
    });
    const { setPrivate } = storage;
    try {
      strictEqual(await readyOutput(), '');
      delete (storage as { setPrivate?: unknown }).setPrivate;
      const output = await readyOutput();
      match(output, /Private uploads are readable at/);
      match(output, /https:\/\/cdn\.example\.com/);
    } finally {
      storage.setPrivate = setPrivate;
      useLayers().remove('/private-public-url');
    }
  });
});
