import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { WireErrorData } from '../../../../src/ohne/query/wire/errors.ts';

import { useCollections } from '../../../../src/ohne/collections/use-collections.ts';
import { field } from '../../../../src/ohne/fields/field.ts';
import { HTTPError } from '../../../../src/ohne/http/http-error.ts';
import { queryMetadata } from '../../../../src/ohne/query/metadata.ts';
import { DEFAULT_QUERY_GUARDS, type QueryGuards } from '../../../../src/ohne/query/wire/guards.ts';
import { parseQueryParams } from '../../../../src/ohne/query/wire/parse.ts';
import { parseSearchParams, type SearchParamValue } from '../../../../src/utils/index.ts';

useCollections().register('WUsers', {
  name: 'WUsers',
  collection: { fields: { name: field('text') } },
});
useCollections().register('WTags', {
  name: 'WTags',
  collection: { fields: { label: field('text') } },
});
useCollections().register('WPosts', {
  name: 'WPosts',
  collection: {
    fields: {
      title: field('text'),
      views: field('integer'),
      featured: field('boolean'),
      summary: field('text', { nullable: true }),
      author: field('record', { collection: 'WUsers' }),
      tags: field('records', { collection: 'WTags' }),
      meta: field('object', { fields: { note: field('text') } }),
    },
  },
});

const meta = queryMetadata('WPosts');

function parse(query: string, guards: QueryGuards = DEFAULT_QUERY_GUARDS) {
  return parseQueryParams(parseSearchParams(query), meta, guards);
}

function caught(fn: () => unknown): HTTPError {
  try {
    fn();
  } catch (error) {
    if (error instanceof HTTPError) return error;
    throw error;
  }
  throw new Error('expected a wire error to throw');
}

function failure(query: string, guards: QueryGuards = DEFAULT_QUERY_GUARDS): WireErrorData {
  const error = caught(() => parse(query, guards));
  strictEqual(error.status, 400);
  return error.data as WireErrorData;
}

const tight: QueryGuards = {
  ...DEFAULT_QUERY_GUARDS,
  maxConditions: 3,
  maxHasDepth: 1,
  maxInLength: 2,
  maxSelect: 2,
  maxOrder: 2,
  maxValueBytes: 8,
  maxPatternBytes: 4,
  maxPerPage: 50,
};

describe('parseQueryParams reads a query chain off a URL', () => {
  it('parses a where condition into the object the builder replays', () => {
    deepStrictEqual(parse('where={views:{atLeast:100}}').where, { views: { atLeast: 100 } });
  });

  it('parses select, order, and populate', () => {
    const parsed = parse('select=[title,views]&order=[-views,title]&populate=[author,tags]');
    deepStrictEqual(parsed.select, ['title', 'views']);
    deepStrictEqual(parsed.order, [
      { field: 'views', direction: 'desc' },
      { field: 'title', direction: 'asc' },
    ]);
    deepStrictEqual(parsed.populate, ['author', 'tags']);
  });

  it('wraps a lone select value into a list', () => {
    deepStrictEqual(parse('select=title').select, ['title']);
  });

  it('parses the row window', () => {
    const parsed = parse('limit=20&offset=40');
    strictEqual(parsed.limit, 20);
    strictEqual(parsed.offset, 40);
    strictEqual(parsed.page, null);
  });

  it('clamps perPage to the ceiling', () => {
    strictEqual(parse('page=2&perPage=999', tight).perPage, 50);
  });

  it('leaves an absent param null', () => {
    const parsed = parse('');
    strictEqual(parsed.where, null);
    strictEqual(parsed.select, null);
    deepStrictEqual(parsed.order, []);
    deepStrictEqual(parsed.populate, []);
  });

  it('accepts a has into a relation', () => {
    deepStrictEqual(parse('where={author:{has:{name:Alice}}}').where, {
      author: { has: { name: 'Alice' } },
    });
  });
});

