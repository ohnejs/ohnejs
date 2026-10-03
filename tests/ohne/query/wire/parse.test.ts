import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { WireErrorData } from '../../../../src/ohne/query/wire/errors.ts';

import { useBlocks } from '../../../../src/ohne/blocks/use-blocks.ts';
import { useCollections } from '../../../../src/ohne/collections/use-collections.ts';
import { field } from '../../../../src/ohne/fields/field.ts';
import { HTTPError } from '../../../../src/ohne/http/http-error.ts';
import { useLayers } from '../../../../src/ohne/layers/use-layers.ts';
import { queryMetadata } from '../../../../src/ohne/query/metadata.ts';
import { scopedMetadata } from '../../../../src/ohne/query/wire/apply.ts';
import { DEFAULT_QUERY_GUARDS, type QueryGuards } from '../../../../src/ohne/query/wire/guards.ts';
import { parseQueryParams } from '../../../../src/ohne/query/wire/parse.ts';
import { parseSearchParams, type SearchParamValue } from '../../../../src/utils/index.ts';

useLayers().add({
  path: '/wire-parse',
  input: { collections: { locales: ['en', 'de', 'de-AT'], defaultLocale: 'en' } },
});

useBlocks().register('WHero', {
  name: 'WHero',
  block: {
    fields: {
      title: field('text'),
      rank: field('integer'),
      author: field('record', { collection: 'WUsers' }),
      parts: field('blocks', { allow: ['WQuote'] }),
    },
  },
});
useBlocks().register('WQuote', { name: 'WQuote', block: { fields: { words: field('text') } } });
useBlocks().register('WLoose', { name: 'WLoose', block: { fields: { note: field('text') } } });

useCollections().register('WUsers', {
  name: 'WUsers',
  collection: {
    fields: { name: field('text'), boss: field('record', { collection: 'WUsers' }) },
  },
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
      rating: field('number'),
      featured: field('boolean'),
      summary: field('text', { nullable: true }),
      author: field('record', { collection: 'WUsers' }),
      tags: field('records', { collection: 'WTags' }),
      meta: field('object', { fields: { note: field('text') } }),
      content: field('blocks', { allow: ['WHero', 'WQuote'] }),
    },
  },
});

useCollections().register('WArticles', {
  name: 'WArticles',
  collection: { fields: { title: field('text', { translatable: true }) } },
});

useCollections().register('WSites', {
  name: 'WSites',
  collection: { fields: { content: field('blocks', { translatable: true, allow: ['WHero'] }) } },
});

useBlocks().register('WVault', {
  name: 'WVault',
  block: { fields: { caption: field('text'), token: field('text', { readable: false }) } },
});

useCollections().register('WProfiles', {
  name: 'WProfiles',
  collection: { fields: { bio: field('text'), secret: field('text', { readable: false }) } },
});

useCollections().register('WAccounts', {
  name: 'WAccounts',
  collection: {
    fields: {
      email: field('text'),
      password: field('text', { readable: false }),
      profile: field('record', { collection: 'WProfiles' }),
      audit: field('record', { collection: 'WProfiles', readable: false }),
      vault: field('blocks', { allow: ['WVault'] }),
    },
  },
});

const meta = queryMetadata('WPosts');
const translatableMeta = queryMetadata('WArticles');
const hiddenMeta = queryMetadata('WAccounts');

function parse(query: string, guards: QueryGuards = DEFAULT_QUERY_GUARDS) {
  return parseQueryParams(parseSearchParams(query), meta, guards);
}

function parseLocalized(query: string) {
  return parseQueryParams(parseSearchParams(query), translatableMeta, DEFAULT_QUERY_GUARDS);
}

