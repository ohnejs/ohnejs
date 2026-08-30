import { deepStrictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { FieldQueryMeta } from '../../../../src/ohne/query/metadata.ts';

import { useFields } from '../../../../src/ohne/fields/use-fields.ts';
import { copyTranslationInput } from '../../../../src/ohne/query/write/copy-translation.ts';

const TEXT = useFields().get('text')!.fieldType;
const INTEGER = useFields().get('integer')!.fieldType;
const REPEATER = useFields().get('repeater')!.fieldType;

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
  title: { kind: 'column', nullable: false, logicalType: 'text', column: 'title', companion: true },
  summary: {
    kind: 'column',
    nullable: true,
    logicalType: 'text',
    column: 'summary',
    companion: true,
  },
  shared: { kind: 'column', nullable: false, logicalType: 'text', column: 'shared' },
  token: {
    kind: 'column',
    nullable: false,
    logicalType: 'text',
    column: 'token',
    companion: true,
    writable: false,
  },
  slug: {
    kind: 'column',
    nullable: false,
    logicalType: 'text',
    column: 'slug',
    companion: true,
    immutable: true,
  },
  sections: {
    kind: 'childMany',
    nullable: false,
    table: 'X__sections',
    localeScoped: true,
    subfields: SECTION_FIELDS,
  },
  mentions: {
    kind: 'records',
    nullable: false,
    target: 'Y',
    table: 'Y__refs',
    localeScoped: true,
    inverse: true,
  },
};

describe('copyTranslationInput', () => {
  it('carries translatable writable mutable fields and drops the rest', () => {
    const input = copyTranslationInput(FIELDS, {
      UUID: 'r1',
      _updatedAt: 1,
      title: 'Hello',
      shared: 'common',
      token: 'secret',
      slug: 'hello',
      sections: [],
      mentions: ['y1'],
    });
    deepStrictEqual(input, { title: 'Hello', sections: [] });
  });

  it('skips a field the record does not carry and passes `null` through', () => {
    const input = copyTranslationInput(FIELDS, { title: 'Hello', summary: null });
    deepStrictEqual(input, { title: 'Hello', summary: null });
  });

  it('sheds item identity at every depth', () => {
    const input = copyTranslationInput(FIELDS, {
      sections: [
        { UUID: 's1', heading: 'One', links: [{ UUID: 'l1', url: '/a' }] },
        { UUID: 's2', heading: 'Two', links: [] },
      ],
    });
    deepStrictEqual(input, {
      sections: [
        { heading: 'One', links: [{ url: '/a' }] },
        { heading: 'Two', links: [] },
      ],
    });
  });

  it('strips the keys the wire denies inside composite items', () => {
    const input = copyTranslationInput(FIELDS, {
      sections: [{ UUID: 's1', heading: 'One', stamp: 7, ghost: true, links: [] }],
    });
    deepStrictEqual(input, { sections: [{ heading: 'One', links: [] }] });
  });
});
