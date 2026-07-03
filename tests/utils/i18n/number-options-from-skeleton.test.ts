import { deepStrictEqual, strictEqual, throws } from 'node:assert';
import { describe, it } from 'node:test';

import { MessageFormatError } from '../../../src/utils/i18n/message-errors.ts';
import { numberOptionsFromSkeleton } from '../../../src/utils/i18n/number-options-from-skeleton.ts';

const opts = numberOptionsFromSkeleton;

describe('numberOptionsFromSkeleton - notation', () => {
  it('compact-short', () => {
    deepStrictEqual(opts('compact-short'), { notation: 'compact', compactDisplay: 'short' });
  });

  it('compact-long', () => {
    deepStrictEqual(opts('compact-long'), { notation: 'compact', compactDisplay: 'long' });
  });

  it('notation-simple', () => {
    deepStrictEqual(opts('notation-simple'), { notation: 'standard' });
  });

  it('scientific', () => {
    deepStrictEqual(opts('scientific'), { notation: 'scientific' });
  });

  it('engineering', () => {
    deepStrictEqual(opts('engineering'), { notation: 'engineering' });
  });
});

describe('numberOptionsFromSkeleton - unit and style', () => {
  it('percent', () => {
    deepStrictEqual(opts('percent'), { style: 'percent' });
  });

  it('base-unit forces decimal style', () => {
    deepStrictEqual(opts('base-unit'), { style: 'decimal' });
  });

  it('currency/EUR', () => {
    deepStrictEqual(opts('currency/EUR'), { style: 'currency', currency: 'EUR' });
  });

  it('unit/ takes the core unit identifier verbatim', () => {
    deepStrictEqual(opts('unit/fluid-ounce'), { style: 'unit', unit: 'fluid-ounce' });
  });

  it('unit/ compound identifiers feed Intl.NumberFormat', () => {
    const out = new Intl.NumberFormat('en-US', opts('unit/kilometer-per-hour')).format(5);
    strictEqual(out.includes('km/h'), true);
  });

  it('measure-unit/ strips the ICU type prefix', () => {
    deepStrictEqual(opts('measure-unit/mass-kilogram'), { style: 'unit', unit: 'kilogram' });
    deepStrictEqual(opts('measure-unit/volume-fluid-ounce'), {
      style: 'unit',
      unit: 'fluid-ounce',
    });
  });

  it('concise-unit/ is treated like unit/', () => {
    deepStrictEqual(opts('concise-unit/megabyte'), { style: 'unit', unit: 'megabyte' });
  });
});

