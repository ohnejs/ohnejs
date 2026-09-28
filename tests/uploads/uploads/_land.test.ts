import { deepStrictEqual, ok, rejects, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { UploadReach } from '../../../src/uploads/uploads/_reach.ts';
import type { UploadRow } from '../../../src/uploads/uploads/_row.ts';
import type { StagedUpload } from '../../../src/uploads/uploads/_stage.ts';

import { hook } from '../../../src/ohne/hooks/hook.ts';
import { useHooks } from '../../../src/ohne/hooks/use-hooks.ts';
import { queryUntyped } from '../../../src/ohne/query/query.ts';
import { isValidationError } from '../../../src/ohne/query/write/errors.ts';
import { drainJournal } from '../../../src/uploads/storage/journal.ts';
import { landUpload } from '../../../src/uploads/uploads/_land.ts';
import { claimStaged, discardStaged, stageUpload } from '../../../src/uploads/uploads/_stage.ts';
import { splitUploadPath } from '../../../src/uploads/uploads/path.ts';
import { bytes, storage, stream, text } from '../_fixture.ts';

const stage = (content: string) => stageUpload(stream(bytes(content)), { type: 'text/plain' });

/**
 * Lands `staged` at `directory`/`name` as a text file, claiming its stage entry.
 */
function land(staged: StagedUpload, directory: string, name: string, reach?: UploadReach) {
  return landUpload(
    staged,
    { directory, name, type: 'text/plain', author: null, reach },
    { claim: (tx) => claimStaged(tx, staged.temp) },
  );
}

/**
 * The pending journal entries, in `sequence` order.
 */
async function pending(): Promise<Record<string, unknown>[]> {
  const entries = await queryUntyped('UploadsJournal').orderBy('sequence').findMany();
  return entries.map(({ op, from, to }) => ({ op, from, to }));
}

/**
 * The `stage` entries the journal holds.
 */
function staging(): Promise<string[]> {
  return queryUntyped('UploadsJournal').where({ op: 'stage' }).pluck('from') as Promise<string[]>;
}

describe('landUpload', () => {
  it('lands a staged file at its path, decorated, once the caller drains', async () => {
    const staged = await stage('Jaina');

    const record = await land(staged, 'theramore', 'jaina.txt');

    strictEqual(record.path, 'theramore/jaina.txt');
    strictEqual(record.url, '/uploads/theramore/jaina.txt');
    strictEqual(record.hash, staged.hash);
    strictEqual(record.size, 5);
    deepStrictEqual(await pending(), [
      { op: 'move', from: staged.temp, to: 'theramore/jaina.txt' },
    ]);
    strictEqual(storage.objects.has('theramore/jaina.txt'), false);

    await drainJournal();
    strictEqual(text(storage.objects.get('theramore/jaina.txt')), 'Jaina');
    strictEqual(storage.objects.has(staged.temp), false);
  });

  it('suffixes a taken name', async () => {
    await land(await stage('Thrall'), 'orgrimmar', 'warchief.txt');
    const second = await land(await stage('Garrosh'), 'orgrimmar', 'warchief.txt');
    await drainJournal();

    strictEqual(second.name, 'warchief-2.txt');
    strictEqual(text(storage.objects.get('orgrimmar/warchief-2.txt')), 'Garrosh');
  });

  it('suffixes past the taken names a query:filter scope hides', async () => {
    const hidden: string[] = [];
    for (const hero of ['Uther', 'Arthas', 'Jaina', 'Muradin', 'Falric']) {
      hidden.push((await land(await stage(hero), 'stratholme', 'culling.txt')).UUID);
    }
    hook('query:filter', (ir) => {
      if (ir.collection !== 'Uploads') return ir;
      const scope = {
        kind: 'compare',
        path: ['UUID'],
        op: 'in',
        value: hidden,
        negated: true,
      } as const;
      return {
        ...ir,
        condition: ir.condition ? { kind: 'and', nodes: [ir.condition, scope] } : scope,
      };
    });
    try {
      const record = await land(await stage('Marwyn'), 'stratholme', 'culling.txt');
      strictEqual(record.name, 'culling-6.txt');
    } finally {
      useHooks().clear();
    }
    await drainJournal();
  });

  it('creates the missing folders on the way', async () => {
    await land(await stage('Rexxar'), 'kalimdor/durotar/razor-hill', 'rexxar.txt');
    await drainJournal();

    for (const path of ['kalimdor', 'kalimdor/durotar', 'kalimdor/durotar/razor-hill']) {
      const folder = queryUntyped('Uploads').where({ ...splitUploadPath(path), kind: 'folder' });
      ok(await folder.exists(), path);
    }
  });

  it('lands inside a private folder as private, journaling the lock before the move', async () => {
    await queryUntyped('Uploads').createOrThrow({
      kind: 'folder',
      directory: '',
      name: 'dalaran',
      private: true,
    });
    const staged = await stage('Antonidas');

    const record = await land(staged, 'dalaran/violet-citadel', 'antonidas.txt');

    strictEqual(record.private, true);
    deepStrictEqual(await pending(), [
      { op: 'lock', from: staged.temp, to: null },
      { op: 'move', from: staged.temp, to: 'dalaran/violet-citadel/antonidas.txt' },
    ]);
    const folder = await queryUntyped('Uploads')
      .where({ directory: 'dalaran', name: 'violet-citadel' })
      .findFirst();
    strictEqual(folder?.private, true);
    await drainJournal();
    strictEqual(storage.visibility.get('dalaran/violet-citadel/antonidas.txt'), true);
  });

  it('refuses a landing outside the reach with a 422, keeping no row and no folder', async () => {
    await queryUntyped('Uploads').createOrThrow({
      kind: 'folder',
      directory: '',
      name: 'karazhan',
      private: true,
    });
    const staged = await stage('Medivh');

    let caught: unknown;
    await rejects(
      land(staged, 'karazhan/library', 'medivh.txt', { where: { private: false } }),
      (error: unknown) => {
        caught = error;
        return isValidationError(error);
      },
    );

    deepStrictEqual((caught as { errors: unknown }).errors, { '': 'uploads.errors.outOfReach' });
    strictEqual(await queryUntyped('Uploads').where({ directory: 'karazhan' }).exists(), false);
    deepStrictEqual(await staging(), [staged.temp]);
    await discardStaged(staged.temp);
  });

  it('runs claim on the landing transaction with the new row', async () => {
    const staged = await stage('Sylvanas');
    const seen: { row: UploadRow; visible: boolean }[] = [];

    const record = await landUpload(
      staged,
      { directory: 'undercity', name: 'sylvanas.txt', type: 'text/plain', author: null },
      {
        claim: async (tx, row) => {
          const visible = await queryUntyped('Uploads').use(tx).where({ UUID: row.UUID }).exists();
          seen.push({ row, visible });
          await claimStaged(tx, staged.temp);
        },
      },
    );
    await drainJournal();

    strictEqual(seen.length, 1);
    strictEqual(seen[0]!.row.UUID, record.UUID);
    strictEqual(seen[0]!.row.name, 'sylvanas.txt');
    strictEqual(seen[0]!.visible, true);
    deepStrictEqual(await staging(), []);
  });

  it('rolls the whole landing back when claim throws, its own writes included', async () => {
    const staged = await stage('Arthas');

    await rejects(
      landUpload(
        staged,
        { directory: 'northrend/icecrown', name: 'arthas.txt', type: 'text/plain', author: null },
        {
          claim: async (tx) => {
            await claimStaged(tx, staged.temp);
            throw new Error('Frostmourne hungers');
          },
        },
      ),
      /Frostmourne hungers/,
    );

    strictEqual(await queryUntyped('Uploads').where({ name: 'northrend' }).exists(), false);
    strictEqual(await queryUntyped('Uploads').where({ name: 'arthas.txt' }).exists(), false);
    deepStrictEqual(await pending(), [{ op: 'stage', from: staged.temp, to: null }]);
    await discardStaged(staged.temp);
    deepStrictEqual(await pending(), []);
  });
});
