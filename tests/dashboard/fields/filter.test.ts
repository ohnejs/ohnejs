import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import {
  type FilterCondition,
  filterFromWhere,
  filterKey,
  type FilterModel,
  type FilterOperator,
  filterToWhere,
} from '../../../src/dashboard/fields/filter.ts';

function condition(
  field: string,
  operator: FilterOperator,
  value: string | number | boolean,
): FilterCondition {
  return { key: filterKey(), field, operator, value };
}

function stripItems(items: FilterModel['items']): unknown[] {
  return items.map((item) =>
    'items' in item
      ? { relation: item.relation, items: stripItems(item.items) }
      : { field: item.field, operator: item.operator, value: item.value },
  );
}

function strip(model: FilterModel): unknown {
  return { relation: model.relation, items: stripItems(model.items) };
}

describe('filterToWhere', () => {
  it('serializes an empty model to undefined', () => {
    strictEqual(filterToWhere({ relation: 'and', items: [] }), undefined);
  });

  it('serializes a single condition without a wrapping group', () => {
    deepStrictEqual(filterToWhere({ relation: 'and', items: [condition('views', 'gte', 10)] }), {
      views: { atLeast: 10 },
    });
  });

  it('maps every operator onto the condition grammar', () => {
    const pairs: [FilterOperator, unknown][] = [
      ['eq', { title: { equalsTo: 'x' } }],
      ['ne', { not: { title: { equalsTo: 'x' } } }],
      ['lt', { title: { lessThan: 'x' } }],
      ['lte', { title: { atMost: 'x' } }],
      ['gt', { title: { greaterThan: 'x' } }],
      ['gte', { title: { atLeast: 'x' } }],
      ['startsWith', { title: { startsWith: 'x' } }],
      ['endsWith', { title: { endsWith: 'x' } }],
      ['contains', { title: { contains: 'x' } }],
      ['notContains', { not: { title: { contains: 'x' } } }],
      ['includes', { title: { includes: 'x' } }],
      ['notIncludes', { not: { title: { includes: 'x' } } }],
    ];
    for (const [operator, expected] of pairs) {
      deepStrictEqual(
        filterToWhere({ relation: 'and', items: [condition('title', operator, 'x')] }),
        expected,
      );
    }
  });

  it('substitutes a space for an empty pattern value', () => {
    deepStrictEqual(
      filterToWhere({ relation: 'and', items: [condition('title', 'contains', '')] }),
      { title: { contains: ' ' } },
    );
    deepStrictEqual(filterToWhere({ relation: 'and', items: [condition('title', 'eq', '')] }), {
      title: { equalsTo: '' },
    });
  });

  it('groups multiple members under the relation and omits empty groups', () => {
    deepStrictEqual(
      filterToWhere({
        relation: 'or',
        items: [
          condition('a', 'eq', 1),
          { key: filterKey(), relation: 'and', items: [] },
          {
            key: filterKey(),
            relation: 'and',
            items: [condition('b', 'eq', 2), condition('c', 'eq', 3)],
          },
        ],
      }),
      { or: [{ a: { equalsTo: 1 } }, { and: [{ b: { equalsTo: 2 } }, { c: { equalsTo: 3 } }] }] },
    );
  });
});

describe('filterFromWhere', () => {
  it('parses undefined to an empty and-model', () => {
    deepStrictEqual(filterFromWhere(undefined), { relation: 'and', items: [] });
  });

  it('round-trips what filterToWhere emits', () => {
    const model: FilterModel = {
      relation: 'or',
      items: [
        condition('title', 'notContains', 'draft'),
        {
          key: filterKey(),
          relation: 'and',
          items: [condition('views', 'gte', 10), condition('published', 'eq', true)],
        },
      ],
    };
    const where = filterToWhere(model);
    deepStrictEqual(strip(filterFromWhere(where)), strip(model));
    deepStrictEqual(filterToWhere(filterFromWhere(where)), where);
  });

  it('reads the equalsTo shorthand and negated leaves', () => {
    deepStrictEqual(strip(filterFromWhere({ status: 'published' })), {
      relation: 'and',
      items: [{ field: 'status', operator: 'eq', value: 'published' }],
    });
    deepStrictEqual(strip(filterFromWhere({ not: { status: { equalsTo: 'draft' } } })), {
      relation: 'and',
      items: [{ field: 'status', operator: 'ne', value: 'draft' }],
    });
    deepStrictEqual(strip(filterFromWhere({ not: { tags: { includes: 'news' } } })), {
      relation: 'and',
      items: [{ field: 'tags', operator: 'notIncludes', value: 'news' }],
    });
  });

  it('lifts a lone top-level or-group into the or relation', () => {
    const parsed = filterFromWhere({ or: [{ a: { equalsTo: 1 } }, { b: { equalsTo: 2 } }] });
    strictEqual(parsed.relation, 'or');
    strictEqual(parsed.items.length, 2);
  });

  it('drops what the builder cannot represent', () => {
    deepStrictEqual(
      strip(filterFromWhere({ a: { isNull: true }, b: { in: [1, 2] }, c: { equalsTo: 3 } })),
      { relation: 'and', items: [{ field: 'c', operator: 'eq', value: 3 }] },
    );
    deepStrictEqual(strip(filterFromWhere({ not: { or: [{ a: { equalsTo: 1 } }] } })), {
      relation: 'and',
      items: [],
    });
  });
});
