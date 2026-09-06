import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { formatRelativeTime } from '../../../src/utils/i18n/format-relative-time.ts';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const YEAR = 365.25 * DAY;
const MONTH = YEAR / 12;
const NOW = Date.UTC(2025, 1, 24, 12);

function past(span: number, language = 'en'): string {
  return formatRelativeTime(NOW - span, NOW, language);
}

function future(span: number, language = 'en'): string {
  return formatRelativeTime(NOW + span, NOW, language);
}

describe('formatRelativeTime', () => {
  it('reads under 45 seconds as now', () => {
    strictEqual(past(0), 'now');
    strictEqual(past(44.5 * SECOND - 1), 'now');
    strictEqual(future(44.5 * SECOND - 1), 'now');
    strictEqual(past(30 * SECOND, 'de'), 'jetzt');
    strictEqual(past(30 * SECOND, 'bs'), 'sada');
  });

  it('reads 45 to 89 seconds as one minute', () => {
    strictEqual(past(44.5 * SECOND), '1 minute ago');
    strictEqual(past(89.5 * SECOND - 1), '1 minute ago');
    strictEqual(future(44.5 * SECOND), 'in 1 minute');
    strictEqual(past(MINUTE, 'de'), 'vor 1 Minute');
    strictEqual(future(MINUTE, 'de'), 'in 1 Minute');
    strictEqual(past(MINUTE, 'bs'), 'prije 1 minutu');
    strictEqual(future(MINUTE, 'bs'), 'za 1 minutu');
  });

  it('rounds 90 seconds to 44 minutes into minutes', () => {
    strictEqual(past(90 * SECOND), '2 minutes ago');
    strictEqual(past(2.5 * MINUTE - 1), '2 minutes ago');
    strictEqual(past(2.5 * MINUTE), '3 minutes ago');
    strictEqual(past(44.5 * MINUTE - 1), '44 minutes ago');
    strictEqual(future(44.5 * MINUTE - 1), 'in 44 minutes');
    strictEqual(past(44 * MINUTE, 'de'), 'vor 44 Minuten');
    strictEqual(future(44 * MINUTE, 'de'), 'in 44 Minuten');
    strictEqual(past(44 * MINUTE, 'bs'), 'prije 44 minute');
    strictEqual(future(44 * MINUTE, 'bs'), 'za 44 minute');
  });

  it('reads 45 to 89 minutes as one hour', () => {
    strictEqual(past(44.5 * MINUTE), '1 hour ago');
    strictEqual(past(89.5 * MINUTE - 1), '1 hour ago');
    strictEqual(future(44.5 * MINUTE), 'in 1 hour');
    strictEqual(past(HOUR, 'de'), 'vor 1 Stunde');
    strictEqual(future(HOUR, 'de'), 'in 1 Stunde');
    strictEqual(past(HOUR, 'bs'), 'prije 1 sat');
    strictEqual(future(HOUR, 'bs'), 'za 1 sat');
  });

  it('rounds 90 minutes to 21 hours into hours', () => {
    strictEqual(past(90 * MINUTE), '2 hours ago');
    strictEqual(past(2.5 * HOUR - 1), '2 hours ago');
    strictEqual(past(2.5 * HOUR), '3 hours ago');
    strictEqual(past(21.5 * HOUR - 1), '21 hours ago');
    strictEqual(future(21.5 * HOUR - 1), 'in 21 hours');
    strictEqual(past(21 * HOUR, 'de'), 'vor 21 Stunden');
    strictEqual(future(21 * HOUR, 'de'), 'in 21 Stunden');
    strictEqual(past(21 * HOUR, 'bs'), 'prije 21 sat');
    strictEqual(future(21 * HOUR, 'bs'), 'za 21 sat');
  });

  it('reads 22 to 35 hours as one day', () => {
    strictEqual(past(21.5 * HOUR), 'yesterday');
    strictEqual(past(35.5 * HOUR - 1), 'yesterday');
    strictEqual(future(21.5 * HOUR), 'tomorrow');
    strictEqual(past(DAY, 'de'), 'gestern');
    strictEqual(future(DAY, 'de'), 'morgen');
    strictEqual(past(DAY, 'bs'), 'jučer');
    strictEqual(future(DAY, 'bs'), 'sutra');
  });

  it('rounds 36 hours to 25 days into days', () => {
    strictEqual(past(36 * HOUR), '2 days ago');
    strictEqual(past(2.5 * DAY - 1), '2 days ago');
    strictEqual(past(2.5 * DAY), '3 days ago');
    strictEqual(past(25.5 * DAY - 1), '25 days ago');
    strictEqual(future(25.5 * DAY - 1), 'in 25 days');
    strictEqual(past(2 * DAY, 'de'), 'vorgestern');
    strictEqual(future(2 * DAY, 'de'), 'übermorgen');
    strictEqual(past(25 * DAY, 'de'), 'vor 25 Tagen');
    strictEqual(past(2 * DAY, 'bs'), 'prekjučer');
    strictEqual(future(2 * DAY, 'bs'), 'prekosutra');
    strictEqual(past(25 * DAY, 'bs'), 'prije 25 dana');
  });

  it('reads 26 to 45 days as one month', () => {
    strictEqual(past(25.5 * DAY), 'last month');
    strictEqual(past(45.5 * DAY - 1), 'last month');
    strictEqual(future(25.5 * DAY), 'next month');
    strictEqual(past(30 * DAY, 'de'), 'letzten Monat');
    strictEqual(future(30 * DAY, 'de'), 'nächsten Monat');
    strictEqual(past(30 * DAY, 'bs'), 'prošli mjesec');
    strictEqual(future(30 * DAY, 'bs'), 'sljedeći mjesec');
  });

  it('rounds 46 days to 10 months into months', () => {
    strictEqual(past(46 * DAY), '2 months ago');
    strictEqual(past(2.5 * MONTH - 1), '2 months ago');
    strictEqual(past(2.5 * MONTH), '3 months ago');
    strictEqual(past(10.5 * MONTH - 1), '10 months ago');
    strictEqual(future(10.5 * MONTH - 1), 'in 10 months');
    strictEqual(past(10 * MONTH, 'de'), 'vor 10 Monaten');
    strictEqual(future(10 * MONTH, 'de'), 'in 10 Monaten');
    strictEqual(past(10 * MONTH, 'bs'), 'prije 10 mjeseci');
    strictEqual(future(10 * MONTH, 'bs'), 'za 10 mjeseci');
  });

  it('reads 11 to 17 months as one year', () => {
    strictEqual(past(10.5 * MONTH), 'last year');
    strictEqual(past(17.5 * MONTH - 1), 'last year');
    strictEqual(future(10.5 * MONTH), 'next year');
    strictEqual(past(YEAR, 'de'), 'letztes Jahr');
    strictEqual(future(YEAR, 'de'), 'nächstes Jahr');
    strictEqual(past(YEAR, 'bs'), 'prošle godine');
    strictEqual(future(YEAR, 'bs'), 'sljedeće godine');
  });

  it('rounds 18 months and beyond into years', () => {
    strictEqual(past(18 * MONTH), '2 years ago');
    strictEqual(past(2.5 * YEAR - 1), '2 years ago');
    strictEqual(past(2.5 * YEAR), '3 years ago');
    strictEqual(future(10 * YEAR), 'in 10 years');
    strictEqual(past(10 * YEAR, 'de'), 'vor 10 Jahren');
    strictEqual(future(2 * YEAR, 'de'), 'in 2 Jahren');
    strictEqual(past(10 * YEAR, 'bs'), 'prije 10 godina');
    strictEqual(future(2 * YEAR, 'bs'), 'za 2 godine');
  });

  it('keeps each language its own formatter', () => {
    strictEqual(past(DAY, 'en'), 'yesterday');
    strictEqual(past(DAY, 'de'), 'gestern');
    strictEqual(past(DAY, 'bs'), 'jučer');
    strictEqual(past(DAY, 'en'), 'yesterday');
    strictEqual(past(DAY, 'de'), 'gestern');
  });
});
