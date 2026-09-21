import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { afterEach, describe, it } from 'node:test';

import type { DatabaseAdapter } from '../../../../src/ohne/database/adapter.ts';
import type { FieldInstance } from '../../../../src/ohne/fields/field.ts';
import type { FieldTypeName } from '../../../../src/ohne/fields/known-fields.ts';
import type { ConditionNode } from '../../../../src/utils/index.ts';

import { useCollections } from '../../../../src/ohne/collections/use-collections.ts';
import { SQLiteDialect } from '../../../../src/ohne/database/dialects/sqlite/dialect.ts';
import { buildDesiredSchema } from '../../../../src/ohne/database/schema/desired.ts';
import { syncDatabase } from '../../../../src/ohne/database/schema/sync.ts';
import { registerDatabase, registerDialect } from '../../../../src/ohne/database/use-database.ts';
import { defineField } from '../../../../src/ohne/fields/define-field.ts';
import { field } from '../../../../src/ohne/fields/field.ts';
import { useFields } from '../../../../src/ohne/fields/use-fields.ts';
import { hook } from '../../../../src/ohne/hooks/hook.ts';
import { useHooks } from '../../../../src/ohne/hooks/use-hooks.ts';
import { runCreate } from '../../../../src/ohne/query/write/create.ts';
import { runUpdate } from '../../../../src/ohne/query/write/update.ts';

useFields().register('WNEpoch', {
  name: 'WNEpoch' as FieldTypeName,
  fieldType: defineField({
    columnType: 'integer',
    serialize: async (value) => {
      if (value === null) throw new Error('serialize saw null');
      return value;
    },
  }),
});

useCollections().register('WCProduct', {
  name: 'WCProduct',
  collection: {
    fields: {
      kind: field('text'),
      discount: field('integer', { nullable: true, default: 5, when: { kind: 'sale' } }),
    },
  },
});
useCollections().register('WCSibling', {
  name: 'WCSibling',
  collection: {
    fields: {
      sections: field('repeater', {
        fields: {
          heading: field('text'),
          badge: field('text', { nullable: true, when: { heading: 'hero' } }),
        },
      }),
    },
  },
});
useCollections().register('WCClimb', {
  name: 'WCClimb',
  collection: {
    fields: {
      kind: field('text'),
      sections: field('repeater', {
        fields: {
          heading: field('text'),
          badge: field('text', { nullable: true, when: { '../kind': 'promo' } }),
        },
      }),
    },
  },
});
useCollections().register('WUProduct', {
  name: 'WUProduct',
  collection: {
    fields: {
      kind: field('text'),
      title: field('text', { nullable: true }),
      discount: field('integer', { nullable: true, when: { kind: 'sale' } }),
    },
  },
});
useCollections().register('WRTag', {
  name: 'WRTag',
  collection: { fields: { label: field('text') } },
});
useCollections().register('WRHas', {
  name: 'WRHas',
  collection: {
    fields: {
      tags: field('records', { collection: 'WRTag' }),
      featured: field('boolean', { nullable: true, when: { tags: { has: true } } }),
    },
  },
});
useCollections().register('WNRev', {
  name: 'WNRev',
  collection: {
    fields: {
      kind: field('text'),
      revisions: field('repeater', {
        fields: {
          note: field('text', { nullable: true, when: { '../kind': 'published' } }),
          label: field('text', { nullable: true }),
        },
      }),
    },
  },
});
useCollections().register('WNTag', {
  name: 'WNTag',
  collection: {
    fields: {
      kind: field('text'),
      items: field('repeater', {
        fields: {
          tag: field('text', { nullable: true, default: 'none', when: { '../kind': 'promo' } }),
          code: field('text', { default: 'X', when: { '../kind': 'promo' } }),
        },
      }),
    },
  },
});
useCollections().register('WNSan', {
  name: 'WNSan',
  collection: {
    fields: {
      kind: field('text'),
      items: field('repeater', {
        fields: {
          code: field('text', {
            nullable: true,
            default: 'Hello',
            sanitizers: [(value) => String(value).toLowerCase()],
            when: { '../kind': 'promo' },
          }),
        },
      }),
    },
  },
});
useCollections().register('WNSubstrate', {
  name: 'WNSubstrate',
  collection: {
    fields: {
      meta: field('object', {
        fields: { n: field('integer', { default: 5 }), tag: field('text', { nullable: true }) },
      }),
      items: field('repeater', { fields: { x: field('text', { default: 'go' }) } }),
      flag: field('boolean', { nullable: true, when: { 'meta.n': 5 } }),
      mark: field('boolean', { nullable: true, when: { items: { has: { x: 'go' } } } }),
    },
  },
});

