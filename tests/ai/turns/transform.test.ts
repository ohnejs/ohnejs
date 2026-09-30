import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { beforeEach, describe, it } from 'node:test';

import type { CompleteRequest, Provider } from '../../../src/ai/providers/provider.ts';
import type { Proposal } from '../../../src/ai/turns/proposals.ts';
import type { Config } from '../../../src/ohne/layers/config.ts';

import { providerError } from '../../../src/ai/providers/provider.ts';
import { readTransformRecords, runTransform } from '../../../src/ai/turns/transform.ts';
import { gateCollection } from '../../../src/base/collections-api/gate.ts';
import { useCollections } from '../../../src/ohne/collections/use-collections.ts';
import { field } from '../../../src/ohne/fields/field.ts';
import { readJSONBody } from '../../../src/ohne/http/read-json-body.ts';
import { queryUntyped } from '../../../src/ohne/query/query.ts';
import { useRoles } from '../../../src/ohne/roles/use-roles.ts';
import { call, route, signIn, syncSchema, withAI } from '../_fixture.ts';

useCollections().register('Notes', {
  name: 'Notes',
  collection: {
    api: {
      read: { access: () => ({ where: { open: true } }) },
      update: { access: () => ({ where: { mine: true } }) },
    },
    fields: {
      title: field('text'),
      open: field('boolean'),
      mine: field('boolean'),
    },
  },
});
useRoles().register('noter', {
  name: 'noter',
  role: { capabilities: ['ai.use', 'collection.Notes.read', 'collection.Notes.update'] },
});
await syncSchema();

interface Streamed {
  event: string;
  data: Record<string, unknown>;
}

interface Body {
  proposal: Proposal;
  collection: string;
}

interface Seen {
  system: string[];
  input: { records: Record<string, string>[] };
  schema: Record<string, unknown>;
}

/**
 * The answer that never comes: the call waits until its signal aborts.
 */
const HANG = Symbol('hang');

/**
 * The scripted answer to a chunk, given the records the model reads; `undefined` throws a refusal.
 */
let answer: (records: Record<string, string>[]) => unknown = () => undefined;

const seen: Seen[] = [];

/**
 * A provider whose `complete` answers by the script, recording each request.
 */
const provider: Provider = {
  step: () => {
    throw new Error('not a step');
  },
  complete: (request: CompleteRequest, signal: AbortSignal) => {
    const input = JSON.parse(request.input) as { records: Record<string, string>[] };
    seen.push({ system: request.system.map((block) => block.text), input, schema: request.schema });
    const value = answer(input.records);
    if (value === HANG) {
      return new Promise((_, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason as Error));
      });
    }
    if (value === undefined) {
      return Promise.reject(providerError({ code: 'refusal', message: 'no' }));
    }
    return Promise.resolve({
      value,
      usage: { fresh: 40, cacheRead: 0, cacheWrite: 0, output: 10 },
      model: 'test',
    });
  },
  transcript: { user: () => [], results: () => [] },
};

/**
 * Reads the proposal's records as the caller and runs the transform, answering every event streamed.
 */
const TRANSFORM = route('POST', '/transform', async (): Promise<Streamed[]> => {
  const { proposal, collection } = await readJSONBody<Body>();
  const gate = await gateCollection(collection, 'read');
  if (!gate.ok) throw new Error('refused');
  const read = await readTransformRecords(proposal, gate.collection, gate.scope);
  const events: Streamed[] = [];
  await runTransform(
    {
      user: { UUID: 'u' } as never,
      proposal,
      collection: gate.collection,
      read,
      provider,
      release: () => {},
    },
    {
      body: null as never,
      send: (data, options) => {
        events.push({
          event: options?.event ?? '',
          data: JSON.parse(data) as Record<string, unknown>,
        });
      },
      close: () => {},
    },
  );
  return events;
});

const officer = await signIn('officer@transform.example.com', ['officer']);
const noter = await signIn('noter@transform.example.com', ['noter']);

const ITEMS = 'PATCH /collections/items/[uuid]';

