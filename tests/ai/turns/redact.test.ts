import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { RedactedRecords } from '../../../src/ai/turns/redact.ts';

import { modelSeesValues, openedFields, redactRecords } from '../../../src/ai/turns/redact.ts';
import { useCollections } from '../../../src/ohne/collections/use-collections.ts';
import { field } from '../../../src/ohne/fields/field.ts';
import { readJSONBody } from '../../../src/ohne/http/read-json-body.ts';
import { queryUntyped } from '../../../src/ohne/query/query.ts';
import { useRoles } from '../../../src/ohne/roles/use-roles.ts';
import { call, route, signIn, syncSchema, withAI } from '../_fixture.ts';

useCollections().register('Raids', {
  name: 'Raids',
  collection: {
    api: {
      read: {
        access: () => ({
          where: { open: true },
          select: ['name', 'open', 'leader', 'loot', 'previous', 'plan'],
        }),
      },
    },
    fields: {
      name: field('text'),
      open: field('boolean'),
      notes: field('text', { nullable: true }),
      leader: field('record', { collection: 'Characters' }),
      loot: field('records', { collection: 'Items' }),
      previous: field('record', { collection: 'Raids' }),
      plan: field('object', {
        fields: { tactic: field('text'), password: field('text', { readable: false }) },
      }),
    },
  },
});
useRoles().register('raider', {
  name: 'raider',
  role: {
    capabilities: [
      'ai.use',
      'collection.Raids.read',
      'collection.Characters.read',
      'collection.Guilds.read',
      'collection.Items.read',
    ],
  },
});
await syncSchema();

interface Body {
  records: unknown[];
  collection: string;
  locale?: string;
}

const REDACT = route('POST', '/redact', async (): Promise<{ redacted?: RedactedRecords }> => {
  const { records, collection, locale } = await readJSONBody<Body>();
  return { redacted: await redactRecords(records, collection, locale ?? null) };
});

const officer = await signIn('officer@redact.example.com', ['officer']);
const raider = await signIn('raider@redact.example.com', ['raider']);
const asker = await signIn('asker@redact.example.com', ['asker']);

const A = '019f3c1a-8b2d-7f4e-9a6b-1c2d3e4f5a6a';
const B = '019f3c1a-8b2d-7f4e-9a6b-1c2d3e4f5a6b';
const C = '019f3c1a-8b2d-7f4e-9a6b-1c2d3e4f5a6c';
const G = '019f3c1a-8b2d-7f4e-9a6b-1c2d3e4f5a6d';
const U = '019f3c1a-8b2d-7f4e-9a6b-1c2d3e4f5a6e';

const open = (await queryUntyped('Raids').createOrThrow({ name: 'Molten Core', open: true }))
  .UUID as string;
const closed = (await queryUntyped('Raids').createOrThrow({ name: 'Naxxramas', open: false }))
  .UUID as string;

/**
 * Redacts `records` of `collection` as the person `token` signs in, under the current settings.
 */
async function redact(
  token: string,
  collection: string,
  records: unknown[],
  locale?: string,
): Promise<RedactedRecords | undefined> {
  const { response } = await call(REDACT, {
    path: '/redact',
    body: { records, collection, locale },
    token,
  });
  strictEqual(response.status, 200);
  return ((await response.json()) as { redacted?: RedactedRecords }).redacted;
}

describe('openedFields', () => {
  it('opens the readable fields `ai.data` names, within the scope select, never on `Users`', async () => {
    await withAI({ data: { Items: true, Characters: ['level'] } }, () => {
      deepStrictEqual(openedFields('Items', {}), ['name', 'tooltip', 'rarity']);
      deepStrictEqual(openedFields('Items', { select: ['UUID', 'tooltip'] }), ['tooltip']);
      deepStrictEqual(openedFields('Characters', {}), ['level']);
      deepStrictEqual(openedFields('Guilds', {}), []);
    });
    await withAI({ data: { Items: ['name', 'secret'], Users: true } }, () => {
      deepStrictEqual(openedFields('Items', {}), ['name']);
      deepStrictEqual(openedFields('Users', {}), []);
    });
  });
});

describe('modelSeesValues', () => {
  it('is false only for a model set `data: false`', async () => {
    const entry = { provider: 'anthropic', model: 'x', key: false } as const;
    await withAI({ models: { seeing: entry, blind: { ...entry, data: false } } }, () => {
      strictEqual(modelSeesValues('seeing'), true);
      strictEqual(modelSeesValues('blind'), false);
    });
  });
});