function parseHidden(query: string) {
  return parseQueryParams(parseSearchParams(query), hiddenMeta, DEFAULT_QUERY_GUARDS);
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

function localizedFailure(query: string): WireErrorData {
  const error = caught(() => parseLocalized(query));
  strictEqual(error.status, 400);
  return error.data as WireErrorData;
}

function hiddenFailure(query: string): WireErrorData {
  const error = caught(() => parseHidden(query));
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

  it('fills an unpaged read with the maxLimit ceiling', () => {
    strictEqual(parse('').limit, DEFAULT_QUERY_GUARDS.maxLimit);
    strictEqual(parse('', { ...DEFAULT_QUERY_GUARDS, maxLimit: 7 }).limit, 7);
  });

  it('lowers limit to the maxLimit ceiling', () => {
    strictEqual(parse('limit=100000').limit, DEFAULT_QUERY_GUARDS.maxLimit);
  });

  it('caps an offset-only read at maxLimit', () => {
    const parsed = parse('offset=5');
    strictEqual(parsed.limit, DEFAULT_QUERY_GUARDS.maxLimit);
    strictEqual(parsed.offset, 5);
  });

  it('keeps limit null on a paginated read', () => {
    strictEqual(parse('page=2').limit, null);
    strictEqual(parse('perPage=10').limit, null);
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
    deepStrictEqual(parse('where={author:{has:{name:Azshara}}}').where, {
      author: { has: { name: 'Azshara' } },
    });
  });
});