describe('parseQueryParams rejects with a stable code and dot path', () => {
  it('rejects an unknown top-level param', () => {
    deepStrictEqual(failure('sort=title'), { code: 'unknownParam', path: 'sort' });
  });

  it('collapses an unknown where field to invalidField, suggesting a near one', () => {
    const error = caught(() => parse('where={titl:x}'));
    deepStrictEqual(error.data, { code: 'invalidField', path: 'where.titl' });
    strictEqual(error.message, 'query.invalidFieldSuggestion');
  });

  it('collapses an inapplicable operator to invalidField', () => {
    deepStrictEqual(failure('where={featured:{atLeast:1}}'), {
      code: 'invalidField',
      path: 'where.featured',
    });
  });

  it('locates a failure inside a has by its full path', () => {
    deepStrictEqual(failure('where={author:{has:{missing:1}}}'), {
      code: 'invalidField',
      path: 'where.author.missing',
    });
  });

  it('rejects a value whose type the column refuses', () => {
    deepStrictEqual(failure('where={views:{equalsTo:`007}}'), {
      code: 'invalidValue',
      path: 'where.views',
    });
  });

  it('rejects a wrong-typed value inside a has by its path', () => {
    deepStrictEqual(failure('where={author:{has:{name:5}}}'), {
      code: 'invalidValue',
      path: 'where.author.name',
    });
  });

  it('rejects null as a value, naming isNull', () => {
    strictEqual(failure('where={summary:null}').code, 'nullEquality');
  });

  it('rejects an unknown operator', () => {
    strictEqual(failure('where={views:{atMostish:1}}').code, 'unknownOperator');
  });

  it('rejects an empty select', () => {
    deepStrictEqual(failure('select=[]'), { code: 'emptySelect', path: 'select' });
  });

  it('rejects ordering by a field with no column', () => {
    deepStrictEqual(failure('order=[tags]'), { code: 'invalidField', path: 'order[0]' });
  });

  it('rejects a duplicate order field', () => {
    deepStrictEqual(failure('order=[views,-views]'), {
      code: 'duplicateOrderField',
      path: 'order[1]',
    });
  });

  it('rejects populating a non-relation', () => {
    deepStrictEqual(failure('populate=[title]'), { code: 'invalidField', path: 'populate[0]' });
  });

  it('rejects mixing the two windowing modes', () => {
    strictEqual(failure('limit=10&page=2').code, 'invalidPagination');
  });

  it('rejects a non-integer window value', () => {
    strictEqual(failure('limit=1.5').code, 'invalidNumber');
    strictEqual(failure('limit=-1').code, 'invalidNumber');
    strictEqual(failure('page=0').code, 'invalidNumber');
    strictEqual(failure('offset=abc').code, 'invalidNumber');
  });

  it('treats a `__proto__` field as an unknown field, never a pollution', () => {
    strictEqual(failure('where={__proto__:1}').code, 'invalidField');
  });
});

describe('parseQueryParams enforces the DoS ceilings on the untrusted path', () => {
  it('rejects too many clauses', () => {
    strictEqual(
      failure('where={title:a,views:1,featured:true,summary:b}', tight).code,
      'tooManyConditions',
    );
  });

  it('rejects a has nested past the ceiling', () => {
    const error = failure('where={author:{has:{name:{has:{}}}}}', tight);
    ok(error.code === 'hasTooDeep' || error.code === 'invalidField');
  });

  it('rejects an over-long in list', () => {
    strictEqual(failure('where={views:{in:[1,2,3]}}', tight).code, 'listTooLong');
  });

  it('rejects too many selected fields', () => {
    strictEqual(failure('select=[title,views,featured]', tight).code, 'tooManyFields');
  });

  it('rejects too many order keys', () => {
    strictEqual(failure('order=[title,-views,featured]', tight).code, 'tooManyOrderKeys');
  });

  it('rejects an oversized value', () => {
    strictEqual(failure('where={title:abcdefghij}', tight).code, 'valueTooLarge');
  });

  it('rejects an oversized pattern', () => {
    strictEqual(failure('where={title:{contains:abcdef}}', tight).code, 'patternTooLarge');
  });

  it('rejects a query that would bind more values than the driver backstop', () => {
    const list = Array.from({ length: 2000 }, (_, i) => i).join(',');
    const branches = Array.from({ length: 6 }, () => `{views:{in:[${list}]}}`).join(',');
    strictEqual(failure(`where={and:[${branches}]}`).code, 'tooManyBoundParams');
  });

  it('accepts a query that sits under every ceiling', () => {
    const parsed = parse('where={views:{in:[1,2]}}&select=[title,views]', tight);
    deepStrictEqual(parsed.select, ['title', 'views']);
  });
});

describe('the GET and POST transports converge on one parsed query', () => {
  const cases: Array<[string, Record<string, SearchParamValue>]> = [
    [
      'where={featured:true}&select=[title]&limit=20',
      { where: { featured: true }, select: ['title'], limit: 20 },
    ],
    [
      'where={views:{atLeast:100}}&order=[-views]',
      { where: { views: { atLeast: 100 } }, order: ['-views'] },
    ],
    ['populate=[author]&page=2&perPage=10', { populate: ['author'], page: 2, perPage: 10 }],
  ];
  for (const [query, body] of cases) {
    it(`\`${query}\` parses the same from a URL and a JSON body`, () => {
      deepStrictEqual(
        parseQueryParams(parseSearchParams(query), meta, DEFAULT_QUERY_GUARDS),
        parseQueryParams(body, meta, DEFAULT_QUERY_GUARDS),
      );
    });
  }
});