describe('redactRecords', () => {
  it('keeps the opened fields and the system fields, and drops the rest', async () => {
    await withAI({ data: { Items: true } }, async () => {
      const reported = [
        {
          UUID: A,
          _updatedAt: 5,
          _translations: ['en'],
          name: 'Ashbringer',
          tooltip: 'Slays',
          rarity: 'epic',
          secret: 's',
          extra: 1,
        },
        { name: 'no id' },
        'x',
        null,
      ];
      deepStrictEqual(await redact(officer.token, 'Items', reported), {
        records: [
          {
            UUID: A,
            _updatedAt: 5,
            _translations: ['en'],
            name: 'Ashbringer',
            tooltip: 'Slays',
            rarity: 'epic',
          },
        ],
      });
    });
    await withAI({ data: { Items: ['name'] } }, async () => {
      deepStrictEqual(
        await redact(officer.token, 'Items', [{ UUID: A, name: 'x', tooltip: 't' }]),
        {
          records: [{ UUID: A, name: 'x' }],
        },
      );
    });
  });

  it('leaves nothing of a collection not opened, one the person cannot read, or one with no visible field', async () => {
    const reported = [{ UUID: A, name: 'Ashbringer' }];
    await withAI(undefined, async () => {
      strictEqual(await redact(officer.token, 'Items', reported), undefined);
    });
    await withAI({ data: { Items: true } }, async () => {
      strictEqual(await redact(asker.token, 'Items', reported), undefined);
    });
    await withAI({ data: { Items: ['secret'] } }, async () => {
      strictEqual(await redact(officer.token, 'Items', reported), undefined);
    });
  });

  it('recurses into a populated record of an opened collection, and unpopulates any other', async () => {
    const thrall = {
      UUID: C,
      name: 'Thrall',
      guild: { UUID: G, name: 'Onyx', extra: 1 },
      owner: { UUID: U, email: 'thrall@example.com' },
    };
    await withAI({ data: { Characters: true, Guilds: ['name'] } }, async () => {
      deepStrictEqual(await redact(officer.token, 'Characters', [thrall]), {
        records: [{ UUID: C, name: 'Thrall', guild: { UUID: G, name: 'Onyx' }, owner: U }],
      });
    });
    await withAI({ data: { Characters: true, Users: true } }, async () => {
      deepStrictEqual(await redact(officer.token, 'Characters', [thrall]), {
        records: [{ UUID: C, name: 'Thrall', guild: G, owner: U }],
      });
      deepStrictEqual(
        await redact(officer.token, 'Characters', [{ UUID: C, guild: G, owner: null }]),
        { records: [{ UUID: C, guild: G, owner: null }] },
      );
    });
  });

  it('collapses a row the read `where` does not admit to its id, and hides a field outside the select', async () => {
    await withAI({ data: { Raids: true } }, async () => {
      const reported = [
        { UUID: open, name: 'Molten Core', open: true, notes: 'loot council' },
        { UUID: closed, name: 'Naxxramas', open: false },
        { UUID: A, name: 'Forged', open: true },
      ];
      const expected = {
        records: [{ UUID: open, name: 'Molten Core', open: true }, { UUID: closed }, { UUID: A }],
      };
      deepStrictEqual(await redact(raider.token, 'Raids', reported), expected);
      deepStrictEqual(await redact(raider.token, 'Raids', reported, 'de'), expected);
    });
  });

  it('recurses through a `records` relation, in order, and nested relations', async () => {
    const raid = {
      UUID: open,
      name: 'Molten Core',
      open: true,
      leader: { UUID: C, name: 'Thrall', level: 60, guild: { UUID: G, name: 'Onyx' } },
      loot: [{ UUID: A, name: 'Ashbringer', tooltip: 'Slays' }, B],
    };
    await withAI(
      { data: { Raids: true, Items: ['name'], Characters: ['name', 'guild'], Guilds: true } },
      async () => {
        deepStrictEqual(await redact(raider.token, 'Raids', [raid]), {
          records: [
            {
              UUID: open,
              name: 'Molten Core',
              open: true,
              leader: { UUID: C, name: 'Thrall', guild: { UUID: G, name: 'Onyx' } },
              loot: [{ UUID: A, name: 'Ashbringer' }, B],
            },
          ],
        });
      },
    );
    await withAI({ data: { Raids: true } }, async () => {
      deepStrictEqual(await redact(raider.token, 'Raids', [raid]), {
        records: [{ UUID: open, name: 'Molten Core', open: true, leader: C, loot: [A, B] }],
      });
    });
  });

  it('unpopulates a record nested deeper than any read populates', async () => {
    const nested = (depth: number): Record<string, unknown> => ({
      UUID: open,
      name: 'Molten Core',
      ...(depth === 0 ? {} : { previous: nested(depth - 1) }),
    });
    await withAI({ data: { Raids: ['name', 'previous'] } }, async () => {
      deepStrictEqual(await redact(raider.token, 'Raids', [nested(3)]), {
        records: [
          {
            UUID: open,
            name: 'Molten Core',
            previous: {
              UUID: open,
              name: 'Molten Core',
              previous: { UUID: open, name: 'Molten Core', previous: open },
            },
          },
        ],
      });
    });
  });

  it('strips a `readable: false` subfield from a composite value', async () => {
    await withAI({ data: { Raids: ['plan'] } }, async () => {
      const plan = { tactic: 'tank and spank', password: 'hunter2', extra: 1 };
      deepStrictEqual(await redact(raider.token, 'Raids', [{ UUID: open, plan }]), {
        records: [{ UUID: open, plan: { tactic: 'tank and spank' } }],
      });
    });
  });

  it('cuts the list at `ai.limits.resultSize`, whole records at a time', async () => {
    const reported = [A, B, C].map((UUID) => ({ UUID, name: 'Ashbringer' }));
    const fits = (n: number): number => Buffer.byteLength(JSON.stringify(reported.slice(0, n)));
    await withAI({ data: { Items: true }, limits: { resultSize: fits(2) } }, async () => {
      deepStrictEqual(await redact(officer.token, 'Items', reported), {
        records: reported.slice(0, 2),
        truncated: true,
      });
    });
    await withAI({ data: { Items: true }, limits: { resultSize: fits(1) - 1 } }, async () => {
      deepStrictEqual(await redact(officer.token, 'Items', reported), {
        records: [],
        truncated: true,
      });
    });
    await withAI({ data: { Items: true }, limits: { resultSize: fits(3) } }, async () => {
      deepStrictEqual(await redact(officer.token, 'Items', reported), { records: reported });
    });
  });
});
