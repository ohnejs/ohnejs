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
          // @ts-expect-error `table` is not a block dashboard key
          dashboard: { table: {} },
        }),
      /Unknown `dashboard` key `table`/,
    );
  });

  it('accepts a description, an icon, and a title field unchanged', () => {
    const definition = {
      description: 'A big heading',
      fields: { heading: field('text') },
      dashboard: { icon: 'photo', titleField: 'heading' } as const,
    };
    deepStrictEqual(defineBlock(definition), definition);
  });

  it('accepts an icon picked by a field value', () => {
    const definition = {
      fields: { columns: field('text') },
      dashboard: {
        icon: { field: 'columns', map: { '2': 'columns-2', '3': 'columns-3' }, default: 'columns' },
      } as const,
    };
    deepStrictEqual(defineBlock(definition), definition);
  });

  it('rejects an icon the set does not carry', () => {
    throws(
      () =>
        defineBlock({
          fields: { title: field('text') },
          // @ts-expect-error `phot` is not an icon name
          dashboard: { icon: 'phot' },
        }),
      /Unknown icon `phot`/,
    );
  });

  it('rejects an icon map over an unknown field', () => {
    throws(
      () =>
        defineBlock({
          fields: { columns: field('text') },
          // @ts-expect-error `cols` is not a field of this block
          dashboard: { icon: { field: 'cols', map: {} } },
        }),
      /Invalid `dashboard\.icon\.field` declaration/,
    );
  });

  it('rejects an icon map with an unknown icon', () => {
    throws(
      () =>
        defineBlock({
          fields: { columns: field('text') },
          // @ts-expect-error `nope` is not an icon name
          dashboard: { icon: { field: 'columns', map: { '2': 'nope' } } },
        }),
      /Unknown icon `nope`/,
    );
  });

  it('rejects a title field the block does not declare', () => {
    throws(
      () =>
        defineBlock({
          fields: { heading: field('text') },
          // @ts-expect-error `title` is not a field of this block
          dashboard: { titleField: 'title' },
        }),
      /Invalid `dashboard\.titleField` declaration/,
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
