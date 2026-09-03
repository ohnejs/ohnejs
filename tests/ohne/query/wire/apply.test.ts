import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { OrderDirection } from '../../../../src/ohne/query/ir.ts';
import type { CollectionQueryMeta } from '../../../../src/ohne/query/metadata.ts';
import type { UntypedQueryBuilder } from '../../../../src/ohne/query/untyped.ts';
import type { ParsedQuery } from '../../../../src/ohne/query/wire/parse.ts';

import {
  applyQuery,
  applyScope,
  type QueryScope,
  scopedMetadata,
} from '../../../../src/ohne/query/wire/apply.ts';

function recorder(): { builder: UntypedQueryBuilder; calls: string[] } {
  const calls: string[] = [];
  const builder = {
    locale: (code: string) => (calls.push(`locale:${code}`), builder),
    where: (condition: unknown) => (calls.push(`where:${JSON.stringify(condition)}`), builder),
    select: (...fields: string[]) => (calls.push(`select:${fields.join(',')}`), builder),
    orderBy: (f: string, d: OrderDirection) => (calls.push(`order:${f}:${d}`), builder),
    limit: (n: number) => (calls.push(`limit:${n}`), builder),
    offset: (n: number) => (calls.push(`offset:${n}`), builder),
    populate: (...fields: string[]) => (calls.push(`populate:${fields.join(',')}`), builder),
  };
  return { builder: builder as unknown as UntypedQueryBuilder, calls };
}

function query(overrides: Partial<ParsedQuery> = {}): ParsedQuery {
  return {
    where: null,
    select: null,
    order: [],
    populate: [],
    limit: null,
    offset: null,
    page: null,
    perPage: null,
    locale: null,
    ...overrides,
  };
}

describe('applyQuery replays a parsed query onto the builder', () => {
  it('applies each part in one chain', () => {
    const { builder, calls } = recorder();
    applyQuery(
      builder,
      query({
        where: { views: { atLeast: 10 } },
        select: ['title'],
        order: [{ field: 'views', direction: 'desc' }],
        populate: ['author'],
        limit: 20,
        offset: 5,
      }),
    );
    deepStrictEqual(calls, [
      'where:{"views":{"atLeast":10}}',
      'select:title',
      'order:views:desc',
      'populate:author',
      'limit:20',
      'offset:5',
    ]);
  });

  it('applies nothing for an empty query', () => {
    const { builder, calls } = recorder();
    applyQuery(builder, query());
    deepStrictEqual(calls, []);
  });
});

describe('applyQuery composes a request under a scope', () => {
  it('ANDs the scope filter before the request filter', () => {
    const { builder, calls } = recorder();
    const scope: QueryScope = { where: { published: true } };
    applyQuery(builder, query({ where: { views: { atLeast: 10 } } }), scope);
    deepStrictEqual(calls, ['where:{"published":true}', 'where:{"views":{"atLeast":10}}']);
  });

  it('intersects the scoped select with the request select', () => {
    const { builder, calls } = recorder();
    const scope: QueryScope = { select: ['title', 'body'] };
    applyQuery(builder, query({ select: ['body', 'secret'] }), scope);
    deepStrictEqual(calls, ['select:body']);
  });

  it('keeps the scope select when the request names only out-of-scope fields', () => {
    const { builder, calls } = recorder();
    const scope: QueryScope = { select: ['title', 'body'] };
    applyQuery(builder, query({ select: ['secret'] }), scope);
    deepStrictEqual(calls, ['select:title,body']);
  });

  it('keeps the scope select when the request names none', () => {
    const { builder, calls } = recorder();
    const scope: QueryScope = { select: ['title'] };
    applyQuery(builder, query(), scope);
    deepStrictEqual(calls, ['select:title']);
  });

  it('takes the smaller of the scoped and requested limit', () => {
    const under = recorder();
    applyQuery(under.builder, query({ limit: 10 }), { limit: 50 });
    deepStrictEqual(under.calls, ['limit:10']);

    const over = recorder();
    applyQuery(over.builder, query({ limit: 500 }), { limit: 50 });
    deepStrictEqual(over.calls, ['limit:50']);
  });
});

describe('applyQuery scopes the locale', () => {
  it('replays the parsed locale before the filters', () => {
    const { builder, calls } = recorder();
    applyQuery(builder, query({ locale: 'de', where: { views: { atLeast: 10 } } }));
    deepStrictEqual(calls, ['locale:de', 'where:{"views":{"atLeast":10}}']);
  });

  it('applies the scope locale when the param is absent', () => {
    const { builder, calls } = recorder();
    applyQuery(builder, query(), { locale: 'en' });
    deepStrictEqual(calls, ['locale:en']);
  });

  it('lets the param win over the scope locale', () => {
    const { builder, calls } = recorder();
    applyQuery(builder, query({ locale: 'de' }), { locale: 'en' });
    deepStrictEqual(calls, ['locale:de']);
  });
});

describe('applyScope composes a scope with no wire query', () => {
  it('applies the locale, filter, fields, and cap as they are', () => {
    const { builder, calls } = recorder();
    applyScope(builder, { locale: 'de', where: { owner: 'u1' }, select: ['title'], limit: 50 });
    deepStrictEqual(calls, ['locale:de', 'where:{"owner":"u1"}', 'select:title', 'limit:50']);
  });

  it('touches nothing under an empty scope', () => {
    const { builder, calls } = recorder();
    strictEqual(applyScope(builder, {}), builder);
    deepStrictEqual(calls, []);
  });
});

describe('scopedMetadata hides the fields outside a scope select', () => {
  const meta = {
    collection: 'Posts',
    table: 'posts',
    compositeUniques: [],
    fields: {
      UUID: { kind: 'column', type: 'text' },
      title: { kind: 'column', type: 'text' },
      note: { kind: 'column', type: 'text' },
    },
  } as unknown as CollectionQueryMeta;

  it('returns the metadata as is without a select', () => {
    strictEqual(scopedMetadata(meta, { where: { title: 'x' } }), meta);
  });

  it('marks every field outside the select unreadable, leaving the metadata untouched', () => {
    const scoped = scopedMetadata(meta, { select: ['title'] });
    deepStrictEqual(scoped.fields.title, { kind: 'column', type: 'text' });
    strictEqual(scoped.fields.note?.readable, false);
    strictEqual(scoped.fields.UUID?.readable, false);
    strictEqual(meta.fields.note?.readable, undefined);
  });
});