let wnNestedCalls = 0;
useCollections().register('WNNestedOnce', {
  name: 'WNNestedOnce',
  collection: {
    fields: {
      rows: field('repeater', {
        fields: {
          serial: field('text', { default: () => `row-${(wnNestedCalls += 1)}` }),
          badge: field('text', { nullable: true, when: { serial: 'row-1' } }),
        },
      }),
    },
  },
});

useCollections().register('WNReset', {
  name: 'WNReset',
  collection: {
    fields: {
      items: field('repeater', {
        fields: {
          mode: field('text'),
          code: field('text', {
            nullable: true,
            default: 'Bad',
            validators: [
              (value: unknown) => (value === 'Bad' ? 'validation.invalidValue' : undefined),
            ],
            when: { mode: 'full' },
          }),
        },
      }),
    },
  },
});

useCollections().register('WNRich', {
  name: 'WNRich',
  collection: {
    fields: {
      items: field('repeater', {
        fields: {
          mode: field('text'),
          notes: field('repeater', {
            fields: { text: field('text') },
            default: () => [{ text: 'starter' }],
            when: { mode: 'full' },
          }),
        },
      }),
    },
  },
});

useCollections().register('WNUniqueGate', {
  name: 'WNUniqueGate',
  collection: {
    fields: {
      mode: field('text'),
      slug: field('text', { nullable: true, unique: true, when: { mode: 'on' } }),
    },
  },
});

useCollections().register('WNFan', {
  name: 'WNFan',
  collection: {
    fields: {
      mode: field('text'),
      items: field('repeater', {
        fields: { code: field('text', { unique: true }) },
        when: { mode: 'on' },
      }),
    },
  },
});

let wnDefaultCalls = 0;
useCollections().register('WNOnce', {
  name: 'WNOnce',
  collection: {
    fields: {
      mode: field('text'),
      serial: field('text', {
        default: () => `tick-${(wnDefaultCalls += 1)}`,
        when: { mode: 'on' },
      }),
      probe: field('text', { nullable: true, when: { serial: 'tick-1' } }),
    },
  },
});

useCollections().register('WNCrash', {
  name: 'WNCrash',
  collection: {
    fields: {
      kind: field('text'),
      items: field('repeater', {
        fields: {
          epoch: {
            type: 'WNEpoch',
            options: { nullable: true, when: { '../kind': 'promo' } },
          } as unknown as FieldInstance,
        },
      }),
    },
  },
});
useCollections().register('WNList', {
  name: 'WNList',
  collection: {
    fields: {
      kind: field('text'),
      sections: field('repeater', {
        fields: {
          picks: field('multiSelect', { min: 1, when: { '../kind': 'full' } }),
          links: field('records', { collection: 'WRTag', min: 1, when: { '../kind': 'full' } }),
        },
      }),
    },
  },
});

const dialect = new SQLiteDialect();
const db = await dialect.connect(':memory:');
registerDialect(dialect);
registerDatabase(db);
await syncDatabase(db, dialect, {
  desired: buildDesiredSchema(useCollections(), useFields() as never),
});

async function created(
  collection: string,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const result = await runCreate(collection, input, null);
  ok(result.ok);
  return result.record as Record<string, unknown>;
}

