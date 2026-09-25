import { deepStrictEqual, match, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import {
  isReferenceViolation,
  isValidationError,
  referenceViolation,
  validationError,
} from '../../../../src/ohne/query/write/errors.ts';

describe('validationError', () => {
  it('carries the field-error map verbatim', () => {
    const errors = { title: 'This field is required', 'sections[0].url': 'This value is invalid' };
    deepStrictEqual(validationError(errors).errors, errors);
  });

  it('names the failing paths in the message', () => {
    match(validationError({ title: 'x', summary: 'y' }).message, /title, summary/);
  });

  it('is named `ValidationError`', () => {
    strictEqual(validationError({}).name, 'ValidationError');
  });

  it('is recognized by its guard, and a plain error is not', () => {
    strictEqual(isValidationError(validationError({ a: 'b' })), true);
    strictEqual(isValidationError(new Error('nope')), false);
    strictEqual(isValidationError('nope'), false);
  });
});

describe('referenceViolation', () => {
  it('carries the driver failure as its cause', () => {
    const cause = new Error('FOREIGN KEY constraint failed');
    strictEqual(referenceViolation(cause).cause, cause);
  });

  it('is named `ReferenceViolation`', () => {
    strictEqual(referenceViolation().name, 'ReferenceViolation');
  });

  it('is recognized by its guard, and neither a plain nor a validation error is', () => {
    strictEqual(isReferenceViolation(referenceViolation()), true);
    strictEqual(isReferenceViolation(validationError({ a: 'b' })), false);
    strictEqual(isReferenceViolation(new Error('nope')), false);
  });
});
