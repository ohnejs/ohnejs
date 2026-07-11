import { deepStrictEqual, throws } from 'node:assert';
import { describe, it } from 'node:test';

import { defineBlock } from '../../../src/ohne/blocks/define-block.ts';
import { field } from '../../../src/ohne/fields/field.ts';

describe('defineBlock', () => {
  it('returns a valid definition unchanged', () => {
    const definition = { fields: { title: field('text') } };
    deepStrictEqual(defineBlock(definition), definition);
  });

  it('accepts a fieldless definition', () => {
    const definition = { fields: {} };
    deepStrictEqual(defineBlock(definition), definition);
  });

  it('rejects a non-camelCase field name', () => {
    throws(() => defineBlock({ fields: { created_at: field('text') } }), /camelCase/);
  });

  it('rejects the reserved `uuid` field name', () => {
    throws(() => defineBlock({ fields: { uuid: field('text') } }), /reserved/);
  });

  it('rejects case-insensitively colliding field names', () => {
    throws(
      () => defineBlock({ fields: { subTitle: field('text'), subtitle: field('text') } }),
      /`subTitle` and `subtitle` collide/,
    );
  });
});