describe('when gate on create', () => {
  it('keeps an active field value', async () => {
    strictEqual((await created('WCProduct', { kind: 'sale', discount: 20 })).discount, 20);
  });

  it('drops an inactive field value for the default', async () => {
    strictEqual((await created('WCProduct', { kind: 'regular', discount: 20 })).discount, 5);
  });

  it('drops a smuggled `null` on an inactive field for the default', async () => {
    strictEqual((await created('WCProduct', { kind: 'regular', discount: null })).discount, 5);
  });

  it('keeps a `null` on an active field, skipping the default', async () => {
    strictEqual((await created('WCProduct', { kind: 'sale', discount: null })).discount, null);
  });

  it('takes the default when an active field is absent', async () => {
    strictEqual((await created('WCProduct', { kind: 'sale' })).discount, 5);
  });

  it('resolves an absent inactive field default once, so gate and storage agree', async () => {
    const record = await created('WNOnce', { mode: 'off', probe: 'P' });
    strictEqual(wnDefaultCalls, 1);
    strictEqual(record.serial, 'tick-1');
    strictEqual(record.probe, 'P');
  });

  it('activates per repeater item off a sibling subfield', async () => {
    const record = await created('WCSibling', {
      sections: [
        { heading: 'hero', badge: 'X' },
        { heading: 'plain', badge: 'Y' },
      ],
    });
    const sections = record.sections as { badge: string | null }[];
    strictEqual(sections[0].badge, 'X');
    strictEqual(sections[1].badge, null);
  });

  it('resolves a repeater subfield gate that climbs to the record root', async () => {
    const promo = await created('WCClimb', {
      kind: 'promo',
      sections: [{ heading: 'a', badge: 'NEW' }],
    });
    strictEqual((promo.sections as { badge: string | null }[])[0].badge, 'NEW');

    const plain = await created('WCClimb', {
      kind: 'plain',
      sections: [{ heading: 'a', badge: 'NEW' }],
    });
    strictEqual((plain.sections as { badge: string | null }[])[0].badge, null);
  });
});

async function seed(uuid: string, kind: string, discount: number | null): Promise<void> {
  await db.run(
    'INSERT INTO "WUProduct" ("UUID","_updatedAt","kind","title","discount") VALUES (?,?,?,?,?)',
    [uuid, 100, kind, null, discount],
  );
}

function inUUIDs(uuids: string[]): ConditionNode {
  return { kind: 'compare', path: ['UUID'], op: 'in', value: uuids, negated: false };
}

async function updatedAt(uuid: string): Promise<number> {
  const row = await db.queryOne<{ _updatedAt: number }>(
    'SELECT "_updatedAt" FROM "WUProduct" WHERE "UUID" = ?',
    [uuid],
  );
  ok(row);
  return row._updatedAt;
}

function pick(records: readonly unknown[], kind: string): Record<string, unknown> {
  const found = records.find((record) => (record as Record<string, unknown>).kind === kind);
  ok(found);
  return found as Record<string, unknown>;
}

async function countWrites(pattern: RegExp, run: () => Promise<void>): Promise<number> {
  const adapter = db as DatabaseAdapter;
  const original = adapter.run.bind(adapter);
  let count = 0;
  adapter.run = (sql, params) => {
    if (pattern.test(sql)) count += 1;
    return original(sql, params);
  };
  try {
    await run();
  } finally {
    adapter.run = original;
  }
  return count;
}

