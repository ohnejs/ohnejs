import { deepStrictEqual, ok, rejects, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { Transaction } from '../../../src/ohne/database/adapter.ts';

import { useCollections } from '../../../src/ohne/collections/use-collections.ts';
import { isOhneError } from '../../../src/ohne/error/ohne-error.ts';
import { integer } from '../../../src/ohne/fields/builtin/integer.ts';
import { number } from '../../../src/ohne/fields/builtin/number.ts';
import { field, resolveFieldOptions } from '../../../src/ohne/fields/field.ts';
import { numericOptionsProblem } from '../../../src/ohne/fields/numeric.ts';
import { validateLiteralDefaults } from '../../../src/ohne/query/validate-literal-defaults.ts';

type Ctx = Parameters<NonNullable<typeof number.validators>[number]>[1];

const ctx = (options: Record<string, unknown>) => ({ options, errors: {} }) as unknown as Ctx;
const check = number.validators![0];
const problem = (options: Record<string, unknown>, whole = false) =>
  numericOptionsProblem({ display: 'input', ...options }, { whole });

describe('numeric step', () => {
  it('accepts a value on the grid, exactly in decimal', () => {
    strictEqual(check(0.3, ctx({ step: 0.1 })), undefined);
    strictEqual(check(1.75, ctx({ step: 0.5, min: 0.25 })), undefined);
  });

  it('rejects a value off the grid', () => {
    deepStrictEqual(check(0.1 + 0.2, ctx({ step: 0.1 })), {
      key: 'validation.invalidStep',
      params: { step: 0.1 },
    });
    deepStrictEqual(check(1, ctx({ step: 0.5, min: 0.25 })), {
      key: 'validation.invalidStepFrom',
      params: { step: 0.5, min: 0.25 },
    });
  });

  it('reports the range before the grid', () => {
    deepStrictEqual(check(-0.05, ctx({ step: 0.1, min: 0 })), {
      key: 'validation.minValue',
      params: { min: 0 },
    });
  });

  it('checks `integer` on the same grid', () => {
    deepStrictEqual(integer.validators![0](7, ctx({ step: 5 })), {
      key: 'validation.invalidStep',
      params: { step: 5 },
    });
  });
});

describe('numeric options', () => {
  it('shows the input unless a field asks for a slider', () => {
    strictEqual(resolveFieldOptions(number, {}).display, 'input');
    strictEqual(resolveFieldOptions(integer, { display: 'slider' }).display, 'slider');
  });

  it('accepts a positive step, a suffix and a bounded slider', () => {
    strictEqual(problem({ step: 0.25, suffix: 'kg' }), undefined);
    strictEqual(problem({ display: 'slider', min: 0, max: 5, step: 0.5 }), undefined);
    strictEqual(problem({ display: 'slider', min: 0, max: 10 }, true), undefined);
  });

  it('refuses a step that is not above 0', () => {
    for (const step of [0, -1, NaN, Infinity]) {
      deepStrictEqual(problem({ step }), [
        `\`step\` is \`${step}\`, but it must be a positive number.`,
        'Set a `step` above `0`, like `0.5`.',
      ]);
    }
  });

  it('keeps an `integer` grid on whole numbers', () => {
    deepStrictEqual(problem({ step: 0.5 }, true), [
      '`step` is `0.5`, but an `integer` field holds whole numbers only.',
      'Use a whole `step`, like `5`.',
    ]);
    deepStrictEqual(problem({ step: 2, min: 0.5 }, true), [
      '`min` is `0.5`, so the grid it starts holds no whole number.',
      'Use a whole `min`.',
    ]);
    deepStrictEqual(
      problem({ display: 'slider', min: 0.5, max: 9 }, true)?.[0],
      '`min` is `0.5`, so the grid it starts holds no whole number.',
    );
    strictEqual(problem({ min: 0.5 }, true), undefined);
  });

  it('needs a range for a slider, and a step on `number`', () => {
    deepStrictEqual(problem({ display: 'slider', min: 0 }, true), [
      "`display: 'slider'` needs `min` and `max`.",
      'Set the range the slider spans, like `min: 0, max: 10`.',
    ]);
    deepStrictEqual(problem({ display: 'slider', min: 0, max: 5 }), [
      "`display: 'slider'` on a `number` field needs `min`, `max` and `step`.",
      'Set the range and grid the slider spans, like `min: 0, max: 5, step: 0.5`.',
    ]);
  });

  it('fails a literal default off the grid at boot', async () => {
    useCollections().register('Scores', {
      name: 'Scores',
      collection: { fields: { rating: field('number', { step: 0.5, default: 0.3 }) } },
    } as never);
    try {
      await rejects(validateLiteralDefaults({} as Transaction), (error: unknown) => {
        ok(isOhneError(error));
        return error.title === 'Field `rating` defaults to a value it rejects';
      });
    } finally {
      useCollections().delete('Scores');
    }
  });
});
