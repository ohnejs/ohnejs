import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { Proposal } from '../../../src/ai/turns/proposals.ts';
import type { BatchProposal, TurnBatch } from '../../../src/ai/turns/state.ts';
import type { Config } from '../../../src/ohne/layers/config.ts';

import {
  askKinds,
  autoAcceptOffered,
  autoAccepts,
  tagAutoAccept,
} from '../../../src/ai/turns/auto-accept.ts';
import { queryUntyped } from '../../../src/ohne/query/query.ts';
import { isNull } from '../../../src/utils/index.ts';
import { signIn, userWith, withAI } from '../_fixture.ts';

const UUID = '0b8e2a4c-2c55-4b8f-9d6e-8a4e2f1c3b7d';

const MODELS = { smart: { provider: 'anthropic', model: 'claude-test', key: false } } as const;

const ON: Config['ai'] = {
  model: 'smart',
  models: MODELS,
  autoAccept: { max: 3, fields: { Items: ['name'] } },
};

/**
 * One accepted proposal on `pattern` of `collection`, as a batch keeps it.
 */
function entry(
  method: 'POST' | 'PATCH' | 'DELETE',
  pattern: string,
  proposal: Partial<Proposal>,
  collection: string | null = 'Items',
): BatchProposal {
  const tier = method === 'DELETE' ? 'destructive' : proposal.tier === 'read' ? 'read' : 'write';
  const body = method === 'DELETE' ? 'none' : isNull(collection) ? 'app' : 'record';
  return {
    call: 0,
    index: 0,
    route: { method, pattern, body, ...(isNull(collection) ? {} : { collection }) },
    proposal: { route: `${method} ${pattern}`, tier, ...proposal },
    identity: false,
  };
}

const RECORD = '/collections/[collection]/[uuid]';

const rename = (): BatchProposal =>
  entry('PATCH', RECORD, { params: { uuid: UUID }, body: { name: 'Ashbringer' } });

/**
 * A batch of `proposals`.
 */
function batchOf(...proposals: BatchProposal[]): TurnBatch {
  return { id: 'b', step: 1, kind: 'write', calls: [], proposals };
}

/**
 * Whether each proposal of `batch` came out tagged, once tagged under `ai` after `earlier`.
 */
async function tagged(
  ai: Config['ai'],
  batch: TurnBatch,
  earlier: TurnBatch[] = [],
  on = true,
): Promise<boolean[]> {
  await withAI(ai, () => tagAutoAccept(batch, earlier, on));
  return batch.proposals.map(({ proposal }) => proposal.auto === true);
}

describe('autoAcceptOffered', () => {
  it('is off by default', async () => {
    await withAI(undefined, () => strictEqual(autoAcceptOffered(), false));
    await withAI({ model: 'smart', models: MODELS }, () => strictEqual(autoAcceptOffered(), false));
  });

  it('needs a model, a positive `max` and a listed collection', async () => {
    await withAI(ON, () => strictEqual(autoAcceptOffered(), true));
    await withAI({ ...ON, autoAccept: { fields: { Items: true } } }, () =>
      strictEqual(autoAcceptOffered(), false),
    );
    await withAI({ ...ON, autoAccept: { max: 3 } }, () => strictEqual(autoAcceptOffered(), false));
    await withAI({ models: MODELS, autoAccept: ON?.autoAccept }, () =>
      strictEqual(autoAcceptOffered(), false),
    );
  });
});

describe('autoAccepts', () => {
  it("reads the account setting from the person's own row", async () => {
    const { uuid } = await signIn('auto@accept.example.com', ['editor']);
    const user = { ...userWith('editor'), UUID: uuid };
    await withAI(ON, async () => {
      strictEqual(await autoAccepts(user), false);
      await queryUntyped('Users').where({ UUID: uuid }).updateOrThrow({ autoAccept: true });
      strictEqual(await autoAccepts(user), true);
    });
    await withAI(undefined, async () => strictEqual(await autoAccepts(user), false));
  });
});

describe('askKinds', () => {
  it('names each kind a write is', async () => {
    await withAI(undefined, () => {
      deepStrictEqual(askKinds(rename()), []);
      deepStrictEqual(askKinds(entry('DELETE', RECORD, { params: { uuid: UUID } })), [
        'destructive',
      ]);
      deepStrictEqual(askKinds(entry('PATCH', RECORD, { where: {}, body: { name: 'x' } })), [
        'set',
      ]);
      deepStrictEqual(askKinds(entry('PATCH', RECORD, { query: { locale: 'de' } })), ['locale']);
      deepStrictEqual(askKinds(entry('PATCH', RECORD, { query: { locale: 'en' } })), []);
      const transform = { fields: ['name'], instruction: 'Shorter.' };
      deepStrictEqual(askKinds(entry('PATCH', RECORD, { transform, query: { locale: 'de' } })), [
        'locale',
        'transform',
      ]);
    });
  });
});