describe('when gate on update', () => {
  it('writes an active field, leaves an inactive one untouched with no bump', async () => {
    await seed('u-s1', 'sale', 1);
    await seed('u-r1', 'regular', 2);
    const result = await runUpdate('WUProduct', { discount: 50 }, inUUIDs(['u-s1', 'u-r1']), null);
    ok(result.ok);
    strictEqual(result.records.length, 2);
    strictEqual(pick(result.records, 'sale').discount, 50);
    strictEqual(pick(result.records, 'regular').discount, 2);
    ok((await updatedAt('u-s1')) > 100);
    strictEqual(await updatedAt('u-r1'), 100);
  });

  it('keeps a non-gated field active for every matched record', async () => {
    await seed('u-s2', 'sale', 1);
    await seed('u-r2', 'regular', 2);
    const result = await runUpdate(
      'WUProduct',
      { discount: 50, title: 'X' },
      inUUIDs(['u-s2', 'u-r2']),
      null,
    );
    ok(result.ok);
    strictEqual(pick(result.records, 'sale').discount, 50);
    strictEqual(pick(result.records, 'sale').title, 'X');
    strictEqual(pick(result.records, 'regular').discount, 2);
    strictEqual(pick(result.records, 'regular').title, 'X');
    ok((await updatedAt('u-r2')) > 100);
  });

  it('lets a unique fan-out through when a gate narrows it to one record', async () => {
    const on = await created('WNFan', { mode: 'on', items: [{ code: 'fan-on' }] });
    const off = await created('WNFan', { mode: 'off' });
    const result = await runUpdate(
      'WNFan',
      { items: [{ code: 'fan-shared' }] },
      inUUIDs([on.UUID as string, off.UUID as string]),
      null,
    );
    ok(result.ok);
    const byUUID = new Map(result.records.map((record) => [record.UUID, record]));
    strictEqual(
      ((byUUID.get(on.UUID) as Record<string, unknown>).items as { code: string }[])[0].code,
      'fan-shared',
    );
    strictEqual(
      ((byUUID.get(off.UUID) as Record<string, unknown>).items as { code: string }[]).length,
      0,
    );
  });

  it('overlays the input, so setting the gate field activates in the same call', async () => {
    await seed('u-r3', 'regular', 2);
    const result = await runUpdate(
      'WUProduct',
      { kind: 'sale', discount: 50 },
      inUUIDs(['u-r3']),
      null,
    );
    ok(result.ok);
    const record = result.records[0] as Record<string, unknown>;
    strictEqual(record.kind, 'sale');
    strictEqual(record.discount, 50);
  });

  it('issues one UPDATE per activation signature', async () => {
    await seed('u-s4', 'sale', 1);
    await seed('u-s5', 'sale', 1);
    await seed('u-r4', 'regular', 2);
    await seed('u-r5', 'regular', 2);
    const count = await countWrites(/UPDATE "WUProduct"/, async () => {
      const result = await runUpdate(
        'WUProduct',
        { discount: 50, title: 'Y' },
        inUUIDs(['u-s4', 'u-s5', 'u-r4', 'u-r5']),
        null,
      );
      ok(result.ok);
    });
    strictEqual(count, 2);
  });
});

describe('when gate on update fires hooks per matched record', () => {
  afterEach(() => useHooks().clear());

  it('fires `record:after-update` once per matched record on the gated path', async () => {
    await seed('u-h1', 'sale', 1);
    await seed('u-h2', 'regular', 2);
    const seen: string[] = [];
    hook('record:after-update', (record) => {
      seen.push(record.UUID as string);
    });
    const result = await runUpdate('WUProduct', { discount: 50 }, inUUIDs(['u-h1', 'u-h2']), null);
    ok(result.ok);
    strictEqual(seen.length, 2);
    ok(seen.includes('u-h1'));
    ok(seen.includes('u-h2'));
  });

  it('gates a field stamped by `record:before-change` per matched record', async () => {
    await seed('u-h3', 'sale', 1);
    await seed('u-h4', 'regular', 2);
    hook('record:before-change', (input) => {
      input.discount = 50;
    });
    const result = await runUpdate('WUProduct', { title: 'T' }, inUUIDs(['u-h3', 'u-h4']), null);
    ok(result.ok);
    strictEqual(pick(result.records, 'sale').discount, 50);
    strictEqual(pick(result.records, 'regular').discount, 2);
  });
});

describe('when gate on update over a relation', () => {
  it('activates a gate that reads a stored relation via has', async () => {
    await db.run('INSERT INTO "WRTag" ("UUID","_updatedAt","label") VALUES (?,?,?)', [
      'wrt1',
      1,
      'A',
    ]);
    const created = await runCreate('WRHas', { tags: ['wrt1'], featured: null }, null);
    ok(created.ok);
    const uuid = (created.record as Record<string, unknown>).UUID as string;
    const updated = await runUpdate('WRHas', { featured: true }, inUUIDs([uuid]), null);
    ok(updated.ok);
    strictEqual((updated.records[0] as Record<string, unknown>).featured, true);
  });

  it('leaves a gate inactive when the stored relation is empty', async () => {
    const created = await runCreate('WRHas', { tags: [], featured: null }, null);
    ok(created.ok);
    const uuid = (created.record as Record<string, unknown>).UUID as string;
    const updated = await runUpdate('WRHas', { featured: true }, inUUIDs([uuid]), null);
    ok(updated.ok);
    strictEqual((updated.records[0] as Record<string, unknown>).featured, null);
  });
});

