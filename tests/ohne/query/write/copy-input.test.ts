import { deepStrictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { FieldQueryMeta } from '../../../../src/ohne/query/metadata.ts';

import { useFields } from '../../../../src/ohne/fields/use-fields.ts';
import { copyInput, type CopyInputOptions } from '../../../../src/ohne/query/write/copy-input.ts';

const TEXT = useFields().get('text')!.fieldType;
const INTEGER = useFields().get('integer')!.fieldType;
const REPEATER = useFields().get('repeater')!.fieldType;
const RICH_TEXT = useFields().get('richText')!.fieldType;
const SECRET = { ...TEXT, copy: false as const };

const LINK_FIELDS: Record<string, FieldQueryMeta> = {
  UUID: { kind: 'column', nullable: false, logicalType: 'text', column: 'UUID', id: true },
  url: { kind: 'column', nullable: false, logicalType: 'text', column: 'url', fieldType: TEXT },
};

const SECTION_FIELDS: Record<string, FieldQueryMeta> = {
  UUID: { kind: 'column', nullable: false, logicalType: 'text', column: 'UUID', id: true },
  heading: {
    kind: 'column',
    nullable: false,
    logicalType: 'text',
    column: 'heading',
    fieldType: TEXT,
  },
  stamp: {
    kind: 'column',
    nullable: true,
    logicalType: 'integer',
    column: 'stamp',
    fieldType: INTEGER,
    writable: false,
  },
  ref: {
    kind: 'column',
    nullable: true,
    logicalType: 'text',
    column: 'ref',
    fieldType: TEXT,
    immutable: true,
  },
  pin: {
    kind: 'column',
    nullable: true,
    logicalType: 'text',
    column: 'pin',
    fieldType: SECRET,
  },
  links: {
    kind: 'childMany',
    nullable: false,
    table: 'X__sections__links',
    fieldType: REPEATER,
    subfields: LINK_FIELDS,
  },
};

const FIELDS: Record<string, FieldQueryMeta> = {
  UUID: { kind: 'column', nullable: false, logicalType: 'text', column: 'UUID', id: true },
  _updatedAt: { kind: 'column', nullable: false, logicalType: 'integer', column: '_updatedAt' },
  title: {
    kind: 'column',
    nullable: false,
    logicalType: 'text',
    column: 'title',
    companion: true,
    fieldType: TEXT,
  },
  summary: {
    kind: 'column',
    nullable: true,
    logicalType: 'text',
    column: 'summary',
    companion: true,
    fieldType: TEXT,
  },
  shared: {
    kind: 'column',
    nullable: false,
    logicalType: 'text',
    column: 'shared',
    fieldType: TEXT,
  },
  body: {
    kind: 'column',
    nullable: true,
    logicalType: 'json',
    column: 'body',
    companion: true,
    fieldType: RICH_TEXT,
  },
  token: {
    kind: 'column',
    nullable: false,
    logicalType: 'text',
    column: 'token',
    companion: true,
    fieldType: TEXT,
    writable: false,
  },
  slug: {
    kind: 'column',
    nullable: false,
    logicalType: 'text',
    column: 'slug',
    companion: true,
    fieldType: TEXT,
    immutable: true,
  },
  handle: {
    kind: 'column',
    nullable: false,
    logicalType: 'text',
    column: 'handle',
    companion: true,
    fieldType: TEXT,
    options: { unique: true, uniquePerLocale: true },
  },
  email: {
    kind: 'column',
    nullable: false,
    logicalType: 'text',
    column: 'email',
    fieldType: TEXT,
    options: { unique: true },
  },
  password: {
    kind: 'column',
    nullable: false,
    logicalType: 'text',
    column: 'password',
    fieldType: SECRET,
  },
  hidden: {
    kind: 'column',
    nullable: true,
    logicalType: 'text',
    column: 'hidden',
    fieldType: TEXT,
    readable: false,
  },
  sections: {
    kind: 'childMany',
    nullable: false,
    table: 'X__sections',
    localeScoped: true,
    fieldType: REPEATER,
    subfields: SECTION_FIELDS,
  },
  mentions: {
    kind: 'records',
    nullable: false,
    target: 'Y',
    table: 'Y__refs',
    localeScoped: true,
    fieldType: INTEGER,
    inverse: true,
  },
};

const TRANSLATION: CopyInputOptions = {
  only: 'translatable',
  uniques: 'keep',
  operation: 'update',
  values: 'read',
};
const DUPLICATE: CopyInputOptions = {
  only: 'all',
  uniques: 'drop',
  operation: 'create',
  values: 'read',
};

const RECORD = {
  UUID: 'r1',
  _updatedAt: 1,
  _translations: ['en'],
  title: 'Hello',
  shared: 'common',
  token: 'secret',
  slug: 'hello',
  handle: 'hello',
  email: 'a@b.c',
  password: 'scrypt$hash',
  hidden: 'x',
  sections: [],
  mentions: ['y1'],
};

describe('copyInput', () => {
  it('carries translatable writable mutable fields for a translation copy', () => {
    deepStrictEqual(copyInput(FIELDS, RECORD, TRANSLATION), {
      title: 'Hello',
      handle: 'hello',
      sections: [],
    });
  });

  it('carries every settable field for a duplicate, `immutable` kept and uniques dropped', () => {
    deepStrictEqual(copyInput(FIELDS, RECORD, DUPLICATE), {
      title: 'Hello',
      shared: 'common',
      slug: 'hello',
      sections: [],
    });
  });

  it('keeps uniques when asked', () => {
    deepStrictEqual(copyInput(FIELDS, RECORD, { ...DUPLICATE, uniques: 'keep' }), {
      title: 'Hello',
      shared: 'common',
      slug: 'hello',
      handle: 'hello',
      email: 'a@b.c',
      sections: [],
    });
  });

  it('carries only the shared fields', () => {
    deepStrictEqual(copyInput(FIELDS, RECORD, { ...DUPLICATE, only: 'shared' }), {
      shared: 'common',
    });
  });

  it('never carries a `copy: false` type, a `readable: false` field, or a system entry', () => {
    const input = copyInput(FIELDS, RECORD, { ...DUPLICATE, uniques: 'keep' });
    for (const name of ['password', 'hidden', 'UUID', '_updatedAt', '_translations', 'token']) {
      deepStrictEqual(name in input, false, name);
    }
  });

  it('skips a field the record does not carry and passes `null` through', () => {
    const input = copyInput(FIELDS, { title: 'Hello', summary: null }, TRANSLATION);
    deepStrictEqual(input, { title: 'Hello', summary: null });
  });

  it('sheds item identity at every depth', () => {
    const input = copyInput(
      FIELDS,
      {
        sections: [
          { UUID: 's1', heading: 'One', links: [{ UUID: 'l1', url: '/a' }] },
          { UUID: 's2', heading: 'Two', links: [] },
        ],
      },
      TRANSLATION,
    );
    deepStrictEqual(input, {
      sections: [
        { heading: 'One', links: [{ url: '/a' }] },
        { heading: 'Two', links: [] },
      ],
    });
  });

  it('keeps the `record` key of a link while shedding `UUID` keys', () => {
    const body = [
      {
        kind: 'paragraph',
        content: [{ text: 'a', link: { collection: 'Y', record: 'y1' } }],
      },
    ];
    const input = copyInput(
      FIELDS,
      { body, sections: [{ UUID: 's1', heading: 'One' }] },
      TRANSLATION,
    );
    deepStrictEqual(input, { body, sections: [{ heading: 'One' }] });
  });

  it('strips the keys the wire denies inside composite items', () => {
    const input = copyInput(
      FIELDS,
      { sections: [{ UUID: 's1', heading: 'One', stamp: 7, ghost: true, links: [] }] },
      TRANSLATION,
    );
    deepStrictEqual(input, { sections: [{ heading: 'One', links: [] }] });
  });

  it('drops `immutable` and `copy: false` subfields by the operation', () => {
    const record = { sections: [{ UUID: 's1', heading: 'One', ref: 'r', pin: 'p' }] };
    deepStrictEqual(copyInput(FIELDS, record, TRANSLATION), { sections: [{ heading: 'One' }] });
    deepStrictEqual(copyInput(FIELDS, record, DUPLICATE), {
      sections: [{ heading: 'One', ref: 'r' }],
    });
  });
});
