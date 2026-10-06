import { deepStrictEqual, doesNotReject, match, ok, rejects, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { Transaction } from '../../../../src/ohne/database/adapter.ts';
import type { RichTextParagraph, RichTextRun } from '../../../../src/utils/index.ts';

import { useCollections } from '../../../../src/ohne/collections/use-collections.ts';
import { isOhneError } from '../../../../src/ohne/error/ohne-error.ts';
import { richText } from '../../../../src/ohne/fields/builtin/rich-text.ts';
import { field } from '../../../../src/ohne/fields/field.ts';
import { queryMetadata } from '../../../../src/ohne/query/metadata.ts';
import { runRecord } from '../../../../src/ohne/query/pipeline/run-record.ts';
import { validateLiteralDefaults } from '../../../../src/ohne/query/validate-literal-defaults.ts';

type EmitCtx = Parameters<NonNullable<typeof richText.emitType>>[0];

const PAGE = '019f3c1a-8b2d-7f4e-9a6b-1c2d3e4f5a6b';
const tx = {} as Transaction;

useCollections().register('RTPage', {
  name: 'RTPage',
  collection: { fields: { name: field('text') } },
});
useCollections().register('RTPost', {
  name: 'RTPost',
  collection: {
    fields: {
      body: field('richText', { links: ['RTPage'] }),
      teaser: field('richText', { inline: true, nullable: true }),
      flat: field('richText', { lineBreaks: false, nullable: true }),
      blank: field('richText', { allowEmpty: true, nullable: true }),
      bounded: field('richText', { min: 2, max: 3, nullable: true }),
      locked: field('richText', { links: false, nullable: true }),
      ghosted: field('richText', { links: ['RTNope'], nullable: true }),
      narrow: field('richText', { elements: ['h2'], marks: ['strong'], nullable: true }),
    },
  },
});

function paragraph(...content: RichTextRun[]): RichTextParagraph {
  return { kind: 'paragraph', content };
}

const BODY = paragraph({ text: 'hello' });

async function create(input: Record<string, unknown>) {
  return runRecord(
    queryMetadata('RTPost'),
    { body: [BODY], ...input },
    { operation: 'create', tx },
  );
}

async function stored(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const result = await create(input);
  ok(result.ok, JSON.stringify(result));
  return result.scope.columns;
}

async function failed(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const result = await create(input);
  ok(!result.ok);
  return { ...result.errors };
}

describe('richText emitType', () => {
  const emitCtx = (options: Record<string, unknown>) =>
    ({ options, importType: (_path: string, name: string) => name }) as unknown as EmitCtx;

  it('emits the collection union of a `links` list', () => {
    strictEqual(
      richText.emitType!(emitCtx({ links: ['Pages', 'Posts'] })),
      "RichText<'Pages' | 'Posts'>",
    );
  });

  it('emits `never` without a collection list', () => {
    strictEqual(richText.emitType!(emitCtx({ links: true })), 'RichText<never>');
    strictEqual(richText.emitType!(emitCtx({ links: false })), 'RichText<never>');
  });
});

describe('richText through the write pipeline', () => {
  it('normalizes a well-shaped value', async () => {
    const columns = await stored({
      body: [paragraph({ text: 'a\r\n' }, { text: 'b', marks: ['em', 'em'] }), paragraph()],
    });
    deepStrictEqual(columns.body, [paragraph({ text: 'a\n' }, { text: 'b', marks: ['em'] })]);
  });

  it('drops `href`, trims a URL and strips the `#` of a hash', async () => {
    const columns = await stored({
      body: [
        paragraph(
          { text: 'a', link: { url: ' /a ', newTab: false, href: '/x' } },
          { text: 'b', link: { collection: 'RTPage', record: PAGE, hash: '#top', href: '/p' } },
        ),
      ],
    });
    deepStrictEqual(columns.body, [
      paragraph(
        { text: 'a', link: { url: '/a' } },
        { text: 'b', link: { collection: 'RTPage', record: PAGE, hash: 'top' } },
      ),
    ]);
  });

  it('reports a broken value at the field itself', async () => {
    deepStrictEqual(await failed({ body: 'text' }), { body: 'validation.invalidValue' });
  });

  it('reports a sub-path issue at its prefixed path', async () => {
    const errors = await failed({
      body: [
        { kind: 'heading', level: 4, content: [{ text: 'a' }] },
        paragraph({ text: 'b', link: { url: 'javascript:x' } }),
        paragraph({ text: 'c', marks: ['del'] }),
      ],
    });
    deepStrictEqual(errors, {
      'body[0].level': 'validation.invalidChoice',
      'body[1].content[0].link.url': 'validation.invalidLink',
      'body[2].content[0].marks[0]': 'validation.invalidChoice',
    });
  });

  it('carries the params of a depth issue', async () => {
    const item = (list?: unknown) => ({ content: [{ text: 'x' }], ...(list ? { list } : {}) });
    const list = (items: unknown[]) => ({ kind: 'list', ordered: false, items });
    const five = list([item(list([item(list([item(list([item(list([item()]))]))]))]))]);
    deepStrictEqual(await failed({ body: [five] }), {
      'body[0].items[0].list.items[0].list.items[0].list.items[0].list': {
        key: 'validation.maxDepth',
        params: { max: 4 },
      },
    });
  });

  it('refuses every link under `links: false`', async () => {
    deepStrictEqual(await failed({ locked: [paragraph({ text: 'a', link: { url: '/a' } })] }), {
      'locked[0].content[0].link': 'validation.linksNotAllowed',
    });
  });

  it('refuses a record link into a collection the field omits', async () => {
    deepStrictEqual(
      await failed({
        body: [paragraph({ text: 'a', link: { collection: 'RTPost', record: PAGE } })],
      }),
      { 'body[0].content[0].link.collection': 'validation.invalidChoice' },
    );
  });

  it('refuses a record link into a listed collection that is not registered', async () => {
    deepStrictEqual(
      await failed({
        ghosted: [paragraph({ text: 'a', link: { collection: 'RTNope', record: PAGE } })],
      }),
      { 'ghosted[0].content[0].link.collection': 'validation.invalidChoice' },
    );
  });

  it('narrows the elements and marks to the options', async () => {
    const errors = await failed({
      narrow: [
        { kind: 'heading', level: 2, content: [{ text: 'a', marks: ['strong'] }] },
        { kind: 'heading', level: 3, content: [{ text: 'b', marks: ['em'] }] },
        { kind: 'list', ordered: false, items: [{ content: [{ text: 'c' }] }] },
      ],
    });
    deepStrictEqual(errors, {
      'narrow[1].level': 'validation.invalidChoice',
      'narrow[1].content[0].marks[0]': 'validation.invalidChoice',
      'narrow[2].kind': 'validation.invalidChoice',
    });
  });

  it('holds a single paragraph under `inline`', async () => {
    deepStrictEqual((await stored({ teaser: [paragraph({ text: 'a' })] })).teaser, [
      paragraph({ text: 'a' }),
    ]);
    deepStrictEqual(
      await failed({ teaser: [paragraph({ text: 'a' }), paragraph({ text: 'b' })] }),
      {
        'teaser[1]': 'validation.singleParagraph',
      },
    );
    deepStrictEqual(
      await failed({ teaser: [{ kind: 'heading', level: 2, content: [{ text: 'a' }] }] }),
      { 'teaser[0].kind': 'validation.invalidChoice' },
    );
  });

  it('turns each line break into a space under `lineBreaks: false`', async () => {
    deepStrictEqual((await stored({ flat: [paragraph({ text: 'a\nb\r\nc' })] })).flat, [
      paragraph({ text: 'a b c' }),
    ]);
  });

  it('rejects an empty value unless `allowEmpty` is set', async () => {
    deepStrictEqual(await failed({ body: [] }), { body: 'validation.emptyValue' });
    deepStrictEqual(await failed({ body: [paragraph()] }), { body: 'validation.emptyValue' });
    deepStrictEqual((await stored({ blank: [] })).blank, []);
  });

  it('counts `min` and `max` over the run text after NFC', async () => {
    deepStrictEqual(await failed({ bounded: [paragraph({ text: 'é' })] }), {
      bounded: { key: 'validation.minLength', params: { min: 2 } },
    });
    deepStrictEqual((await stored({ bounded: [paragraph({ text: 'éé' })] })).bounded, [
      paragraph({ text: 'éé' }),
    ]);
    deepStrictEqual(
      await failed({ bounded: [paragraph({ text: 'ab' }), paragraph({ text: 'cd' })] }),
      {
        bounded: { key: 'validation.maxLength', params: { max: 3 } },
      },
    );
  });

  it('lists the record links of a value, URL links aside', async () => {
    const value = [
      paragraph(
        { text: 'a', link: { url: '/a' } },
        { text: 'b', link: { collection: 'RTPage', record: PAGE } },
      ),
    ];
    deepStrictEqual(richText.links!(value), [
      { path: '[0].content[1].link', link: { collection: 'RTPage', record: PAGE } },
    ]);
    deepStrictEqual(richText.links!('broken'), []);
  });
});

describe('richText literal default', () => {
  async function checkCollection(name: string, fields: Record<string, unknown>): Promise<void> {
    useCollections().register(name, { name, collection: { fields } } as never);
    try {
      await validateLiteralDefaults(tx);
    } finally {
      useCollections().delete(name);
    }
  }

  it('refuses `default: []` without `allowEmpty` at boot', async () => {
    await rejects(
      checkCollection('RTDefault', { body: field('richText', { default: [] }) }),
      (error: unknown) => {
        ok(isOhneError(error));
        strictEqual(error.title, 'Field `body` defaults to a value it rejects');
        match([error.body].flat().join('\n'), /validation\.emptyValue/);
        return true;
      },
    );
  });

  it('accepts `default: []` under `allowEmpty`', async () => {
    await doesNotReject(
      checkCollection('RTAllowed', { body: field('richText', { default: [], allowEmpty: true }) }),
    );
  });
});