describe('when gate on update in a nested item', () => {
  it('writes a provided nested value whose gate climbs to an unprovided field', async () => {
    const created = await runCreate(
      'WCClimb',
      { kind: 'promo', sections: [{ heading: 'a', badge: 'NEW' }] },
      null,
    );
    ok(created.ok);
    const record = created.record as Record<string, unknown>;
    const uuid = record.UUID as string;
    const secUUID = (record.sections as { UUID: string }[])[0].UUID;
    const updated = await runUpdate(
      'WCClimb',
      { sections: [{ UUID: secUUID, heading: 'a', badge: 'CHANGED' }] },
      inUUIDs([uuid]),
      null,
    );
    ok(updated.ok);
    const badge = (updated.records[0] as { sections: { badge: string | null }[] }).sections[0]
      .badge;
    strictEqual(badge, 'CHANGED');
  });
});

describe('when gate on update, nested subfield', () => {
  it('activates a nested gate off the stored root when the root is not re-provided', async () => {
    const record = await created('WNRev', {
      kind: 'published',
      revisions: [{ note: 'old', label: 'kept' }],
    });
    const uuid = record.UUID as string;
    const revUUID = (record.revisions as { UUID: string }[])[0].UUID;
    const updated = await runUpdate(
      'WNRev',
      { revisions: [{ UUID: revUUID, note: 'hi' }] },
      inUUIDs([uuid]),
      null,
    );
    ok(updated.ok);
    const rev = (
      updated.records[0] as { revisions: { note: string | null; label: string | null }[] }
    ).revisions[0];
    strictEqual(rev.note, 'hi');
    strictEqual(rev.label, null);
  });

  it('resets an inactive nested subfield to its default, like an omitted one', async () => {
    const record = await created('WNRev', {
      kind: 'published',
      revisions: [{ note: 'old', label: 'kept' }],
    });
    const uuid = record.UUID as string;
    const revUUID = (record.revisions as { UUID: string }[])[0].UUID;
    const updated = await runUpdate(
      'WNRev',
      { kind: 'draft', revisions: [{ UUID: revUUID, note: 'hi' }] },
      inUUIDs([uuid]),
      null,
    );
    ok(updated.ok);
    const rev = (
      updated.records[0] as { revisions: { note: string | null; label: string | null }[] }
    ).revisions[0];
    strictEqual(rev.note, null);
    strictEqual(rev.label, null);
  });

  it('gates a fresh nested item per matched parent, defaulting inactive columns', async () => {
    const a = await created('WNTag', { kind: 'promo', items: [] });
    const b = await created('WNTag', { kind: 'regular', items: [] });
    const updated = await runUpdate(
      'WNTag',
      { items: [{ tag: 'T', code: 'C' }] },
      inUUIDs([a.UUID as string, b.UUID as string]),
      null,
    );
    ok(updated.ok);
    const promo = pick(updated.records, 'promo').items as { tag: string | null; code: string }[];
    const regular = pick(updated.records, 'regular').items as {
      tag: string | null;
      code: string;
    }[];
    strictEqual(promo[0].tag, 'T');
    strictEqual(promo[0].code, 'C');
    strictEqual(regular[0].tag, 'none');
    strictEqual(regular[0].code, 'X');
  });
});

