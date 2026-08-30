import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { time } from '../../../../src/ohne/fields/builtin/time.ts';

type ValidateCtx = Parameters<NonNullable<typeof time.validators>[number]>[1];
type WriteCtx = Parameters<NonNullable<typeof time.sanitizers>[number]>[1];

const ctx = (options: Record<string, unknown> = {}) =>
  ({ options, errors: {} }) as unknown as ValidateCtx;

const sanitize = time.sanitizers![0];
const wellFormed = time.validators![0];
const bounds = time.validators![1];

describe('time sanitizer', () => {
  it('pads `HH:MM` to `HH:MM:SS`', () => {
    strictEqual(sanitize('09:30', {} as WriteCtx), '09:30:00');
  });

  it('keeps `HH:MM:SS` as given', () => {
    strictEqual(sanitize('09:30:15', {} as WriteCtx), '09:30:15');
  });

  it('passes a non-ISO string through untouched', () => {
    strictEqual(sanitize('9:30', {} as WriteCtx), '9:30');
  });
});

describe('time well-formedness', () => {
  it('accepts times on the 24-hour clock', () => {
    strictEqual(wellFormed('09:30:00', ctx()), undefined);
    strictEqual(wellFormed('23:59', ctx()), undefined);
  });

  it('rejects a time off the clock', () => {
    strictEqual(wellFormed('24:00', ctx()), 'validation.invalidTime');
    strictEqual(wellFormed('12:60', ctx()), 'validation.invalidTime');
    strictEqual(wellFormed('9:30', ctx()), 'validation.invalidTime');
  });
});

describe('time bounds', () => {
  it('rejects a time before `min`, padding an `HH:MM` bound first', () => {
    deepStrictEqual(bounds('09:29:59', ctx({ min: '09:30' })), {
      key: 'validation.minValue',
      params: { min: '09:30' },
    });
  });

  it('rejects a time after `max`, padding an `HH:MM` bound first', () => {
    deepStrictEqual(bounds('17:00:30', ctx({ max: '17:00' })), {
      key: 'validation.maxValue',
      params: { max: '17:00' },
    });
  });

  it('accepts a time meeting a padded bound exactly', () => {
    strictEqual(bounds('09:30:00', ctx({ min: '09:30' })), undefined);
    strictEqual(bounds('17:00:00', ctx({ max: '17:00' })), undefined);
  });

  it('compares against an `HH:MM:SS` bound as given', () => {
    deepStrictEqual(bounds('08:00:00', ctx({ min: '08:00:01' })), {
      key: 'validation.minValue',
      params: { min: '08:00:01' },
    });
    strictEqual(bounds('08:00:01', ctx({ min: '08:00:01' })), undefined);
  });
});
