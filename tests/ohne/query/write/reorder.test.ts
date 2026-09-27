import { deepStrictEqual, ok } from 'node:assert';
import { describe, it } from 'node:test';

import type { ProcessedScope } from '../../../../src/ohne/query/pipeline/run-record.ts';
import type { KeptWrite } from '../../../../src/ohne/query/write/reorder.ts';

import { useCollections } from '../../../../src/ohne/collections/use-collections.ts';
import { SQLiteDialect } from '../../../../src/ohne/database/dialects/sqlite/dialect.ts';
import { field } from '../../../../src/ohne/fields/field.ts';
import { queryMetadata } from '../../../../src/ohne/query/metadata.ts';
import { orderKeptWrites } from '../../../../src/ohne/query/write/reorder.ts';

useCollections().register('RORotate', {
  name: 'RORotate',
  collection: {
    fields: { items: field('repeater', { fields: { slug: field('text', { unique: true }) } }) },
  },
});

const dialect = new SQLiteDialect();

function rotation(length: number, last: string): KeptWrite[] {
  return Array.from({ length }, (_, index) => ({
    uuid: `u${index}`,
    parent: 'p',
    stored: { slug: `s${index}` },
    scope: {
      columns: { slug: index === length - 1 ? last : `s${index + 1}` },
    } as unknown as ProcessedScope,
  }));
}

describe('orderKeptWrites', () => {
  const subfields = queryMetadata('RORotate').fields.items.subfields!;

  it('writes a chain from its free end back', () => {
    deepStrictEqual(orderKeptWrites(dialect, rotation(3, 'fresh'), subfields), [
      { kind: 'item', index: 2 },
      { kind: 'item', index: 1 },
      { kind: 'item', index: 0 },
    ]);
  });

  it('breaks a rotation cycle at its lowest-index holder', () => {
    deepStrictEqual(orderKeptWrites(dialect, rotation(3, 's0'), subfields), [
      { kind: 'sentinel', sub: subfields.slug, uuid: 'u0' },
      { kind: 'item', index: 2 },
      { kind: 'item', index: 1 },
      { kind: 'item', index: 0 },
    ]);
  });

  it('orders a long rotation chain in linear time', () => {
    const rows = rotation(4_000, 'fresh');
    const started = performance.now();
    const steps = orderKeptWrites(dialect, rows, subfields);
    const elapsed = performance.now() - started;
    deepStrictEqual(steps?.[0], { kind: 'item', index: 3_999 });
    deepStrictEqual(steps?.at(-1), { kind: 'item', index: 0 });
    ok(elapsed < 250, `${elapsed.toFixed(0)} ms`);
  });
});