describe('when gate on update, nested list that forbids empty', () => {
  it('lets an item omit the list while its gate is off, as a create does', async () => {
    const record = await created('WNList', { kind: 'lite', sections: [{}] });
    const updated = await runUpdate(
      'WNList',
      { sections: [{}] },
      inUUIDs([record.UUID as string]),
      null,
    );
    ok(updated.ok);
    deepStrictEqual(
      (updated.records[0] as { sections: { picks: string[]; links: string[] }[] }).sections.map(
        ({ picks, links }) => ({ picks, links }),
      ),
      [{ picks: [], links: [] }],
    );
  });

  it('requires the list once a matched record holds the gate active, writing nothing', async () => {
    const record = await created('WNList', { kind: 'lite', sections: [{}] });
    const uuid = record.UUID as string;
    const updated = await runUpdate(
      'WNList',
      { kind: 'full', sections: [{}] },
      inUUIDs([uuid]),
      null,
    );
    ok(!updated.ok);
    deepStrictEqual(
      { ...updated.errors },
      {
        'sections[0].picks': 'validation.required',
        'sections[0].links': 'validation.required',
      },
    );
    const row = await db.queryOne<{ kind: string }>(
      'SELECT "kind" FROM "WNList" WHERE "UUID" = ?',
      [uuid],
    );
    strictEqual(row?.kind, 'lite');
  });
});

describe('when gate on update, nested default matches create', () => {
  it('runs an inactive subfield default through its sanitizers, as a create would', async () => {
    const record = await created('WNSan', { kind: 'promo', items: [{ code: 'X' }] });
    const itemUUID = (record.items as { UUID: string }[])[0].UUID;
    const updated = await runUpdate(
      'WNSan',
      { kind: 'regular', items: [{ UUID: itemUUID, code: 'B' }] },
      inUUIDs([record.UUID as string]),
      null,
    );
    ok(updated.ok);
    strictEqual(
      (updated.records[0] as { items: { code: string | null }[] }).items[0].code,
      'hello',
    );
  });

  it('short-circuits a null default before serialize, so a serialize hook never sees null', async () => {
    const record = await created('WNCrash', { kind: 'promo', items: [{ epoch: 5 }] });
    const itemUUID = (record.items as { UUID: string }[])[0].UUID;
    const updated = await runUpdate(
      'WNCrash',
      { kind: 'regular', items: [{ UUID: itemUUID, epoch: 9 }] },
      inUUIDs([record.UUID as string]),
      null,
    );
    ok(updated.ok);
    strictEqual((updated.records[0] as { items: { epoch: number | null }[] }).items[0].epoch, null);
  });
});

describe('when gate over the coerced composite substrate', () => {
  it('activates off a coerced composite subfield on create and update alike', async () => {
    const record = await created('WNSubstrate', { meta: { n: '5' }, flag: true });
    strictEqual(record.flag, true);
    const updated = await runUpdate(
      'WNSubstrate',
      { flag: true },
      inUUIDs([record.UUID as string]),
      null,
    );
    ok(updated.ok);
    strictEqual(updated.records[0].flag, true);
  });

  it('activates off a defaulted composite subfield the input omitted', async () => {
    const record = await created('WNSubstrate', { meta: {}, flag: true });
    strictEqual((record.meta as { n: number }).n, 5);
    strictEqual(record.flag, true);
  });

  it('activates a has-walk over an item taking the walked subfield by default', async () => {
    const record = await created('WNSubstrate', { items: [{}], mark: true });
    strictEqual((record.items as { x: string }[])[0].x, 'go');
    strictEqual(record.mark, true);
  });

  it('resolves a nested defaulted subfield once, gate and storage agreeing', async () => {
    const record = await created('WNNestedOnce', { rows: [{ badge: 'B' }] });
    strictEqual(wnNestedCalls, 1);
    const rows = record.rows as { serial: string; badge: string | null }[];
    strictEqual(rows[0].serial, 'row-1');
    strictEqual(rows[0].badge, 'B');
  });
});

