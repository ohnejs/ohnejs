import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { isTimezone } from '../../../src/utils/is/is-timezone.ts';

describe('isTimezone', () => {
  it('returns true for IANA names', () => {
    strictEqual(isTimezone('Europe/Berlin'), true);
    strictEqual(isTimezone('Europe/Sarajevo'), true);
    strictEqual(isTimezone('America/New_York'), true);
    strictEqual(isTimezone('Asia/Kolkata'), true);
  });

  it('returns true for aliases', () => {
    strictEqual(isTimezone('US/Pacific'), true);
    strictEqual(isTimezone('Etc/UTC'), true);
    strictEqual(isTimezone('Zulu'), true);
    strictEqual(isTimezone('GMT'), true);
  });

  it('returns true for UTC in any letter case', () => {
    strictEqual(isTimezone('UTC'), true);
    strictEqual(isTimezone('utc'), true);
    strictEqual(isTimezone('europe/berlin'), true);
  });

  it('returns false for local and the empty string', () => {
    strictEqual(isTimezone('local'), false);
    strictEqual(isTimezone(''), false);
  });

  it('returns false for garbage', () => {
    strictEqual(isTimezone('Mars/Olympus'), false);
    strictEqual(isTimezone('Europe'), false);
    strictEqual(isTimezone('Berlin'), false);
    strictEqual(isTimezone(' UTC'), false);
    strictEqual(isTimezone('GMT+1'), false);
  });

  it('returns false for non-strings', () => {
    strictEqual(isTimezone(null), false);
    strictEqual(isTimezone(undefined), false);
    strictEqual(isTimezone(0), false);
    strictEqual(isTimezone(1), false);
    strictEqual(isTimezone(true), false);
    strictEqual(isTimezone(['UTC']), false);
    strictEqual(isTimezone(new Date()), false);
  });
});
