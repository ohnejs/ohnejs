import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { isDebugEnabled } from '../../../src/utils/index.ts';

describe('isDebugEnabled', () => {
  describe('boolean override', () => {
    it('returns true for booleanish-true patterns', () => {
      strictEqual(isDebugEnabled('ohne', '1'), true);
      strictEqual(isDebugEnabled('ohne', 'true'), true);
      strictEqual(isDebugEnabled('ohne', 'TRUE'), true);
      strictEqual(isDebugEnabled('ohne', 'True'), true);
    });

    it('returns false for booleanish-false patterns', () => {
      strictEqual(isDebugEnabled('ohne', '0'), false);
      strictEqual(isDebugEnabled('ohne', 'false'), false);
      strictEqual(isDebugEnabled('ohne', 'FALSE'), false);
    });
  });

  describe('wildcard `*`', () => {
    it('matches any namespace', () => {
      strictEqual(isDebugEnabled('ohne', '*'), true);
      strictEqual(isDebugEnabled('ohne:cli:run', '*'), true);
      strictEqual(isDebugEnabled('express', '*'), true);
    });
  });

  describe('exact namespace', () => {
    it('matches identical namespace', () => {
      strictEqual(isDebugEnabled('ohne', 'ohne'), true);
      strictEqual(isDebugEnabled('ohne:cli', 'ohne:cli'), true);
    });

    it('does not match a different namespace', () => {
      strictEqual(isDebugEnabled('ohne', 'express'), false);
      strictEqual(isDebugEnabled('ohne', 'ohne:cli'), false);
      strictEqual(isDebugEnabled('ohne:cli', 'ohne'), false);
    });
  });

  describe('subtree `<x>:*`', () => {
    it('matches the trunk', () => {
      strictEqual(isDebugEnabled('ohne', 'ohne:*'), true);
    });

    it('matches direct children', () => {
      strictEqual(isDebugEnabled('ohne:cli', 'ohne:*'), true);
    });

    it('matches deep children', () => {
      strictEqual(isDebugEnabled('ohne:cli:run', 'ohne:*'), true);
    });

    it('does not match siblings', () => {
      strictEqual(isDebugEnabled('express', 'ohne:*'), false);
    });

    it('does not match a prefix lacking the `:` delimiter', () => {
      strictEqual(isDebugEnabled('ohnex', 'ohne:*'), false);
    });
  });

  describe('multiple tokens', () => {
    it('matches when any comma-separated token matches', () => {
      strictEqual(isDebugEnabled('ohne', 'express:*,ohne'), true);
    });

    it('matches when any whitespace-separated token matches', () => {
      strictEqual(isDebugEnabled('ohne', 'express:* ohne'), true);
    });

    it('returns false when no token matches', () => {
      strictEqual(isDebugEnabled('ohne', 'express,mongoose:*'), false);
    });
  });

  describe('empty / nullish', () => {
    it('returns false for undefined', () => {
      strictEqual(isDebugEnabled('ohne', undefined), false);
    });

    it('returns false for empty string', () => {
      strictEqual(isDebugEnabled('ohne', ''), false);
    });

    it('returns false for whitespace-only', () => {
      strictEqual(isDebugEnabled('ohne', '   '), false);
    });
  });
});
