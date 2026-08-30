import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { isISOTime } from '../../../src/utils/index.ts';

describe('isISOTime', () => {
  it('returns true for `HH:MM` times', () => {
    strictEqual(isISOTime('00:00'), true);
    strictEqual(isISOTime('09:30'), true);
    strictEqual(isISOTime('19:05'), true);
    strictEqual(isISOTime('23:59'), true);
  });

  it('returns true for `HH:MM:SS` times', () => {
    strictEqual(isISOTime('00:00:00'), true);
    strictEqual(isISOTime('12:34:56'), true);
    strictEqual(isISOTime('23:59:59'), true);
  });

  it('returns false for hours beyond the 24-hour clock', () => {
    strictEqual(isISOTime('24:00'), false);
    strictEqual(isISOTime('24:00:00'), false);
    strictEqual(isISOTime('25:10'), false);
  });

  it('returns false for overflowing minutes and seconds', () => {
    strictEqual(isISOTime('12:60'), false);
    strictEqual(isISOTime('12:00:60'), false);
  });

  it('returns false for the wrong width', () => {
    strictEqual(isISOTime('9:30'), false);
    strictEqual(isISOTime('09:5'), false);
    strictEqual(isISOTime('09:30:5'), false);
    strictEqual(isISOTime('09:30:00:00'), false);
    strictEqual(isISOTime('09'), false);
  });

  it('returns false for non-time strings and non-strings', () => {
    strictEqual(isISOTime('0930'), false);
    strictEqual(isISOTime(''), false);
    strictEqual(isISOTime(930), false);
    strictEqual(isISOTime(null), false);
    strictEqual(isISOTime(undefined), false);
  });
});