/**
 * Runs `proposal` on `collection` as the person `token` signs in, under `ai`, and returns the events.
 */
async function transform(
  proposal: Proposal,
  collection: string,
  ai: Config['ai'],
  token = officer.token,
): Promise<Streamed[]> {
  let events: Streamed[] = [];
  await withAI(ai, async () => {
    const { response } = await call(TRANSFORM, {
      path: '/transform',
      body: { proposal, collection },
      token,
    });
    strictEqual(response.status, 200);
    events = (await response.json()) as Streamed[];
  });
  return events;
}

/**
 * A transform of `fields` on every item, at `locale` when given.
 */
function everyItem(fields: string[], locale?: string, instruction = 'Shout it.'): Proposal {
  return {
    route: ITEMS,
    tier: 'write',
    where: {},
    ...(locale === undefined ? {} : { query: { locale } }),
    transform: { fields, instruction },
  };
}

/**
 * The records of every `records` event, flattened.
 */
function records(events: Streamed[]): Record<string, unknown>[] {
  return events
    .filter((event) => event.event === 'records')
    .flatMap((event) => event.data.records as Record<string, unknown>[]);
}

/**
 * The rewritten record `uuid` among the events.
 */
function rewritten(events: Streamed[], uuid: string): Record<string, unknown> | undefined {
  return records(events).find((record) => record.UUID === uuid);
}

/**
 * The record `uuid` as the model read it, across every chunk.
 */
function sent(uuid: string): Record<string, string> | undefined {
  return seen.flatMap((request) => request.input.records).find((row) => row.UUID === uuid);
}

/**
 * The skipped records of every `skipped` event, as `UUID` to reason.
 */
function skipped(events: Streamed[]): Record<string, string> {
  return Object.fromEntries(
    events
      .filter((event) => event.event === 'skipped')
      .flatMap((event) => event.data.skipped as { UUID: string; reason: string }[])
      .map(({ UUID, reason }) => [UUID, reason]),
  );
}

/**
 * The answer that upper-cases every value, keeping the keys.
 */
function shout(rows: Record<string, string>[]): unknown {
  return {
    records: rows.map((row) =>
      Object.fromEntries(
        Object.entries(row).map(([key, value]) => [
          key,
          key === 'UUID' ? value : value.toUpperCase(),
        ]),
      ),
    ),
  };
}

const DATA: Config['ai'] = { data: { Items: true, Notes: true } };

await queryUntyped('Items').where({}).delete();
const items: string[] = [];
for (let index = 0; index < 25; index++) {
  const record = await queryUntyped('Items').createOrThrow({
    name: `Item ${String(index).padStart(2, '0')}`,
    tooltip: index % 5 === 0 ? null : `Tip ${index}`,
    secret: 's',
  });
  items.push(record.UUID as string);
}
await queryUntyped('Items')
  .locale('de')
  .where({ UUID: items[1] })
  .updateOrThrow({ name: 'Gegenstand 01', tooltip: 'Hinweis 1' });

