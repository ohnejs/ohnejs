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

  it('rejects the reserved `block` field name, any casing', () => {
    throws(() => defineBlock({ fields: { block: field('text') } }), /reserved/);
    throws(() => defineBlock({ fields: { bLock: field('text') } }), /reserved/);
  });

  it('accepts a dashboard layout unchanged', () => {
    const definition = {
      fields: { title: field('text'), subtitle: field('text') },
      dashboard: { layout: [{ row: ['title', 'subtitle'] }] as const },
    };
    deepStrictEqual(defineBlock(definition), definition);
  });

  it('rejects an unknown dashboard key', () => {
    throws(
      () =>
        defineBlock({
          fields: { title: field('text') },
          // @ts-expect-error `icon` is not a block dashboard key
          dashboard: { icon: 'note' },
        }),
      /Unknown `dashboard` key `icon`/,
    );
  });

  it('rejects a dashboard layout naming an unknown field', () => {
    throws(
      () =>
        defineBlock({
          fields: { title: field('text') },
          // @ts-expect-error `body` is not a field of this block
          dashboard: { layout: ['body'] },
        }),
      /`dashboard\.layout` references unknown field `body`/,
    );
  });

  it('rejects case-insensitively colliding field names', () => {
    throws(
      () => defineBlock({ fields: { subTitle: field('text'), subtitle: field('text') } }),
      /`subTitle` and `subtitle` collide/,
    );
  });
});
