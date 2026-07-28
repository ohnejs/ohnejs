import { deepStrictEqual, doesNotThrow, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { FieldErrors } from '../../../../src/ohne/query/write/errors.ts';

import { useBlocks } from '../../../../src/ohne/blocks/use-blocks.ts';
import { useCollections } from '../../../../src/ohne/collections/use-collections.ts';
import { field } from '../../../../src/ohne/fields/field.ts';
import { queryMetadata } from '../../../../src/ohne/query/metadata.ts';
import { checkWriteInput } from '../../../../src/ohne/query/wire/write-input.ts';
import { isValidationError } from '../../../../src/ohne/query/write/errors.ts';

useBlocks().register('WIHero', {
  name: 'WIHero',
  block: {
    fields: {
      title: field('text'),
      badge: field('text', { writable: false, default: 'new' }),
    },
  },
});
useBlocks().register('WIQuote', {
  name: 'WIQuote',
  block: { fields: { words: field('text', { writable: false, default: 'w' }) } },
});

useCollections().register('WIPosts', {
  name: 'WIPosts',
  collection: {
    fields: {
      title: field('text'),
      token: field('text', { writable: false, default: 'sealed' }),
      slug: field('text', { immutable: true }),
      meta: field('object', {
        fields: {
          description: field('text'),
          secretCode: field('text', { writable: false, default: 'x' }),
        },
      }),
      sections: field('repeater', {
        fields: {
          heading: field('text'),
          stamp: field('text', { writable: false, default: 's' }),
        },
      }),
      content: field('blocks', { allow: ['WIHero'] }),
    },
  },
});

const fields = queryMetadata('WIPosts').fields;

function erring(input: Record<string, unknown>, operation: 'create' | 'update'): FieldErrors {
  let caught: unknown;
  try {
    checkWriteInput(input, fields, operation);
  } catch (error) {
    caught = error;
  }
  if (!isValidationError(caught)) throw new Error('expected a ValidationError');
  return caught.errors;
}

describe('checkWriteInput', () => {
  it('passes a clean input on create and update', () => {
    const input = {
      title: 'One',
      meta: { description: 'd' },
      sections: [{ heading: 'h' }],
      content: [{ block: 'WIHero', fields: { title: 't' } }],
    };
    doesNotThrow(() => checkWriteInput(input, fields, 'create'));
    doesNotThrow(() => checkWriteInput(input, fields, 'update'));
  });

  it('denies a `writable: false` key on create and update', () => {
    deepStrictEqual(erring({ token: 'x' }, 'create'), { token: 'validation.unknownField' });
    deepStrictEqual(erring({ token: 'x' }, 'update'), { token: 'validation.unknownField' });
  });

  it('denies an `immutable` key on update only', () => {
    doesNotThrow(() => checkWriteInput({ slug: 'one' }, fields, 'create'));
    deepStrictEqual(erring({ slug: 'one' }, 'update'), { slug: 'validation.unknownField' });
  });

  it('errors a childOne subfield at `a.b`', () => {
    deepStrictEqual(erring({ meta: { description: 'd', secretCode: 'x' } }, 'create'), {
      'meta.secretCode': 'validation.unknownField',
    });
  });

  it('errors a childMany subfield at its item index', () => {
    deepStrictEqual(erring({ sections: [{ heading: 'h' }, { stamp: 'x' }] }, 'create'), {
      'sections[1].stamp': 'validation.unknownField',
    });
  });

  it('errors a block subfield at `a[0].fields.b`', () => {
    deepStrictEqual(erring({ content: [{ block: 'WIHero', fields: { badge: 'x' } }] }, 'create'), {
      'content[0].fields.badge': 'validation.unknownField',
    });
  });

  it('collects every denied path into one throw', () => {
    const input = {
      token: 'x',
      slug: 'x',
      meta: { secretCode: 'x' },
      sections: [{ stamp: 'x' }],
      content: [{ block: 'WIHero', fields: { badge: 'x' } }],
    };
    deepStrictEqual(erring(input, 'update'), {
      token: 'validation.unknownField',
      slug: 'validation.unknownField',
      'meta.secretCode': 'validation.unknownField',
      'sections[0].stamp': 'validation.unknownField',
      'content[0].fields.badge': 'validation.unknownField',
    });
  });

  it('collects unknown keys at every scope, one shape with the denied ones', () => {
    const input = {
      ghost: 1,
      meta: { phantom: 2 },
      sections: [{ shade: 3 }],
      content: [{ block: 'WIHero', fields: { wisp: 4 } }],
    };
    const expected = {
      ghost: 'validation.unknownField',
      'meta.phantom': 'validation.unknownField',
      'sections[0].shade': 'validation.unknownField',
      'content[0].fields.wisp': 'validation.unknownField',
    };
    deepStrictEqual(erring(input, 'create'), expected);
    deepStrictEqual(erring(input, 'update'), expected);
  });

  it('takes an item `UUID` on update alone, everywhere else a system key is unknown', () => {
    deepStrictEqual(erring({ UUID: 'u' }, 'update'), { UUID: 'validation.unknownField' });
    doesNotThrow(() => checkWriteInput({ sections: [{ UUID: 'u' }] }, fields, 'update'));
    deepStrictEqual(erring({ sections: [{ UUID: 'u' }] }, 'create'), {
      'sections[0].UUID': 'validation.unknownField',
    });
    deepStrictEqual(erring({ meta: { UUID: 'u' } }, 'update'), {
      'meta.UUID': 'validation.unknownField',
    });
  });

  it('skips a composite value of the wrong shape', () => {
    doesNotThrow(() =>
      checkWriteInput({ meta: 'nope', sections: 'nope', content: 'nope' }, fields, 'update'),
    );
    doesNotThrow(() => checkWriteInput({ sections: ['nope', 42, null] }, fields, 'update'));
    doesNotThrow(() => checkWriteInput({ meta: [{ secretCode: 'x' }] }, fields, 'create'));
  });

  it('skips a block item that is not addressable', () => {
    const inputs = [
      { content: [{ fields: { badge: 'x' } }] },
      { content: [{ block: 42, fields: { badge: 'x' } }] },
      { content: [{ block: 'WIGhost', fields: { badge: 'x' } }] },
      { content: [{ block: 'WIQuote', fields: { words: 'x' } }] },
      { content: [{ block: 'WIHero', fields: 'nope' }] },
      { content: [{ block: 'WIHero' }] },
    ];
    for (const input of inputs) {
      doesNotThrow(() => checkWriteInput(input, fields, 'create'));
      doesNotThrow(() => checkWriteInput(input, fields, 'update'));
    }
  });

  it('throws a guarded `ValidationError`, a plain `Error` refused', () => {
    let caught: unknown;
    try {
      checkWriteInput({ token: 'x' }, fields, 'create');
    } catch (error) {
      caught = error;
    }
    strictEqual(isValidationError(caught), true);
    strictEqual(isValidationError(new Error('Validation failed: token')), false);
  });
});