describe('parseQueryParams accepts the blocks grammar', () => {
  it('accepts a bare has and an empty on a blocks field', () => {
    deepStrictEqual(parse('where={content:{has:true}}').where, { content: { has: true } });
    deepStrictEqual(parse('where={content:{empty:true}}').where, { content: { empty: true } });
  });

  it('accepts a discriminator-only has', () => {
    deepStrictEqual(parse('where={content:{has:{block:WHero}}}').where, {
      content: { has: { block: 'WHero' } },
    });
  });

  it('accepts subfield conditions beside the discriminator', () => {
    deepStrictEqual(parse('where={content:{has:{block:WHero,title:{contains:x}}}}').where, {
      content: { has: { block: 'WHero', title: { contains: 'x' } } },
    });
  });

  it('accepts a nested has on a record inside the block scope', () => {
    deepStrictEqual(
      parse('where={content:{has:{block:WHero,author:{has:{name:Azshara}}}}}').where,
      {
        content: { has: { block: 'WHero', author: { has: { name: 'Azshara' } } } },
      },
    );
  });

  it('accepts a blocks tower, each level discriminated', () => {
    deepStrictEqual(
      parse('where={content:{has:{block:WHero,parts:{has:{block:WQuote,words:y}}}}}').where,
      { content: { has: { block: 'WHero', parts: { has: { block: 'WQuote', words: 'y' } } } } },
    );
  });

  it('accepts selecting a blocks field', () => {
    deepStrictEqual(parse('select=[content]').select, ['content']);
  });

  it('scopes a translatable blocks collection by locale, the blocks where intact', () => {
    const parsed = parseQueryParams(
      parseSearchParams('locale=de&where={content:{has:{block:WHero}}}'),
      queryMetadata('WSites'),
      DEFAULT_QUERY_GUARDS,
    );
    strictEqual(parsed.locale, 'de');
    deepStrictEqual(parsed.where, { content: { has: { block: 'WHero' } } });
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

  it('takes a decimal on a real column, never on an integer one', () => {
    deepStrictEqual(parse('where={rating:{atLeast:4.5}}').where, { rating: { atLeast: 4.5 } });
    deepStrictEqual(failure('where={views:{equalsTo:1.5}}'), {
      code: 'invalidValue',
      path: 'where.views',
    });
    deepStrictEqual(failure('where={rating:{atLeast:1e999}}'), {
      code: 'invalidValue',
      path: 'where.rating',
    });
  });

  it('takes target UUIDs on a records membership test, never another type', () => {
    deepStrictEqual(parse('where={tags:{includesAny:[t1,t2]}}').where, {
      tags: { includesAny: ['t1', 't2'] },
    });
    deepStrictEqual(failure('where={tags:{includes:5}}'), {
      code: 'invalidValue',
      path: 'where.tags',
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

  it('treats an inherited property name as an unknown field, never a pollution', () => {
    strictEqual(failure('where={__proto__:1}').code, 'invalidField');
    strictEqual(failure('where={__proto__:{has:{x:1}}}').code, 'invalidField');
    strictEqual(failure('where={constructor:{equalsTo:1}}').code, 'invalidField');
    strictEqual(failure('where={toString:{has:{x:1}}}').code, 'invalidField');
    strictEqual(failure('select=[__proto__]').code, 'invalidField');
    strictEqual(failure('order=[hasOwnProperty]').code, 'invalidField');
    strictEqual(failure('populate=[constructor]').code, 'invalidField');
  });
});

describe('parseQueryParams enforces the blocks two-step', () => {
  it('rejects a has scope naming no type', () => {
    deepStrictEqual(failure('where={content:{has:{title:x}}}'), {
      code: 'blockTypeRequired',
      path: 'where.content',
    });
  });

  it('rejects a negated, listed, or or-grouped discriminator', () => {
    deepStrictEqual(failure('where={content:{has:{block:{not:{equalsTo:WHero}}}}}'), {
      code: 'blockTypeRequired',
      path: 'where.content',
    });
    deepStrictEqual(failure('where={content:{has:{block:{in:[WHero]}}}}'), {
      code: 'blockTypeRequired',
      path: 'where.content',
    });
    deepStrictEqual(failure('where={content:{has:{or:[{block:WHero},{block:WQuote}]}}}'), {
      code: 'blockTypeRequired',
      path: 'where.content',
    });
  });

  it('rejects an unknown block type at the discriminator path', () => {
    const error = caught(() => parse('where={content:{has:{block:Ghost}}}'));
    deepStrictEqual(error.data, { code: 'unknownBlockType', path: 'where.content.block' });
    strictEqual(error.message, 'query.unknownBlockType');
  });

  it('suggests the closest allowed type for a near miss', () => {
    const error = caught(() => parse('where={content:{has:{block:WHeroo}}}'));
    deepStrictEqual(error.data, { code: 'unknownBlockType', path: 'where.content.block' });
    strictEqual(error.message, 'query.unknownBlockTypeSuggestion');
  });

  it('rejects a registered type outside the field allow set', () => {
    deepStrictEqual(failure('where={content:{has:{block:WLoose}}}'), {
      code: 'unknownBlockType',
      path: 'where.content.block',
    });
  });

  it('locates an unknown subfield inside the block scope', () => {
    deepStrictEqual(failure('where={content:{has:{block:WHero,missing:1}}}'), {
      code: 'invalidField',
      path: 'where.content.missing',
    });
  });

  it('rejects a wrong-typed value inside the block scope by its path', () => {
    deepStrictEqual(failure('where={content:{has:{block:WHero,rank:{equalsTo:`007}}}}'), {
      code: 'invalidValue',
      path: 'where.content.rank',
    });
  });

  it('rejects ordering or populating a blocks field', () => {
    deepStrictEqual(failure('order=[content]'), { code: 'invalidField', path: 'order[0]' });
    deepStrictEqual(failure('populate=[content]'), { code: 'invalidField', path: 'populate[0]' });
  });
});

describe('parseQueryParams reads populate specs', () => {
  it('parses bare names and spec objects side by side', () => {
    const parsed = parse('populate=[tags,{author:{select:[name]}}]');
    deepStrictEqual(parsed.populate, ['tags', { author: { select: ['name'] } }]);
  });

  it('parses a nested populate to the default depth', () => {
    const parsed = parse(
      'populate=[{author:{select:[name,boss],populate:[{boss:{select:[name]}}]}}]',
    );
    deepStrictEqual(parsed.populate, [
      { author: { select: ['name', 'boss'], populate: [{ boss: { select: ['name'] } }] } },
    ]);
  });

  it('normalizes lone-string select and populate values to lists', () => {
    deepStrictEqual(parse('populate=[{author:{select:name,populate:boss}}]').populate, [
      { author: { select: ['name'], populate: ['boss'] } },
    ]);
  });

  it('rejects an unknown relation in a spec key', () => {
    deepStrictEqual(failure('populate=[{nope:{select:[name]}}]'), {
      code: 'invalidField',
      path: 'populate[0].nope',
    });
  });

  it('rejects a non-relation spec key', () => {
    deepStrictEqual(failure('populate=[{title:{select:[name]}}]'), {
      code: 'invalidField',
      path: 'populate[0].title',
    });
  });

  it('rejects an unknown subselect name, scoped to the target', () => {
    deepStrictEqual(failure('populate=[{author:{select:[nome]}}]'), {
      code: 'invalidField',
      path: 'populate[0].author.select[0]',
    });
  });

  it('rejects an empty subselect at its own path', () => {
    deepStrictEqual(failure('populate=[{author:{select:[]}}]'), {
      code: 'emptySelect',
      path: 'populate[0].author.select',
    });
  });

  it('rejects a spec carrying keys other than select and populate', () => {
    deepStrictEqual(failure('populate=[{author:{limit:5}}]'), {
      code: 'invalidShape',
      path: 'populate[0].author',
    });
  });

  it('rejects a spec value that is not an object', () => {
    deepStrictEqual(failure('populate=[{author:5}]'), {
      code: 'invalidShape',
      path: 'populate[0].author',
    });
  });

  it('passes a bare repeat and rejects a repeat involving a spec', () => {
    deepStrictEqual(parse('populate=[author,author]').populate, ['author', 'author']);
    deepStrictEqual(failure('populate=[author,{author:{select:[name]}}]'), {
      code: 'duplicatePopulateField',
      path: 'populate[1].author',
    });
  });

  it('rejects a populate nested past the depth ceiling', () => {
    deepStrictEqual(failure('populate=[{author:{populate:[{boss:{populate:[boss]}}]}}]'), {
      code: 'populateTooDeep',
      path: 'populate[0].author.populate[0].boss.populate',
    });
  });

  it('accepts the third level once the depth ceiling is raised', () => {
    const parsed = parse('populate=[{author:{populate:[{boss:{populate:[boss]}}]}}]', {
      ...DEFAULT_QUERY_GUARDS,
      maxPopulateDepth: 3,
    });
    strictEqual(parsed.populate.length, 1);
  });

  it('rejects a tree with more nodes than the ceiling, nested nodes counted', () => {
    deepStrictEqual(
      failure('populate=[{author:{populate:[boss]}},tags]', {
        ...DEFAULT_QUERY_GUARDS,
        maxPopulate: 2,
      }),
      { code: 'tooManyPopulate', path: 'populate' },
    );
  });

  it('rejects a subselect naming more fields than maxSelect', () => {
    strictEqual(
      failure('populate=[{author:{select:[UUID,name,boss]}}]', {
        ...DEFAULT_QUERY_GUARDS,
        maxSelect: 2,
      }).code,
      'tooManyFields',
    );
  });

  it('dies as a clean 400 when the tree nests past the parser depth cap', () => {
    const open = '{boss:{populate:[';
    const bomb = `populate=[{author:{populate:[${open.repeat(11)}boss${']}}'.repeat(11)}]}}]`;
    const generous = { ...DEFAULT_QUERY_GUARDS, maxPopulate: 1000, maxPopulateDepth: 1000 };
    const error = failure(bomb, generous);
    strictEqual(error.code, 'invalidShape');
    ok(error.path.endsWith('.boss'));
  });
});

describe('parseQueryParams refuses a hidden field exactly as an unknown one', () => {
  it('still reads the readable siblings', () => {
    const parsed = parseHidden('select=[email]&populate=[profile]');
    deepStrictEqual(parsed.select, ['email']);
    deepStrictEqual(parsed.populate, ['profile']);
  });

  it('rejects a hidden field in select at its index', () => {
    deepStrictEqual(hiddenFailure('select=[email,password]'), {
      code: 'invalidField',
      path: 'select[1]',
    });
  });

  it('rejects ordering by a hidden field', () => {
    deepStrictEqual(hiddenFailure('order=[-password]'), {
      code: 'invalidField',
      path: 'order[0]',
    });
  });

  it('rejects a where over a hidden field', () => {
    deepStrictEqual(hiddenFailure('where={password:x}'), {
      code: 'invalidField',
      path: 'where.password',
    });
  });

  it('locates a hidden target field inside a has by its dotted path', () => {
    deepStrictEqual(hiddenFailure('where={profile:{has:{secret:x}}}'), {
      code: 'invalidField',
      path: 'where.profile.secret',
    });
  });

  it('rejects a hidden subfield inside a block scope', () => {
    deepStrictEqual(hiddenFailure('where={vault:{has:{block:WVault,token:x}}}'), {
      code: 'invalidField',
      path: 'where.vault.token',
    });
  });

  it('rejects populating a hidden relation, bare or spec', () => {
    deepStrictEqual(hiddenFailure('populate=[audit]'), {
      code: 'invalidField',
      path: 'populate[0]',
    });
    deepStrictEqual(hiddenFailure('populate=[{audit:{select:[bio]}}]'), {
      code: 'invalidField',
      path: 'populate[0].audit',
    });
  });

  it('rejects a subselect naming a hidden target field', () => {
    deepStrictEqual(hiddenFailure('populate=[{profile:{select:[bio,secret]}}]'), {
      code: 'invalidField',
      path: 'populate[0].profile.select[1]',
    });
  });
});

describe('didYouMean never names a hidden field', () => {
  it('a near miss of the hidden name gets no suggestion', () => {
    const select = caught(() => parseHidden('select=[passwor]'));
    strictEqual(select.message, 'query.invalidField');
    deepStrictEqual(select.data, { code: 'invalidField', path: 'select[0]' });
    const where = caught(() => parseHidden('where={passwor:x}'));
    strictEqual(where.message, 'query.invalidField');
    deepStrictEqual(where.data, { code: 'invalidField', path: 'where.passwor' });
  });

  it('a subselect near miss gets no suggestion either', () => {
    const error = caught(() => parseHidden('populate=[{profile:{select:[secre]}}]'));
    strictEqual(error.message, 'query.invalidField');
    deepStrictEqual(error.data, { code: 'invalidField', path: 'populate[0].profile.select[0]' });
  });

  it('a near miss of a readable field still suggests it', () => {
    const error = caught(() => parseHidden('where={emial:x}'));
    strictEqual(error.message, 'query.invalidFieldSuggestion');
    deepStrictEqual(error.data, { code: 'invalidField', path: 'where.emial' });
  });
});

describe('parseQueryParams reads the locale param', () => {
  it('leaves an absent locale null', () => {
    strictEqual(parseLocalized('').locale, null);
    strictEqual(parseLocalized('where={title:x}').locale, null);
  });

  it('stores a configured locale as parsed', () => {
    strictEqual(parseLocalized('locale=de').locale, 'de');
  });

  it('canonicalizes the tag before the membership check', () => {
    strictEqual(parseLocalized('locale=de-at').locale, 'de-AT');
  });

  it('rejects a locale outside the configured set', () => {
    deepStrictEqual(localizedFailure('locale=fr'), { code: 'invalidLocale', path: 'locale' });
  });

  it('rejects a non-string locale value', () => {
    deepStrictEqual(localizedFailure('locale=true'), { code: 'invalidLocale', path: 'locale' });
  });

  it('rejects a locale on a non-translatable collection, the param itself known', () => {
    deepStrictEqual(failure('locale=de'), { code: 'localeNotApplicable', path: 'locale' });
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

  it('counts a blocks has toward the has-depth ceiling', () => {
    const shallow: QueryGuards = { ...DEFAULT_QUERY_GUARDS, maxHasDepth: 1 };
    deepStrictEqual(parse('where={content:{has:{block:WHero}}}', shallow).where, {
      content: { has: { block: 'WHero' } },
    });
    strictEqual(
      failure('where={content:{has:{block:WHero,parts:{has:{block:WQuote}}}}}', shallow).code,
      'hasTooDeep',
    );
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

  it('measures a text pattern as it folds, and a `like` pattern as written', () => {
    const roomy: QueryGuards = { ...DEFAULT_QUERY_GUARDS, maxPatternBytes: 6 };
    strictEqual(failure('where={title:{contains:%EF%B7%BA}}', roomy).code, 'patternTooLarge');
    deepStrictEqual(parse('where={title:{like:ab}}', roomy).where, { title: { like: 'ab' } });
  });

  it('counts the worst-case locale binds toward the bound-param ceiling', () => {
    const capped: QueryGuards = { ...DEFAULT_QUERY_GUARDS, maxBoundParams: 4 };
    deepStrictEqual(parse('where={views:{in:[1,2]}}', capped).where, { views: { in: [1, 2] } });
    strictEqual(failure('where={views:{in:[1,2,3]}}', capped).code, 'tooManyBoundParams');
    strictEqual(failure('where={author:{has:{name:x}}}', capped).code, 'tooManyBoundParams');
    deepStrictEqual(parse('where={tags:{includes:t1}}', capped).where, {
      tags: { includes: 't1' },
    });
    strictEqual(failure('where={tags:{includesAny:[t1,t2]}}', capped).code, 'tooManyBoundParams');
  });

  it('reserves the filled limit bind from the bound-param ceiling', () => {
    const where = 'where={views:{in:[1,2]}}';
    strictEqual(
      failure(where, { ...DEFAULT_QUERY_GUARDS, maxBoundParams: 3 }).code,
      'tooManyBoundParams',
    );
    deepStrictEqual(parse(where, { ...DEFAULT_QUERY_GUARDS, maxBoundParams: 4 }).where, {
      views: { in: [1, 2] },
    });
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
    [
      'populate=[{author:{select:[name],populate:[boss]}}]',
      { populate: [{ author: { select: ['name'], populate: ['boss'] } }] },
    ],
    [
      'populate=[{author:{select:name,populate:boss}}]',
      { populate: [{ author: { select: ['name'], populate: ['boss'] } }] },
    ],
    [
      'where={content:{has:{block:WHero,title:{contains:x}}}}',
      { where: { content: { has: { block: 'WHero', title: { contains: 'x' } } } } },
    ],
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

describe('`_translations` over the wire', () => {
  it('is selectable', () => {
    deepStrictEqual(parseLocalized('select=[_translations]').select, ['_translations']);
  });

  it('cannot order or populate', () => {
    deepStrictEqual(localizedFailure('order=[_translations]'), {
      code: 'invalidField',
      path: 'order[0]',
    });
    deepStrictEqual(localizedFailure('populate=[_translations]'), {
      code: 'invalidField',
      path: 'populate[0]',
    });
  });

  it('filters by list membership alone', () => {
    deepStrictEqual(parseLocalized('where={_translations:{includes:de}}').where, {
      _translations: { includes: 'de' },
    });
    deepStrictEqual(parseLocalized('where={_translations:{not:{includesAll:[en,de-AT]}}}').where, {
      _translations: { not: { includesAll: ['en', 'de-AT'] } },
    });
    strictEqual(localizedFailure('where={_translations:en}').code, 'invalidField');
    strictEqual(localizedFailure('where={_translations:{empty:true}}').code, 'invalidField');
  });

  it('refuses a locale the configuration does not name', () => {
    deepStrictEqual(localizedFailure('where={_translations:{includes:fr}}'), {
      code: 'invalidValue',
      path: 'where._translations',
    });
    strictEqual(
      localizedFailure('where={_translations:{includesAny:[de,7]}}').code,
      'invalidValue',
    );
  });

  it('refuses a filter under a scope whose `where` reads per locale', () => {
    const sealed = scopedMetadata(translatableMeta, { where: { title: 'Hello' } });
    const error = caught(() =>
      parseQueryParams(
        parseSearchParams('where={_translations:{includes:de}}'),
        sealed,
        DEFAULT_QUERY_GUARDS,
      ),
    );
    strictEqual((error.data as WireErrorData).code, 'invalidField');
    deepStrictEqual(
      parseQueryParams(parseSearchParams('select=[_translations]'), sealed, DEFAULT_QUERY_GUARDS)
        .select,
      ['_translations'],
    );
  });

  it('keeps the filter under a scope whose `where` reads alike at every locale', () => {
    const open = scopedMetadata(translatableMeta, { where: { _translations: { includes: 'en' } } });
    strictEqual(open, translatableMeta);
  });
});
