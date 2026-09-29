import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { isProviderError, providerError, usageCost } from '../../../src/ai/providers/provider.ts';
import { isOhneError } from '../../../src/ohne/error/ohne-error.ts';

describe('providerError', () => {
  it('brands an ohneError with its code, status and wait', () => {
    const error = providerError({ code: 'status', message: 'Overloaded', status: 529, wait: 1500 });
    strictEqual(isProviderError(error), true);
    strictEqual(isOhneError(error), true);
    strictEqual(error.message, 'Overloaded');
    strictEqual(error.code, 'status');
    strictEqual(error.status, 529);
    strictEqual(error.wait, 1500);
    strictEqual(error.retry, false);
  });

  it('is told apart from any other error', () => {
    strictEqual(isProviderError(new Error('Overloaded')), false);
    strictEqual(isProviderError('Overloaded'), false);
  });
});

describe('usageCost', () => {
  it('charges fresh, written and output tokens whole and read ones by a tenth, rounded up', () => {
    strictEqual(usageCost({ fresh: 100, cacheRead: 95, cacheWrite: 20, output: 30 }), 160);
    strictEqual(usageCost({ fresh: 0, cacheRead: 1, cacheWrite: 0, output: 0 }), 1);
    strictEqual(usageCost({ fresh: 0, cacheRead: 0, cacheWrite: 0, output: 0 }), 0);
  });
});
