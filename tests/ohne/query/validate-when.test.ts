import { match, ok, throws } from 'node:assert';
import { describe, it } from 'node:test';

import { useCollections } from '../../../src/ohne/collections/use-collections.ts';
import { isOhneError } from '../../../src/ohne/error/ohne-error.ts';
import { integer } from '../../../src/ohne/fields/builtin/integer.ts';
import { record } from '../../../src/ohne/fields/builtin/record.ts';
import { repeater } from '../../../src/ohne/fields/builtin/repeater.ts';
import { text } from '../../../src/ohne/fields/builtin/text.ts';
import { field } from '../../../src/ohne/fields/field.ts';
import { queryMetadata } from '../../../src/ohne/query/metadata.ts';

void integer;
void record;
void repeater;
void text;

useCollections().register('WHUser', {
  name: 'WHUser',
  collection: { fields: { name: field('text') } },
});

useCollections().register('WHFlag', {
  name: 'WHFlag',
  collection: {
    fields: {
      status: field('text'),
      discount: field('integer', { nullable: true, when: { status: 'active' } }),
    },
  },
});

useCollections().register('WHHasTrue', {
  name: 'WHHasTrue',
  collection: {
    fields: {
      author: field('record', { collection: 'WHUser' }),
      discount: field('integer', { nullable: true, when: { author: { has: true } } }),
    },
  },
});

useCollections().register('WHComposite', {
  name: 'WHComposite',
  collection: {
    fields: {
      kind: field('text'),
      title: field('text'),
      sections: field('repeater', {
        fields: {
          heading: field('text'),
          note: field('text', { nullable: true, when: { '../kind': 'special', '/title': 'x' } }),
        },
      }),
    },
  },
});

useCollections().register('WHNoDefault', {
  name: 'WHNoDefault',
  collection: {
    fields: {
      status: field('text'),
      discount: field('integer', { when: { status: 'active' } }),
    },
  },
});

useCollections().register('WHUnknown', {
  name: 'WHUnknown',
  collection: {
    fields: {
      status: field('text'),
      discount: field('integer', { nullable: true, when: { ghost: 'x' } }),
    },
  },
});

useCollections().register('WHBadOp', {
  name: 'WHBadOp',
  collection: {
    fields: {
      count: field('integer'),
      discount: field('integer', { nullable: true, when: { count: { contains: 'x' } } }),
    },
  },
});

useCollections().register('WHUnderflow', {
  name: 'WHUnderflow',
  collection: {
    fields: {
      status: field('text'),
      discount: field('integer', { nullable: true, when: { '../status': 'x' } }),
    },
  },
});

useCollections().register('WHHasRel', {
  name: 'WHHasRel',
  collection: {
    fields: {
      author: field('record', { collection: 'WHUser' }),
      discount: field('integer', { nullable: true, when: { author: { has: { name: 'x' } } } }),
    },
  },
});

useCollections().register('WHIsNull', {
  name: 'WHIsNull',
  collection: {
    fields: {
      status: field('text', { nullable: true }),
      discount: field('integer', { nullable: true, when: { status: { isNull: false } } }),
    },
  },
});

useCollections().register('WHEmptyAnchor', {
  name: 'WHEmptyAnchor',
  collection: {
    fields: {
      status: field('text'),
      discount: field('integer', { nullable: true, when: { '/': 'x' } }),
    },
  },
});

function throwsOhne(run: () => unknown, pattern: RegExp): void {
  throws(run, (error: unknown) => {
    ok(isOhneError(error));
    match(error.message, pattern);
    return true;
  });
}

describe('validateWhen', () => {
  it('accepts a sibling gate and stores the parsed node', () => {
    ok(queryMetadata('WHFlag').fields.discount.when);
  });

  it('accepts a bare `has: true` over a relation', () => {
    ok(queryMetadata('WHHasTrue').fields.discount.when);
  });

  it('accepts a composite path that climbs and anchors', () => {
    const note = queryMetadata('WHComposite').fields.sections.subfields?.note;
    ok(note?.when);
  });

  it('rejects a gated field that is neither nullable nor defaulted', () => {
    throwsOhne(() => queryMetadata('WHNoDefault'), /must be nullable or have a default/);
  });

  it('rejects a path that addresses no field', () => {
    throwsOhne(() => queryMetadata('WHUnknown'), /Unknown `when` path `ghost`/);
  });

  it('rejects an operator the field does not support', () => {
    throwsOhne(() => queryMetadata('WHBadOp'), /Operator `contains` does not apply/);
  });

  it('rejects a `../` that climbs past the record root', () => {
    throwsOhne(() => queryMetadata('WHUnderflow'), /Unknown `when` path `\.\.\/status`/);
  });

  it('rejects a nested condition on a relation `has`', () => {
    throwsOhne(() => queryMetadata('WHHasRel'), /must be bare `true`/);
  });

  it('rejects `isNull: false` at parse time', () => {
    throwsOhne(() => queryMetadata('WHIsNull'), /Invalid `when` condition/);
  });

  it('rejects an empty body after an anchor', () => {
    throwsOhne(() => queryMetadata('WHEmptyAnchor'), /Invalid `when` condition/);
  });
});
