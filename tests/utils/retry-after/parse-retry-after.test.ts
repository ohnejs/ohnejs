import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { parseRetryAfter } from '../../../src/utils/retry-after/parse-retry-after.ts';

const NOW = Date.parse('Wed, 21 Oct 2026 07:28:00 GMT');

describe('parseRetryAfter', () => {
  it('reads whole seconds as milliseconds', () => {
    strictEqual(parseRetryAfter('30'), 30_000);
    strictEqual(parseRetryAfter(' 0 '), 0);
  });

  it('reads an HTTP date as the milliseconds from now', () => {
    strictEqual(parseRetryAfter('Wed, 21 Oct 2026 07:28:30 GMT', NOW), 30_000);
    strictEqual(parseRetryAfter('Wednesday, 21-Oct-26 07:29:00 GMT', NOW), 60_000);
  });

  it('reads a past date as 0', () => {
    strictEqual(parseRetryAfter('Wed, 21 Oct 2026 07:27:00 GMT', NOW), 0);
  });

  it('answers null for a missing or malformed header', () => {
    for (const header of [null, '', 'soon', '-1', '1.5', '30s', 'Wed, 99 Oct 2026 07:28:30 GMT'])
      strictEqual(parseRetryAfter(header, NOW), null, String(header));
  });
});
