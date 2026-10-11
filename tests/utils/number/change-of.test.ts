import { deepStrictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { changeOf, changeOfRate } from '../../../src/utils/index.ts';

describe('changeOf', () => {
  it('reads growth as good and a drop as bad', () => {
    deepStrictEqual(changeOf(123, 100), { ratio: 0.23, direction: 'up', tone: 'good' });
    deepStrictEqual(changeOf(80, 100), { ratio: -0.2, direction: 'down', tone: 'bad' });
  });

  it('flips the tone when lower is better', () => {
    deepStrictEqual(changeOf(80, 100, true), { ratio: -0.2, direction: 'down', tone: 'good' });
    deepStrictEqual(changeOf(120, 100, true), { ratio: 0.2, direction: 'up', tone: 'bad' });
  });

  it('is flat within half a percent', () => {
    deepStrictEqual(changeOf(1004, 1000), { ratio: 0.004, direction: 'flat', tone: 'neutral' });
    deepStrictEqual(changeOf(996, 1000).direction, 'flat');
  });

  it('has no ratio and no tone from zero', () => {
    deepStrictEqual(changeOf(5, 0), { ratio: null, direction: 'up', tone: 'neutral' });
    deepStrictEqual(changeOf(0, 0), { ratio: null, direction: 'flat', tone: 'neutral' });
    deepStrictEqual(changeOf(-5, 0), { ratio: null, direction: 'down', tone: 'neutral' });
  });

  it('measures against the size of a negative previous value', () => {
    deepStrictEqual(changeOf(-50, -100), { ratio: 0.5, direction: 'up', tone: 'good' });
  });
});

describe('changeOfRate', () => {
  it('compares rates in points', () => {
    deepStrictEqual(changeOfRate(0.12, 0.09), {
      ratio: 0.03,
      direction: 'up',
      tone: 'good',
      points: true,
    });
    deepStrictEqual(changeOfRate(0.12, 0.09, true).tone, 'bad');
    deepStrictEqual(changeOfRate(0.104, 0.1).direction, 'flat');
  });
});
