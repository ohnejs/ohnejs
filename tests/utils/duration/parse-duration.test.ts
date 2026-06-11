import { strictEqual, throws } from 'node:assert';
import { describe, it } from 'node:test';

import { parseDuration } from '../../../src/utils/index.ts';

describe('parseDuration', () => {
  describe('numbers', () => {
    it('passes finite non-negative numbers through unchanged', () => {
      strictEqual(parseDuration(0), 0);
      strictEqual(parseDuration(3600), 3600);
      strictEqual(parseDuration(86_400_000), 86_400_000);
    });

    it('throws on negative numbers', () => {
      throws(() => parseDuration(-1), /Invalid duration/);
    });

    it('throws on `NaN`', () => {
      throws(() => parseDuration(NaN), /Invalid duration/);
    });

    it('throws on `Infinity`', () => {
      throws(() => parseDuration(Infinity), /Invalid duration/);
      throws(() => parseDuration(-Infinity), /Invalid duration/);
    });
  });

  describe('milliseconds', () => {
    it('parses compact', () => {
      strictEqual(parseDuration('500ms'), 500);
    });

    it('parses verbose', () => {
      strictEqual(parseDuration('1 millisecond'), 1);
      strictEqual(parseDuration('500 milliseconds'), 500);
    });
  });

  describe('seconds', () => {
    it('parses compact', () => {
      strictEqual(parseDuration('30s'), 30_000);
    });

    it('parses verbose', () => {
      strictEqual(parseDuration('1sec'), 1000);
      strictEqual(parseDuration('1 second'), 1000);
      strictEqual(parseDuration('30 seconds'), 30_000);
      strictEqual(parseDuration('30 secs'), 30_000);
    });
  });

  describe('minutes', () => {
    it('parses compact', () => {
      strictEqual(parseDuration('15m'), 900_000);
    });

    it('parses verbose', () => {
      strictEqual(parseDuration('1min'), 60_000);
      strictEqual(parseDuration('1 minute'), 60_000);
      strictEqual(parseDuration('30 minutes'), 1_800_000);
      strictEqual(parseDuration('30 mins'), 1_800_000);
    });
  });

  describe('hours', () => {
    it('parses compact', () => {
      strictEqual(parseDuration('1h'), 3_600_000);
    });

    it('parses verbose', () => {
      strictEqual(parseDuration('1hr'), 3_600_000);
      strictEqual(parseDuration('1 hour'), 3_600_000);
      strictEqual(parseDuration('24 hours'), 86_400_000);
      strictEqual(parseDuration('24 hrs'), 86_400_000);
    });
  });

  describe('days', () => {
    it('parses compact', () => {
      strictEqual(parseDuration('7d'), 604_800_000);
    });

    it('parses verbose', () => {
      strictEqual(parseDuration('1 day'), 86_400_000);
      strictEqual(parseDuration('30 days'), 2_592_000_000);
    });
  });

  describe('weeks', () => {
    it('parses compact', () => {
      strictEqual(parseDuration('1w'), 604_800_000);
    });

    it('parses verbose', () => {
      strictEqual(parseDuration('1 week'), 604_800_000);
      strictEqual(parseDuration('2 weeks'), 1_209_600_000);
    });
  });

  describe('months', () => {
    it('parses compact as 30 days', () => {
      strictEqual(parseDuration('1mo'), 2_592_000_000);
    });

    it('parses verbose', () => {
      strictEqual(parseDuration('1 month'), 2_592_000_000);
      strictEqual(parseDuration('6 months'), 15_552_000_000);
    });
  });

  describe('years', () => {
    it('parses compact as 365 days', () => {
      strictEqual(parseDuration('1y'), 31_536_000_000);
    });

    it('parses verbose', () => {
      strictEqual(parseDuration('1yr'), 31_536_000_000);
      strictEqual(parseDuration('1 year'), 31_536_000_000);
      strictEqual(parseDuration('2 years'), 63_072_000_000);
    });
  });

  describe('decimals', () => {
    it('parses fractional values', () => {
      strictEqual(parseDuration('1.5h'), 5_400_000);
      strictEqual(parseDuration('0.5s'), 500);
      strictEqual(parseDuration('2.5 minutes'), 150_000);
    });
  });

  describe('multi-segment input', () => {
    it('sums compact segments', () => {
      strictEqual(parseDuration('1h30m'), 5_400_000);
      strictEqual(parseDuration('1h 30m'), 5_400_000);
      strictEqual(parseDuration('1d 1h 1m 1s'), 90_061_000);
    });

    it('sums verbose segments', () => {
      strictEqual(parseDuration('1 hour 30 minutes'), 5_400_000);
      strictEqual(parseDuration('1 day 12 hours'), 129_600_000);
    });

    it('sums mixed compact and verbose', () => {
      strictEqual(parseDuration('1 hour 30m'), 5_400_000);
    });

    it('sums repeated units', () => {
      strictEqual(parseDuration('30m 30m'), 3_600_000);
    });
  });

  describe('case insensitivity', () => {
    it('accepts uppercase units', () => {
      strictEqual(parseDuration('1H'), 3_600_000);
      strictEqual(parseDuration('30S'), 30_000);
      strictEqual(parseDuration('1 Hour'), 3_600_000);
      strictEqual(parseDuration('1 DAY'), 86_400_000);
    });
  });

  describe('whitespace tolerance', () => {
    it('allows spaces between value and unit', () => {
      strictEqual(parseDuration('7 d'), 604_800_000);
      strictEqual(parseDuration('30  days'), 2_592_000_000);
    });

    it('trims leading and trailing whitespace', () => {
      strictEqual(parseDuration('  7d  '), 604_800_000);
      strictEqual(parseDuration(' 1 hour '), 3_600_000);
    });
  });

  describe('zero values', () => {
    it('returns 0 for zero segments', () => {
      strictEqual(parseDuration('0s'), 0);
      strictEqual(parseDuration('0d'), 0);
      strictEqual(parseDuration('0ms'), 0);
    });
  });

  describe('error cases', () => {
    it('throws on empty string', () => {
      throws(() => parseDuration(''), /Invalid duration/);
      throws(() => parseDuration('   '), /Invalid duration/);
    });

    it('throws on unknown unit', () => {
      throws(() => parseDuration('7x'), /Invalid duration/);
    });

    it('throws on missing value', () => {
      throws(() => parseDuration('days'), /Invalid duration/);
    });

    it('throws on negative string', () => {
      throws(() => parseDuration('-1d'), /Invalid duration/);
    });

    it('throws on bare numeric string', () => {
      throws(() => parseDuration('3600'), /Invalid duration/);
    });

    it('throws on garbage suffix', () => {
      throws(() => parseDuration('1h xyz'), /Invalid duration/);
    });

    it('throws on garbage between segments', () => {
      throws(() => parseDuration('1h xyz 30m'), /Invalid duration/);
    });

    it('throws on incomplete decimal', () => {
      throws(() => parseDuration('.5h'), /Invalid duration/);
      throws(() => parseDuration('1.h'), /Invalid duration/);
    });
  });
});
