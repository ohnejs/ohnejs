import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { roundTo } from '../../../src/utils/index.ts';

describe('roundTo', () => {
  it('rounds to the given decimal places', () => {
    strictEqual(roundTo(1.5, 0), 2);
    strictEqual(roundTo(1.25, 1), 1.3);
    strictEqual(roundTo(1e-7, 6), 0);
    strictEqual(roundTo(1.5e-7, 7), 2e-7);
  });

  it('rounds halves up, as `Math.round` does', () => {
    strictEqual(roundTo(-2.5, 0), -2);
    strictEqual(roundTo(-0.25, 1), -0.2);
  });

  it('rounds the decimal a number prints as, not its binary value', () => {
    strictEqual(roundTo(1.005, 2), 1.01);
    strictEqual(roundTo(8.345, 2), 8.35);
  });

  it('rounds exactly at full double precision', () => {
    strictEqual(roundTo(2294286737.4406724, 6), 2294286737.440672);
    strictEqual(roundTo(-2436637543667.8926, 3), -2436637543667.893);
    strictEqual(roundTo(0.30000000000000004, 16), 0.3);
  });

  it('keeps a value with no more decimals than the places', () => {
    strictEqual(roundTo(123456.789, 15), 123456.789);
    strictEqual(roundTo(1e-7, 15), 1e-7);
    strictEqual(roundTo(42, 0), 42);
  });

  it('keeps every decimal at `Infinity` places', () => {
    strictEqual(roundTo(1.5, Infinity), 1.5);
    strictEqual(roundTo(1e-7, Infinity), 1e-7);
    strictEqual(roundTo(123456.789, Infinity), 123456.789);
    strictEqual(roundTo(5e-324, Infinity), 5e-324);
  });

  it('clears binary drift from a sum and a product', () => {
    strictEqual(roundTo(0.14 + 1, 2), 1.14);
    strictEqual(roundTo(0.1 + 0.2, 1), 0.3);
    strictEqual(roundTo(0.07 * 10, 2), 0.7);
  });

  it('rounds to tens and beyond at negative places', () => {
    strictEqual(roundTo(1250, -2), 1300);
    strictEqual(roundTo(1.5e25, -2), 1.5e25);
  });

  it('passes a non-finite number through', () => {
    strictEqual(roundTo(NaN, 2), NaN);
    strictEqual(roundTo(Infinity, 2), Infinity);
    strictEqual(roundTo(-Infinity, -1), -Infinity);
  });
});
