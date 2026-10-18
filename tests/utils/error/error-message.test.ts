import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { errorMessage } from '../../../src/utils/error/error-message.ts';

describe('errorMessage', () => {
  it('returns an Error message', () => {
    strictEqual(errorMessage(new Error('boom')), 'boom');
    strictEqual(errorMessage(new TypeError('nope')), 'nope');
  });

  it('joins the messages an AggregateError without its own carries', () => {
    const refused = [
      new Error('connect ECONNREFUSED ::1:5432'),
      new Error('connect ECONNREFUSED 127.0.0.1:5432'),
    ];
    strictEqual(
      errorMessage(new AggregateError(refused)),
      'connect ECONNREFUSED ::1:5432; connect ECONNREFUSED 127.0.0.1:5432',
    );
    strictEqual(errorMessage(new AggregateError(refused, 'all refused')), 'all refused');
  });

  it('coerces a non-Error to a string', () => {
    strictEqual(errorMessage('boom'), 'boom');
    strictEqual(errorMessage(42), '42');
    strictEqual(errorMessage(null), 'null');
    strictEqual(errorMessage(undefined), 'undefined');
  });
});