describe('when gates precheck only what the groups write', () => {
  it('skips the unique probe of a fully-inactive gated field', async () => {
    const holder = await created('WNUniqueGate', { mode: 'on', slug: 'wn-taken' });
    strictEqual(holder.slug, 'wn-taken');
    const record = await created('WNUniqueGate', { mode: 'off' });
    const inactive = await runUpdate(
      'WNUniqueGate',
      { mode: 'off', slug: 'wn-taken' },
      inUUIDs([record.UUID as string]),
      null,
    );
    ok(inactive.ok);
    strictEqual(inactive.records[0].slug, null);
    const active = await runUpdate(
      'WNUniqueGate',
      { mode: 'on', slug: 'wn-taken' },
      inUUIDs([record.UUID as string]),
      null,
    );
    ok(!active.ok);
    strictEqual(active.errors.slug, 'validation.notUnique');
  });

  it('probes a fresh child value against a gated-inactive record kept row', async () => {
    const active = await created('WNFan', { mode: 'on', items: [{ code: 'b4-a' }] });
    const inactive = await created('WNFan', { mode: 'on', items: [{ code: 'b4-held' }] });
    const flipped = await runUpdate(
      'WNFan',
      { mode: 'off' },
      inUUIDs([inactive.UUID as string]),
      null,
    );
    ok(flipped.ok);
    const result = await runUpdate(
      'WNFan',
      { items: [{ code: 'b4-held' }] },
      inUUIDs([active.UUID as string, inactive.UUID as string]),
      null,
    );
    ok(!result.ok);
    strictEqual(result.errors['items[0].code'], 'validation.notUnique');
    const kept = await db.query('SELECT "code" FROM "WNFan_items" WHERE "code" = ?', ['b4-held']);
    strictEqual(kept.length, 1);
  });

  it('correlates a gated child only against the records that keep it', async () => {
    const active = await created('WNFan', { mode: 'on', items: [{ code: 'co-a1' }] });
    const inactive = await created('WNFan', { mode: 'off' });
    const itemUUID = (active.items as { UUID: string }[])[0].UUID;
    const result = await runUpdate(
      'WNFan',
      { items: [{ UUID: itemUUID, code: 'co-a2' }] },
      inUUIDs([active.UUID as string, inactive.UUID as string]),
      null,
    );
    ok(result.ok);
    const byUUID = new Map(result.records.map((record) => [record.UUID, record]));
    const items = (byUUID.get(active.UUID) as Record<string, unknown>).items as {
      UUID: string;
      code: string;
    }[];
    strictEqual(items[0].UUID, itemUUID);
    strictEqual(items[0].code, 'co-a2');
    strictEqual(
      ((byUUID.get(inactive.UUID) as Record<string, unknown>).items as unknown[]).length,
      0,
    );
  });
});

describe('when gate deactivation takes the default', () => {
  it('fails a deactivation whose default fails its validators, writing nothing', async () => {
    const record = await created('WNReset', { items: [{ mode: 'full', code: 'OK' }] });
    const itemUUID = (record.items as { UUID: string }[])[0].UUID;
    const flipped = await runUpdate(
      'WNReset',
      { items: [{ UUID: itemUUID, mode: 'lite', code: 'OK' }] },
      inUUIDs([record.UUID as string]),
      null,
    );
    ok(!flipped.ok);
    strictEqual(flipped.errors['items[0].code'], 'validation.invalidValue');
    const row = await db.queryOne<{ mode: string }>(
      'SELECT "mode" FROM "WNReset_items" WHERE "UUID" = ?',
      [itemUUID],
    );
    strictEqual(row?.mode, 'full');
  });

  it('deactivates a gated nested composite to its non-empty default, as create does', async () => {
    const inactive = await created('WNRich', { items: [{ mode: 'lite', notes: [{ text: 'x' }] }] });
    const inactiveNotes = (inactive.items as { notes: { text: string }[] }[])[0].notes;
    deepStrictEqual(
      inactiveNotes.map((note) => note.text),
      ['starter'],
    );
    const active = await created('WNRich', {
      items: [{ mode: 'full', notes: [{ text: 'kept' }] }],
    });
    const itemUUID = (active.items as { UUID: string }[])[0].UUID;
    const flipped = await runUpdate(
      'WNRich',
      { items: [{ UUID: itemUUID, mode: 'lite', notes: [{ text: 'smuggled' }] }] },
      inUUIDs([active.UUID as string]),
      null,
    );
    ok(flipped.ok);
    const notes = (flipped.records[0] as { items: { notes: { text: string }[] }[] }).items[0].notes;
    deepStrictEqual(
      notes.map((note) => note.text),
      ['starter'],
    );
  });
});
