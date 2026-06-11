import { strictEqual, throws } from 'node:assert';
import { describe, it } from 'node:test';

import { formatDuration, parseDuration } from '../../../src/utils/index.ts';

const EN = { locale: 'en' } as const;

describe('formatDuration', () => {
  describe('narrow (default style)', () => {
    it('formats zero', () => {
      strictEqual(formatDuration(0, EN), '0ms');
    });

    it('formats sub-second values', () => {
      strictEqual(formatDuration(1, EN), '1ms');
      strictEqual(formatDuration(500, EN), '500ms');
    });

    it('formats single units', () => {
      strictEqual(formatDuration(1000, EN), '1s');
      strictEqual(formatDuration(60_000, EN), '1m');
      strictEqual(formatDuration(3_600_000, EN), '1h');
      strictEqual(formatDuration(86_400_000, EN), '1d');
    });

    it('formats compound durations greedy from days down', () => {
      strictEqual(formatDuration(1500, EN), '1s 500ms');
      strictEqual(formatDuration(90_000, EN), '1m 30s');
      strictEqual(formatDuration(90_061_000, EN), '1d 1h 1m 1s');
    });

    it('omits zero units in the middle', () => {
      strictEqual(formatDuration(86_400_000 + 1000, EN), '1d 1s');
      strictEqual(formatDuration(3_600_000 + 500, EN), '1h 500ms');
    });

    it('counts large day spans rather than weeks', () => {
      strictEqual(formatDuration(604_800_000, EN), '7d');
      strictEqual(formatDuration(31_536_000_000, EN), '365d');
    });

    it('rounds fractional milliseconds to the nearest integer', () => {
      strictEqual(formatDuration(0.4, EN), '0ms');
      strictEqual(formatDuration(0.5, EN), '1ms');
      strictEqual(formatDuration(1500.5, EN), '1s 501ms');
    });
  });

  describe('short style', () => {
    it('uses abbreviated unit names', () => {
      strictEqual(formatDuration(1000, { locale: 'en', style: 'short' }), '1 sec');
      strictEqual(formatDuration(90_000, { locale: 'en', style: 'short' }), '1 min, 30 sec');
    });
  });

  describe('long style', () => {
    it('uses full unit names with English pluralization', () => {
      strictEqual(formatDuration(1000, { locale: 'en', style: 'long' }), '1 second');
      strictEqual(formatDuration(2000, { locale: 'en', style: 'long' }), '2 seconds');
      strictEqual(formatDuration(86_400_000, { locale: 'en', style: 'long' }), '1 day');
      strictEqual(
        formatDuration(90_061_000, { locale: 'en', style: 'long' }),
        '1 day, 1 hour, 1 minute, 1 second',
      );
    });

    it('formats zero', () => {
      strictEqual(formatDuration(0, { locale: 'en', style: 'long' }), '0 milliseconds');
    });
  });

  describe('localization', () => {
    it('renders German unit names', () => {
      strictEqual(
        formatDuration(90_061_000, { locale: 'de', style: 'long' }),
        '1 Tag, 1 Stunde, 1 Minute und 1 Sekunde',
      );
    });

    it('renders Spanish unit names with locale-correct joiners', () => {
      strictEqual(
        formatDuration(5_400_000, { locale: 'es', style: 'long' }),
        '1 hora y 30 minutos',
      );
    });

    it('applies plural rules per locale', () => {
      strictEqual(formatDuration(1000, { locale: 'pl', style: 'long' }), '1 sekunda');
      strictEqual(formatDuration(2000, { locale: 'pl', style: 'long' }), '2 sekundy');
      strictEqual(formatDuration(5000, { locale: 'pl', style: 'long' }), '5 sekund');
    });
  });

  describe('round-trip with parseDuration', () => {
    it('parseDuration accepts the default narrow English output', () => {
      const cases = [1, 500, 1000, 1500, 60_000, 90_000, 3_600_000, 90_061_000];
      for (const ms of cases) {
        strictEqual(parseDuration(formatDuration(ms, EN)), ms);
      }
    });
  });

  describe('error cases', () => {
    it('throws on negative input', () => {
      throws(() => formatDuration(-1), /Invalid duration/);
    });

    it('throws on `NaN`', () => {
      throws(() => formatDuration(NaN), /Invalid duration/);
    });

    it('throws on `Infinity`', () => {
      throws(() => formatDuration(Infinity), /Invalid duration/);
      throws(() => formatDuration(-Infinity), /Invalid duration/);
    });
  });
});
