import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { useCollections } from '../../../../src/ohne/collections/use-collections.ts';
import { SQLiteDialect } from '../../../../src/ohne/database/dialects/sqlite/dialect.ts';
import { buildDesiredSchema } from '../../../../src/ohne/database/schema/desired.ts';
import { syncDatabase } from '../../../../src/ohne/database/schema/sync.ts';
import { registerDatabase, registerDialect } from '../../../../src/ohne/database/use-database.ts';
import { field } from '../../../../src/ohne/fields/field.ts';
import { useFields } from '../../../../src/ohne/fields/use-fields.ts';
import { runCreate } from '../../../../src/ohne/query/write/create.ts';

const rejectBadItem = (value: unknown) =>
  Array.isArray(value) && value.some((item) => String(item.heading).includes('BAD'))
    ? 'rejected-by-validator'
    : undefined;

const bangHeadings = (value: unknown) =>
  Array.isArray(value) ? value.map((item) => ({ ...item, heading: `${item.heading}!` })) : value;

useCollections().register('CTTag', {
  name: 'CTTag',
  collection: { fields: { label: field('text') } },
});

useCollections().register('CTiers', {
  name: 'CTiers',
  collection: {
    fields: {
      repVal: field('repeater', {
        fields: { heading: field('text') },
        validators: [rejectBadItem],
      }),
      repSan: field('repeater', { fields: { heading: field('text') }, sanitizers: [bangHeadings] }),
      objVal: field('object', {
        fields: { note: field('text') },
        validators: [() => 'object-validator-ran'],
      }),
      objSan: field('object', {
        fields: { note: field('text') },
        sanitizers: [
          (value) =>
            value === null
              ? value
              : { ...(value as object), note: `${(value as { note: string }).note}!` },
        ],
      }),
      tags: field('records', {
        collection: 'CTTag',
        validators: [
          (value) => (Array.isArray(value) && value.length > 1 ? 'too-many-tags' : undefined),
        ],
      }),
    },
  },
});

useCollections().register('CTNest', {
  name: 'CTNest',
  collection: {
    fields: {
      outer: field('repeater', {
        fields: {
          inner: field('repeater', {
            fields: { heading: field('text') },
            validators: [rejectBadItem],
          }),
        },
      }),
    },
  },
});

useCollections().register('CTGate', {
  name: 'CTGate',
  collection: {
    fields: {
      mode: field('text'),
      items: field('repeater', {
        fields: { heading: field('text') },
        when: { mode: 'full' },
        validators: [() => 'gated-validator-ran'],
      }),
    },
  },
});

useCollections().register('CTScope', {
  name: 'CTScope',
  collection: {
    fields: {
      items: field('repeater', { fields: { heading: field('text') }, sanitizers: [() => []] }),
      featured: field('boolean', { nullable: true, when: { items: { has: true } } }),
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
await db.run('INSERT INTO "CTTag" ("UUID","_updatedAt","label") VALUES (?,?,?)', ['tg1', 1, 'A']);
await db.run('INSERT INTO "CTTag" ("UUID","_updatedAt","label") VALUES (?,?,?)', ['tg2', 1, 'B']);

describe('composite instance validators run', () => {
  it('a repeater instance validator rejects a bad item at its field', async () => {
    const result = await runCreate('CTiers', { repVal: [{ heading: 'BAD' }] }, null);
    ok(!result.ok);
    strictEqual(result.errors.repVal, 'rejected-by-validator');
  });

  it('a repeater instance validator accepts a clean value', async () => {
    const result = await runCreate('CTiers', { repVal: [{ heading: 'fine' }] }, null);
    ok(result.ok);
  });

  it('an object instance validator rejects a provided object', async () => {
    const result = await runCreate('CTiers', { objVal: { note: 'x' } }, null);
    ok(!result.ok);
    strictEqual(result.errors.objVal, 'object-validator-ran');
  });

  it('a records instance validator rejects at its field', async () => {
    const result = await runCreate('CTiers', { tags: ['tg1', 'tg2'] }, null);
    ok(!result.ok);
    strictEqual(result.errors.tags, 'too-many-tags');
  });

  it('a nested repeater instance validator rejects at its dot-path', async () => {
    const result = await runCreate('CTNest', { outer: [{ inner: [{ heading: 'BAD' }] }] }, null);
    ok(!result.ok);
    strictEqual(result.errors['outer[0].inner'], 'rejected-by-validator');
  });
});

describe('composite instance sanitizers run', () => {
  it('a repeater instance sanitizer transforms the stored value', async () => {
    const result = await runCreate(
      'CTiers',
      { repSan: [{ heading: 'a' }, { heading: 'b' }] },
      null,
    );
    ok(result.ok);
    const rep = (result.record as { repSan: { heading: string }[] }).repSan;
    strictEqual(rep[0].heading, 'a!');
    strictEqual(rep[1].heading, 'b!');
  });

  it('an object instance sanitizer transforms the stored value', async () => {
    const result = await runCreate('CTiers', { objSan: { note: 'n' } }, null);
    ok(result.ok);
    strictEqual((result.record as { objSan: { note: string } }).objSan.note, 'n!');
  });
});

describe('composite tier skips the childOne null branch', () => {
  it('does not run the object tier on an explicit null', async () => {
    const result = await runCreate('CTiers', { objVal: null }, null);
    ok(result.ok);
  });
});

describe('composite tier runs after when-gating', () => {
  it('runs a provided composite tier when its gate is active', async () => {
    const result = await runCreate('CTGate', { mode: 'full', items: [{ heading: 'x' }] }, null);
    ok(!result.ok);
    strictEqual(result.errors.items, 'gated-validator-ran');
  });

  it('skips the tier when the gate is inactive, landing the trusted default', async () => {
    const result = await runCreate('CTGate', { mode: 'lite', items: [{ heading: 'x' }] }, null);
    ok(result.ok);
    deepStrictEqual((result.record as { items: unknown[] }).items, []);
  });
});

describe('a sibling when reads the pre-sanitizer composite value', () => {
  it('gates a sibling on the provided value, not the sanitizer output', async () => {
    const result = await runCreate('CTScope', { items: [{ heading: 'x' }], featured: true }, null);
    ok(result.ok);
    const record = result.record as { items: unknown[]; featured: boolean };
    strictEqual(record.featured, true);
    deepStrictEqual(record.items, []);
  });
});