describe('numberOptionsFromSkeleton - precision', () => {
  it('precision-integer', () => {
    deepStrictEqual(opts('precision-integer'), { maximumFractionDigits: 0 });
  });

  it('precision-unlimited', () => {
    deepStrictEqual(opts('precision-unlimited'), { maximumFractionDigits: 20 });
  });

  it('precision-currency-standard is a no-op', () => {
    deepStrictEqual(opts('precision-currency-standard'), {});
  });

  it('precision-increment/0.01 -> increment 1 with 2 fraction digits', () => {
    deepStrictEqual(opts('precision-increment/0.01'), {
      roundingIncrement: 1,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  });

  it('precision-increment/0.05 -> increment 5 with 2 fraction digits', () => {
    deepStrictEqual(opts('precision-increment/0.05'), {
      roundingIncrement: 5,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  });

  it('precision-increment/25 -> increment 25 with 0 fraction digits', () => {
    deepStrictEqual(opts('precision-increment/25'), {
      roundingIncrement: 25,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
  });

  it('precision-increment/0.03 throws a MessageFormatError before Intl gets a chance', () => {
    throws(() => opts('precision-increment/0.03'), MessageFormatError);
  });

  it('precision-increment/7 (not in Intl allowed set) throws a MessageFormatError', () => {
    throws(() => opts('precision-increment/7'), /Intl\.NumberFormat does not support/);
  });
});

describe('numberOptionsFromSkeleton - fraction shortcut', () => {
  it('.00 -> exactly two fraction digits', () => {
    deepStrictEqual(opts('.00'), { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  });

  it('.0 -> exactly one fraction digit', () => {
    deepStrictEqual(opts('.0'), { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  });

  it('.0## -> 1 to 3 fraction digits', () => {
    deepStrictEqual(opts('.0##'), { minimumFractionDigits: 1, maximumFractionDigits: 3 });
  });

  it('.## -> 0 to 2 fraction digits', () => {
    deepStrictEqual(opts('.##'), { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  });

  it('.00* -> minimum 2 fraction digits, unbounded max', () => {
    deepStrictEqual(opts('.00*'), { minimumFractionDigits: 2, maximumFractionDigits: 20 });
  });

  it('throws on a malformed fraction skeleton with hashes before zeros', () => {
    throws(() => opts('.##0'), /malformed fraction skeleton/);
  });

  it('throws on a malformed fraction skeleton (junk trailing char)', () => {
    throws(() => opts('.0X'), /malformed fraction skeleton/);
  });
});

describe('numberOptionsFromSkeleton - significant shortcut', () => {
  it('@@@ -> 3 to 3 significant', () => {
    deepStrictEqual(opts('@@@'), {
      minimumSignificantDigits: 3,
      maximumSignificantDigits: 3,
    });
  });

  it('@@## -> 2 to 4 significant', () => {
    deepStrictEqual(opts('@@##'), {
      minimumSignificantDigits: 2,
      maximumSignificantDigits: 4,
    });
  });

  it('@@@* -> minimum 3 significant, unbounded max', () => {
    deepStrictEqual(opts('@@@*'), {
      minimumSignificantDigits: 3,
      maximumSignificantDigits: 21,
    });
  });

  it('@ -> exactly 1 significant', () => {
    deepStrictEqual(opts('@'), {
      minimumSignificantDigits: 1,
      maximumSignificantDigits: 1,
    });
  });

  it('throws on a malformed significant skeleton', () => {
    throws(() => opts('@@@X'), /malformed significant skeleton/);
  });
});

describe('numberOptionsFromSkeleton - rounding mode', () => {
  const cases: Array<[string, string]> = [
    ['rounding-mode-ceiling', 'ceil'],
    ['rounding-mode-floor', 'floor'],
    ['rounding-mode-down', 'trunc'],
    ['rounding-mode-up', 'expand'],
    ['rounding-mode-half-even', 'halfEven'],
    ['rounding-mode-half-down', 'halfTrunc'],
    ['rounding-mode-half-up', 'halfExpand'],
  ];

  for (const [stem, expected] of cases) {
    it(`${stem} -> ${expected}`, () => {
      deepStrictEqual(opts(stem), { roundingMode: expected });
    });
  }

  it('rounding-mode-unnecessary is rejected', () => {
    throws(() => opts('rounding-mode-unnecessary'), MessageFormatError);
  });
});

describe('numberOptionsFromSkeleton - integer width', () => {
  it('integer-width/00 -> minimumIntegerDigits 2', () => {
    deepStrictEqual(opts('integer-width/00'), { minimumIntegerDigits: 2 });
  });

  it('integer-width/*000 accepts the canonical `*` form', () => {
    deepStrictEqual(opts('integer-width/*000'), { minimumIntegerDigits: 3 });
  });

  it('integer-width/+00 accepts the deprecated `+` form', () => {
    deepStrictEqual(opts('integer-width/+00'), { minimumIntegerDigits: 2 });
  });

  it('integer-width with non-zero pattern is rejected', () => {
    throws(() => opts('integer-width/0#'), /malformed integer-width pattern/);
  });
});

describe('numberOptionsFromSkeleton - grouping', () => {
  it('group-off', () => {
    deepStrictEqual(opts('group-off'), { useGrouping: false });
  });

  it('group-min2', () => {
    deepStrictEqual(opts('group-min2'), { useGrouping: 'min2' });
  });

  it('group-auto', () => {
    deepStrictEqual(opts('group-auto'), { useGrouping: 'auto' });
  });

  it('group-on-aligned', () => {
    deepStrictEqual(opts('group-on-aligned'), { useGrouping: 'always' });
  });

  it('group-thousands is rejected', () => {
    throws(() => opts('group-thousands'), MessageFormatError);
  });
});

describe('numberOptionsFromSkeleton - sign display', () => {
  it('sign-auto / sign-always / sign-never / sign-except-zero / sign-negative', () => {
    deepStrictEqual(opts('sign-auto'), { signDisplay: 'auto' });
    deepStrictEqual(opts('sign-always'), { signDisplay: 'always' });
    deepStrictEqual(opts('sign-never'), { signDisplay: 'never' });
    deepStrictEqual(opts('sign-except-zero'), { signDisplay: 'exceptZero' });
    deepStrictEqual(opts('sign-negative'), { signDisplay: 'negative' });
  });

  it('sign-accounting variants combine currencySign with signDisplay', () => {
    deepStrictEqual(opts('sign-accounting'), { currencySign: 'accounting' });
    deepStrictEqual(opts('sign-accounting-always'), {
      currencySign: 'accounting',
      signDisplay: 'always',
    });
    deepStrictEqual(opts('sign-accounting-except-zero'), {
      currencySign: 'accounting',
      signDisplay: 'exceptZero',
    });
    deepStrictEqual(opts('sign-accounting-negative'), {
      currencySign: 'accounting',
      signDisplay: 'negative',
    });
  });
});

describe('numberOptionsFromSkeleton - decimal', () => {
  it('decimal-auto is a no-op', () => {
    deepStrictEqual(opts('decimal-auto'), {});
  });

  it('decimal-always is rejected', () => {
    throws(() => opts('decimal-always'), MessageFormatError);
  });
});

describe('numberOptionsFromSkeleton - unit width', () => {
  it('unit-width-narrow', () => {
    const o = opts('unit-width-narrow');
    strictEqual(o.unitDisplay, 'narrow');
    strictEqual(o.currencyDisplay, 'narrowSymbol');
  });

  it('unit-width-short', () => {
    const o = opts('unit-width-short');
    strictEqual(o.unitDisplay, 'short');
    strictEqual(o.currencyDisplay, 'symbol');
  });

  it('unit-width-full-name', () => {
    const o = opts('unit-width-full-name');
    strictEqual(o.unitDisplay, 'long');
    strictEqual(o.currencyDisplay, 'name');
  });

  it('unit-width-iso-code -> currencyDisplay code', () => {
    deepStrictEqual(opts('unit-width-iso-code'), { currencyDisplay: 'code' });
  });

  it('unit-width-hidden / unit-width-formal / unit-width-variant are rejected', () => {
    throws(() => opts('unit-width-hidden'), MessageFormatError);
    throws(() => opts('unit-width-formal'), MessageFormatError);
    throws(() => opts('unit-width-variant'), MessageFormatError);
  });
});

describe('numberOptionsFromSkeleton - numbering system', () => {
  it('latin', () => {
    deepStrictEqual(opts('latin'), { numberingSystem: 'latn' });
  });

  it('numbering-system/arab', () => {
    deepStrictEqual(opts('numbering-system/arab'), { numberingSystem: 'arab' });
  });
});

describe('numberOptionsFromSkeleton - unsupported features', () => {
  it('permille is rejected', () => {
    throws(() => opts('permille'), MessageFormatError);
  });

  it('precision-currency-cash is rejected', () => {
    throws(() => opts('precision-currency-cash'), MessageFormatError);
  });

  it('scale/100 is rejected', () => {
    throws(() => opts('scale/100'), /value transformation/);
  });

  it('usage/snow is rejected', () => {
    throws(() => opts('usage/snow'), MessageFormatError);
  });

  it('per-measure-unit/... is rejected', () => {
    throws(() => opts('per-measure-unit/duration-second'), MessageFormatError);
  });

  it('unknown stems are reported by name', () => {
    try {
      opts('frobnicate');
    } catch (e) {
      strictEqual(e instanceof MessageFormatError, true);
      strictEqual((e as MessageFormatError).message.includes('frobnicate'), true);
      return;
    }
    throw new Error('expected throw');
  });
});

describe('numberOptionsFromSkeleton - combined skeletons', () => {
  it('currency/EUR with .00 fraction precision', () => {
    deepStrictEqual(opts('currency/EUR .00'), {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  });

  it('compact-short with @@@ significant precision', () => {
    deepStrictEqual(opts('compact-short @@@'), {
      notation: 'compact',
      compactDisplay: 'short',
      minimumSignificantDigits: 3,
      maximumSignificantDigits: 3,
    });
  });

  it('percent with group-off and sign-always', () => {
    deepStrictEqual(opts('percent group-off sign-always'), {
      style: 'percent',
      useGrouping: false,
      signDisplay: 'always',
    });
  });

  it('tolerates extra whitespace between stems', () => {
    deepStrictEqual(opts('  percent   group-off  '), {
      style: 'percent',
      useGrouping: false,
    });
  });

  it('an empty skeleton produces an empty options object', () => {
    deepStrictEqual(opts(''), {});
  });

  it('a whitespace-only skeleton is the same as empty', () => {
    deepStrictEqual(opts('   '), {});
  });
});

describe('numberOptionsFromSkeleton - end-to-end rendering', () => {
  it('the produced options feed Intl.NumberFormat correctly', () => {
    const o = opts('currency/EUR .00');
    const out = new Intl.NumberFormat('en-US', o).format(9.5);
    strictEqual(out.includes('9.50'), true);
  });

  it('compact-short renders compact notation', () => {
    const o = opts('compact-short');
    strictEqual(new Intl.NumberFormat('en-US', o).format(12345), '12K');
  });

  it('scientific produces scientific output', () => {
    const o = opts('scientific');
    const out = new Intl.NumberFormat('en-US', o).format(12345);
    strictEqual(out.includes('E'), true);
  });
});