describe('tagAutoAccept', () => {
  it('tags nothing while the person has it off', async () => {
    deepStrictEqual(await tagged(ON, batchOf(rename()), [], false), [false]);
  });

  it('tags a write whose collection and every body key are listed', async () => {
    deepStrictEqual(await tagged(ON, batchOf(rename())), [true]);
    const create = entry('POST', '/collections/[collection]', { body: { name: 'Sulfuras' } });
    deepStrictEqual(await tagged(ON, batchOf(create)), [true]);
  });

  it('asks for a key the fields leave out, and for a collection they leave out', async () => {
    const tooltip = entry('PATCH', RECORD, { params: { uuid: UUID }, body: { tooltip: 'Hot.' } });
    deepStrictEqual(await tagged(ON, batchOf(tooltip)), [false]);
    const both = entry('PATCH', RECORD, {
      params: { uuid: UUID },
      body: { name: 'a', tooltip: 'b' },
    });
    deepStrictEqual(await tagged(ON, batchOf(both)), [false]);
    const character = entry(
      'PATCH',
      RECORD,
      { params: { uuid: UUID }, body: { name: 'Thrall' } },
      'Characters',
    );
    deepStrictEqual(await tagged(ON, batchOf(character)), [false]);
    const every = { ...ON, autoAccept: { max: 3, fields: { Items: true as const } } };
    deepStrictEqual(await tagged(every, batchOf(both)), [true]);
  });

  it('asks the whole batch when one write asks, leaving its reads untagged', async () => {
    const read = entry('POST', '/collections/[collection]/query', { tier: 'read' });
    const tooltip = entry('PATCH', RECORD, { params: { uuid: UUID }, body: { tooltip: 'Hot.' } });
    deepStrictEqual(await tagged(ON, batchOf(read, rename(), tooltip)), [false, false, false]);
    deepStrictEqual(await tagged(ON, batchOf(read, rename())), [false, true]);
    deepStrictEqual(await tagged(ON, batchOf(read)), [false]);
  });

  it('counts `max` per turn, asking a batch that would pass it as a whole', async () => {
    const earlier = batchOf(rename(), rename());
    await tagged(ON, earlier);
    deepStrictEqual(await tagged(ON, batchOf(rename()), [earlier]), [true]);
    deepStrictEqual(await tagged(ON, batchOf(rename(), rename()), [earlier]), [false, false]);
    const asked = batchOf(rename(), rename(), rename());
    deepStrictEqual(await tagged(ON, batchOf(rename()), [asked]), [true]);
  });

  it('asks every kind `ask` names, by default all of them', async () => {
    const destroy = (): BatchProposal => entry('DELETE', RECORD, { params: { uuid: UUID } });
    const locale = (): BatchProposal =>
      entry('PATCH', RECORD, {
        params: { uuid: UUID },
        query: { locale: 'de' },
        body: { name: 'Aschenbringer' },
      });
    const every = { ...ON, autoAccept: { max: 9, fields: { Items: true as const } } };
    deepStrictEqual(await tagged(every, batchOf(destroy())), [false]);
    deepStrictEqual(await tagged(every, batchOf(locale())), [false]);
    const lenient = { ...every, autoAccept: { ...every.autoAccept, ask: [] } };
    deepStrictEqual(await tagged(lenient, batchOf(destroy())), [true]);
    deepStrictEqual(await tagged(lenient, batchOf(locale())), [true]);
    const onlyLocale = { ...every, autoAccept: { ...every.autoAccept, ask: ['locale' as const] } };
    deepStrictEqual(await tagged(onlyLocale, batchOf(destroy())), [true]);
    deepStrictEqual(await tagged(onlyLocale, batchOf(locale())), [false]);
  });

  it('never tags a write by set or a transform, whatever `ask` names', async () => {
    const lenient = { ...ON, autoAccept: { max: 99, fields: { Items: true as const }, ask: [] } };
    const set = entry('PATCH', RECORD, { where: { rarity: 'epic' }, body: { name: 'x' } });
    deepStrictEqual(await tagged(lenient, batchOf(set)), [false]);
    const transform = entry('PATCH', RECORD, {
      params: { uuid: UUID },
      transform: { fields: ['name'], instruction: 'Shorter.' },
    });
    deepStrictEqual(await tagged(lenient, batchOf(transform)), [false]);
  });

  it('never tags an app route or a translation copy', async () => {
    const lenient = { ...ON, autoAccept: { max: 99, fields: { Items: true as const }, ask: [] } };
    const app = entry('POST', '/reports', { body: {} }, null);
    deepStrictEqual(await tagged(lenient, batchOf(app)), [false]);
    const copy = entry('POST', `${RECORD}/translations/copy`, {
      params: { uuid: UUID },
      body: { source: 'en' },
    });
    copy.route.body = 'copy';
    deepStrictEqual(await tagged(lenient, batchOf(copy)), [false]);
  });
});
