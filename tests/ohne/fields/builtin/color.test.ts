import { deepStrictEqual, rejects, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { useCollections } from '../../../../src/ohne/collections/use-collections.ts';
import { SQLiteDialect } from '../../../../src/ohne/database/dialects/sqlite/dialect.ts';
import { buildDesiredSchema } from '../../../../src/ohne/database/schema/desired.ts';
import { syncDatabase } from '../../../../src/ohne/database/schema/sync.ts';
import { registerDatabase, registerDialect } from '../../../../src/ohne/database/use-database.ts';
import { color } from '../../../../src/ohne/fields/builtin/color.ts';
import { field } from '../../../../src/ohne/fields/field.ts';
import { useFields } from '../../../../src/ohne/fields/use-fields.ts';
import { queryUntyped } from '../../../../src/ohne/query/query.ts';
import { isValidationError } from '../../../../src/ohne/query/write/errors.ts';

type ValidateCtx = Parameters<NonNullable<typeof color.validators>[number]>[1];
type WriteCtx = Parameters<NonNullable<typeof color.sanitizers>[number]>[1];
type OptionsCtx = Parameters<NonNullable<typeof color.validateOptions>>[0];

const sanitize = (value: string) => color.sanitizers![0](value, {} as WriteCtx);
const validate = (value: string, alpha = false) =>
  color.validators![0](value, { options: { alpha }, errors: {} } as unknown as ValidateCtx);
const checkOptions = (options: Record<string, unknown>) =>
  color.validateOptions!({
    name: 'tint',
    options: { alpha: false, ...options },
  } as unknown as OptionsCtx);

useCollections().register('Banners', {
  name: 'Banners',
  collection: {
    fields: {
      tint: field('color', { unique: true }),
      glow: field('color', { alpha: true, nullable: true }),
    },
  },
});

const dialect = new SQLiteDialect();
const db = await dialect.connect(':memory:');
registerDialect(dialect);
registerDatabase(db);
await syncDatabase(db, dialect, {
  desired: buildDesiredSchema(useCollections(), useFields() as never),
});

describe('color sanitizer', () => {
  it('stores every hex spelling in one lowercase form', () => {
    strictEqual(sanitize('#F80'), '#ff8800');
    strictEqual(sanitize('#FF8800FF'), '#ff8800');
    strictEqual(sanitize('#ff880080'), '#ff880080');
  });

  it('passes anything else through for the validator to name', () => {
    strictEqual(sanitize('orange'), 'orange');
  });
});

describe('color validator', () => {
  it('takes an opaque color, and a translucent one only with `alpha`', () => {
    strictEqual(validate('#ff8800'), undefined);
    strictEqual(validate('#ff880080'), 'validation.invalidColor');
    strictEqual(validate('#ff880080', true), undefined);
  });

  it('names the form the field takes', () => {
    strictEqual(validate('orange'), 'validation.invalidColor');
    strictEqual(validate('orange', true), 'validation.invalidColorAlpha');
  });
});

describe('color validateOptions', () => {
  it('accepts swatches in any spelling, and none at all', () => {
    strictEqual(checkOptions({ swatches: ['#F80', '#336699'] }), undefined);
    strictEqual(checkOptions({}), undefined);
  });

  it('refuses a swatch that is no hex color', () => {
    deepStrictEqual(checkOptions({ swatches: ['#f80', 'orange'] }), [
      '`swatches` holds `orange`, which is no hex color.',
      'Write each swatch as `#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa`.',
    ]);
  });

  it('refuses a translucent swatch without `alpha`, and takes it with', () => {
    deepStrictEqual(checkOptions({ swatches: ['#f808'] }), [
      '`swatches` holds the translucent `#f808`, but the field takes no `alpha`.',
      'Make the swatch opaque, or set `alpha: true`.',
    ]);
    strictEqual(checkOptions({ swatches: ['#f808'], alpha: true }), undefined);
  });

  it('refuses two spellings of one color', () => {
    deepStrictEqual(checkOptions({ swatches: ['#F80', '#336699', '#ff8800'] }), [
      '`swatches` names a color more than once.',
      'Drop the duplicates:',
      '',
      '- `#ff8800`',
    ]);
  });
});

describe('color writes', () => {
  it('stores the canonical form, so another spelling of a color is not unique', async () => {
    const banner = await queryUntyped('Banners').createOrThrow({ tint: '#F80', glow: '#FF880080' });
    deepStrictEqual([banner.tint, banner.glow], ['#ff8800', '#ff880080']);
    await rejects(
      queryUntyped('Banners').createOrThrow({ tint: '#ff8800' }),
      (error) => isValidationError(error) && error.errors.tint === 'validation.notUnique',
    );
  });

  it('rejects a translucent color on a field without `alpha`', async () => {
    await rejects(
      queryUntyped('Banners').createOrThrow({ tint: '#33669980' }),
      (error) => isValidationError(error) && error.errors.tint === 'validation.invalidColor',
    );
  });
});