describe('readTransformRecords and runTransform', () => {
  beforeEach(() => {
    answer = shout;
    seen.length = 0;
  });

  it('reads the listed fields as the person and rewrites them in chunks of 20', async () => {
    const events = await transform(everyItem(['name', 'tooltip']), 'items', DATA);
    deepStrictEqual(events[0], { event: 'start', data: { matched: 25, reached: 25 } });
    deepStrictEqual(events.at(-1), { event: 'done', data: { transformed: 25, skipped: 0 } });
    strictEqual(seen.length, 2);
    strictEqual(seen[0].input.records.length, 20);
    strictEqual(seen[1].input.records.length, 5);
    deepStrictEqual(sent(items[0]), { UUID: items[0], name: 'Item 00', tooltip: '' });
    deepStrictEqual(sent(items[1]), { UUID: items[1], name: 'Item 01', tooltip: 'Tip 1' });
    ok(!JSON.stringify(seen).includes('secret'));
    ok(!JSON.stringify(seen).includes('rarity'));
    strictEqual(records(events).length, 25);
    deepStrictEqual(rewritten(events, items[0]), {
      UUID: items[0],
      source: { name: 'Item 00', tooltip: null },
      proposed: { name: 'ITEM 00', tooltip: null },
    });
    deepStrictEqual(rewritten(events, items[1]), {
      UUID: items[1],
      source: { name: 'Item 01', tooltip: 'Tip 1' },
      proposed: { name: 'ITEM 01', tooltip: 'TIP 1' },
    });
  });

  it('sends the transform prompt, the instruction and the locale, and asks for the fields as strings', async () => {
    await transform(everyItem(['tooltip'], 'de', ' Translate to German. '), 'items', DATA);
    const [first] = seen;
    strictEqual(first.system.length, 2);
    ok(first.system[0].startsWith('# Rewriting\n'));
    strictEqual(
      first.system[1],
      '# Instruction\nTranslate to German.\nLocale: `de`. Every value you answer is in this locale.',
    );
    deepStrictEqual(first.schema, {
      type: 'object',
      properties: {
        records: {
          type: 'array',
          items: {
            type: 'object',
            properties: { UUID: { type: 'string' }, tooltip: { type: 'string' } },
            required: ['UUID', 'tooltip'],
            additionalProperties: false,
          },
        },
      },
      required: ['records'],
      additionalProperties: false,
    });
    await transform(everyItem(['tooltip']), 'items', { ...DATA, prompts: { transform: '' } });
    strictEqual(seen[1].system.length, 1);
    strictEqual(
      seen[1].system[0].split('\n')[2],
      'Locale: `en`. Every value you answer is in this locale.',
    );
  });

  it('reads at most `ai.limits.transform` records and names how many matched', async () => {
    const events = await transform(everyItem(['name']), 'items', {
      ...DATA,
      limits: { transform: 3 },
    });
    deepStrictEqual(events[0], { event: 'start', data: { matched: 25, reached: 3 } });
    deepStrictEqual(events.at(-1), { event: 'done', data: { transformed: 3, skipped: 0 } });
    strictEqual(records(events).length, 3);
  });

  it('rewrites a record lacking the locale from the default locale, one holding it in place', async () => {
    const events = await transform(everyItem(['name', 'tooltip'], 'de'), 'items', DATA);
    strictEqual(records(events).length, 25);
    deepStrictEqual(rewritten(events, items[0])?.source, { name: 'Item 00', tooltip: null });
    strictEqual(rewritten(events, items[0])?.fallback, true);
    deepStrictEqual(rewritten(events, items[1])?.source, {
      name: 'Gegenstand 01',
      tooltip: 'Hinweis 1',
    });
    strictEqual(rewritten(events, items[1])?.fallback, undefined);
    deepStrictEqual(sent(items[1]), {
      UUID: items[1],
      name: 'Gegenstand 01',
      tooltip: 'Hinweis 1',
    });
  });

  it('skips a record lacking the locale when a required translatable field is not listed', async () => {
    const events = await transform(everyItem(['tooltip'], 'de'), 'items', DATA);
    deepStrictEqual(events[0], { event: 'start', data: { matched: 25, reached: 25 } });
    const left = skipped(events);
    strictEqual(Object.keys(left).length, 24);
    strictEqual(left[items[0]], 'incomplete');
    strictEqual(left[items[1]], undefined);
    deepStrictEqual(records(events), [
      {
        UUID: items[1],
        source: { tooltip: 'Hinweis 1' },
        proposed: { tooltip: 'HINWEIS 1' },
      },
    ]);
    deepStrictEqual(events.at(-1), { event: 'done', data: { transformed: 1, skipped: 24 } });
  });

  it('never reads a hidden row, and skips one the person may not update before the model sees it', async () => {
    await queryUntyped('Notes').where({}).delete();
    const shown = await queryUntyped('Notes').createOrThrow({ title: 'a', open: true, mine: true });
    const theirs = await queryUntyped('Notes').createOrThrow({
      title: 'b',
      open: true,
      mine: false,
    });
    await queryUntyped('Notes').createOrThrow({ title: 'c', open: false, mine: true });
    const proposal: Proposal = {
      route: 'PATCH /collections/notes/[uuid]',
      tier: 'write',
      where: {},
      transform: { fields: ['title'], instruction: 'Shout it.' },
    };
    const events = await transform(proposal, 'notes', DATA, noter.token);
    deepStrictEqual(events[0], { event: 'start', data: { matched: 2, reached: 2 } });
    deepStrictEqual(skipped(events), { [theirs.UUID as string]: 'notYours' });
    deepStrictEqual(seen[0].input.records, [{ UUID: shown.UUID, title: 'a' }]);
    deepStrictEqual(events.at(-1), { event: 'done', data: { transformed: 1, skipped: 1 } });
  });

  it('fails one chunk on a drifting answer, and one the model refuses, and goes on', async () => {
    const drifts: ((rows: Record<string, string>[]) => unknown)[] = [
      () => ({ records: [] }),
      (rows) => ({ records: rows.map((row, index) => (index === 0 ? rows[1] : row)) }),
      (rows) => ({
        records: rows.map((row, index) => (index === 0 ? { ...row, UUID: 'nope' } : row)),
      }),
      (rows) => ({ records: rows.map((row, index) => (index === 0 ? { ...row, extra: 1 } : row)) }),
      (rows) => ({ records: rows.map((row, index) => (index === 0 ? { ...row, name: 1 } : row)) }),
      (rows) => ({ records: rows.map((row, index) => (index === 0 ? { UUID: row.UUID } : row)) }),
      () => 'yes',
    ];
    for (const [index, drift] of drifts.entries()) {
      answer = (rows) => (rows.length === 20 ? drift(rows) : shout(rows));
      const events = await transform(everyItem(['name']), 'items', DATA);
      const left = Object.values(skipped(events));
      deepStrictEqual(
        left,
        Array.from({ length: 20 }, () => 'malformed'),
        `drift ${index}`,
      );
      strictEqual(records(events).length, 5);
      deepStrictEqual(events.at(-1), { event: 'done', data: { transformed: 5, skipped: 20 } });
    }
    answer = (rows) => (rows.length === 20 ? undefined : shout(rows));
    const events = await transform(everyItem(['name']), 'items', DATA);
    deepStrictEqual(
      Object.values(skipped(events)),
      Array.from({ length: 20 }, () => 'failed'),
    );
    strictEqual(records(events).length, 5);
  });

  it('answers an emptied field as empty again, and a filled one as its value', async () => {
    answer = (rows) => ({
      records: rows.map((row) => ({
        ...row,
        tooltip: row.UUID === items[5] ? 'Filled' : row.tooltip,
      })),
    });
    const events = await transform(everyItem(['tooltip']), 'items', DATA);
    deepStrictEqual(rewritten(events, items[0])?.proposed, { tooltip: null });
    deepStrictEqual(rewritten(events, items[5])?.proposed, { tooltip: 'Filled' });
  });

  it('stops as `limit` once the token budget is spent between chunks', async () => {
    const events = await transform(everyItem(['name']), 'items', {
      ...DATA,
      limits: { tokens: { limit: 30, window: '1h' } },
    });
    strictEqual(records(events).length, 20);
    deepStrictEqual(events.at(-1), { event: 'error', data: { code: 'limit' } });
  });

  it('ends as `timeout` past `ai.limits.step`, still charging the cut chunk its estimated input', async () => {
    answer = () => HANG;
    const ai = { ...DATA, limits: { step: '20ms', tokens: { limit: 100, window: '1h' } } };
    await withAI(ai, async () => {
      const run = async (): Promise<Streamed[]> => {
        const body = { proposal: everyItem(['name']), collection: 'items' };
        const { response } = await call(TRANSFORM, {
          path: '/transform',
          body,
          token: officer.token,
        });
        return (await response.json()) as Streamed[];
      };
      deepStrictEqual((await run()).at(-1), { event: 'error', data: { code: 'timeout' } });
      strictEqual(seen.length, 1);
      deepStrictEqual((await run()).at(-1), { event: 'error', data: { code: 'limit' } });
      strictEqual(seen.length, 1);
    });
  });
});
