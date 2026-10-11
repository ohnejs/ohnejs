import { deepStrictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { niceScale } from '../../../src/utils/index.ts';

describe('niceScale', () => {
  it('fits the peak in clean steps of 1, 2, 2.5 or 5 times a power of ten', () => {
    deepStrictEqual(niceScale(87), { max: 100, step: 25, ticks: [0, 25, 50, 75, 100] });
    deepStrictEqual(niceScale(1240, 3), { max: 1500, step: 500, ticks: [0, 500, 1000, 1500] });
    deepStrictEqual(niceScale(9000, 4).step, 2500);
  });

  it('ends on the peak when the peak is already clean', () => {
    deepStrictEqual(niceScale(100).ticks, [0, 25, 50, 75, 100]);
  });

  it('never steps by a fraction for whole numbers', () => {
    deepStrictEqual(niceScale(3), { max: 3, step: 1, ticks: [0, 1, 2, 3] });
  });

  it('steps by clean fractions for fractional data without drift', () => {
    deepStrictEqual(niceScale(0.8, 4, false), {
      max: 0.8,
      step: 0.2,
      ticks: [0, 0.2, 0.4, 0.6, 0.8],
    });
    deepStrictEqual(niceScale(0.0034, 4, false).ticks, [0, 0.001, 0.002, 0.003, 0.004]);
  });

  it('gives a peak of zero or less one step', () => {
    deepStrictEqual(niceScale(0), { max: 1, step: 1, ticks: [0, 1] });
    deepStrictEqual(niceScale(-5, 4, false), { max: 0.25, step: 0.25, ticks: [0, 0.25] });
  });

  it('gives a peak too small for a step the scale of zero', () => {
    deepStrictEqual(niceScale(0.1 + 0.2 - 0.3, 4, false), niceScale(0, 4, false));
    deepStrictEqual(niceScale(1e-15, 4, false), niceScale(0, 4, false));
  });
});
