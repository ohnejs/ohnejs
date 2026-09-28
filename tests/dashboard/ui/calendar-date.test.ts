import { strictEqual, throws } from 'node:assert';
import { describe, it } from 'node:test';

import {
  type ZonedDate,
  addZonedMonths,
  addZonedYears,
  clampZoned,
  daysInMonth,
  parseDateInput,
  parseDateTime,
  parseTimeSpan,
  resolveTimezone,
  startOfZonedDay,
  timezones,
  zonedFromTimestamp,
  zonedFromWallClock,
} from '../../../src/dashboard/ui/calendar-date.ts';

const NY = 'America/New_York';
const BERLIN = 'Europe/Berlin';

// The reference instant seeds the offset that resolves DST overlaps, so its season matters.
const WINTER = Date.UTC(2024, 0, 15, 12);
const SUMMER = Date.UTC(2024, 6, 15, 12);

function fields(date: ZonedDate): string {
  return `${date.year}-${date.month}-${date.day} ${date.hour}:${date.minute}:${date.second}`;
}

describe('zonedFromWallClock', () => {
  it('parses plain wall times in UTC', () => {
    const date = zonedFromWallClock('UTC', 2024, 3, 5);
    strictEqual(date.timestamp, 1709596800000);
    strictEqual(fields(date), '2024-3-5 0:0:0');
    strictEqual(date.weekday, 2);
    strictEqual(date.offset, 0);
    strictEqual(date.zone, 'UTC');
    strictEqual(zonedFromWallClock('UTC', 2024, 3, 5, 14, 30, 0).timestamp, 1709649000000);
    strictEqual(zonedFromWallClock('UTC', 2024, 12, 15).timestamp, 1734220800000);
    strictEqual(zonedFromWallClock('UTC', 2024, 12, 15).weekday, 0);
  });

  it('parses plain wall times in a real zone regardless of the seed season', () => {
    for (const reference of [WINTER, SUMMER]) {
      const summer = zonedFromWallClock(NY, 2024, 6, 15, 12, 0, 0, reference);
      strictEqual(summer.timestamp, 1718467200000);
      strictEqual(summer.offset, -240);
      const winter = zonedFromWallClock(NY, 2024, 1, 15, 0, 0, 0, reference);
      strictEqual(winter.timestamp, 1705294800000);
      strictEqual(winter.offset, -300);
      strictEqual(winter.weekday, 1);
    }
  });

  it('rolls a DST-gap wall time forward, independent of the seed', () => {
    for (const reference of [WINTER, SUMMER]) {
      const half = zonedFromWallClock(NY, 2024, 3, 10, 2, 30, 0, reference);
      strictEqual(half.timestamp, 1710055800000);
      strictEqual(fields(half), '2024-3-10 3:30:0');
      strictEqual(half.offset, -240);
      const start = zonedFromWallClock(NY, 2024, 3, 10, 2, 0, 0, reference);
      strictEqual(start.timestamp, 1710054000000);
      strictEqual(start.hour, 3);
      const berlin = zonedFromWallClock(BERLIN, 2024, 3, 31, 2, 30, 0, reference);
      strictEqual(berlin.timestamp, 1711848600000);
      strictEqual(fields(berlin), '2024-3-31 3:30:0');
      strictEqual(berlin.offset, 120);
    }
  });

  it('resolves a DST-overlap wall time to the occurrence matching the seed offset', () => {
    const winter = zonedFromWallClock(NY, 2024, 11, 3, 1, 30, 0, WINTER);
    strictEqual(winter.timestamp, 1730615400000);
    strictEqual(winter.offset, -300);
    const summer = zonedFromWallClock(NY, 2024, 11, 3, 1, 30, 0, SUMMER);
    strictEqual(summer.timestamp, 1730611800000);
    strictEqual(summer.offset, -240);
    strictEqual(fields(winter), fields(summer));
    strictEqual(winter.timestamp - summer.timestamp, 3600000);
    strictEqual(zonedFromWallClock(NY, 2024, 11, 3, 1, 0, 0, WINTER).timestamp, 1730613600000);
    strictEqual(zonedFromWallClock(NY, 2024, 11, 3, 1, 0, 0, SUMMER).timestamp, 1730610000000);
    strictEqual(
      zonedFromWallClock(BERLIN, 2024, 10, 27, 2, 30, 0, WINTER).timestamp,
      1729992600000,
    );
    strictEqual(zonedFromWallClock(BERLIN, 2024, 10, 27, 2, 30, 0, WINTER).offset, 60);
    strictEqual(
      zonedFromWallClock(BERLIN, 2024, 10, 27, 2, 30, 0, SUMMER).timestamp,
      1729989000000,
    );
    strictEqual(zonedFromWallClock(BERLIN, 2024, 10, 27, 2, 30, 0, SUMMER).offset, 120);
  });

  it('handles local-mean-time offsets with second precision', () => {
    const berlin = zonedFromWallClock(BERLIN, 1880, 1, 1, 0, 0, 0, WINTER);
    strictEqual(berlin.timestamp, -2840144008000);
    strictEqual(berlin.offset, 53.46666666666667);
    strictEqual(fields(berlin), '1880-1-1 0:0:0');
    const ny = zonedFromWallClock(NY, 1880, 1, 1, 0, 0, 0, WINTER);
    strictEqual(ny.timestamp, -2840123038000);
    strictEqual(ny.offset, -296.03333333333336);
  });

  it('keeps years before 1000 intact', () => {
    const date = zonedFromWallClock('UTC', 100, 1, 1, 0, 0, 0, WINTER);
    strictEqual(date.timestamp, -59011459200000);
    strictEqual(date.year, 100);
  });

  it('rolls over out-of-range days like Date', () => {
    const date = zonedFromWallClock('UTC', 2024, 2, 31);
    strictEqual(date.timestamp, Date.UTC(2024, 1, 31));
    strictEqual(fields(date), '2024-3-2 0:0:0');
  });
});

describe('zonedFromTimestamp', () => {
  it('keeps the instant and reads the wall clock in the zone', () => {
    const epoch = zonedFromTimestamp(0, NY);
    strictEqual(epoch.timestamp, 0);
    strictEqual(fields(epoch), '1969-12-31 19:0:0');
    strictEqual(epoch.weekday, 3);
    strictEqual(epoch.offset, -300);
    const summer = zonedFromTimestamp(1500000000123, NY);
    strictEqual(fields(summer), '2017-7-13 22:40:0');
    strictEqual(summer.millisecond, 123);
    strictEqual(summer.offset, -240);
  });

  it('survives the extreme default bounds', () => {
    const min = zonedFromTimestamp(-59011459200000, 'UTC');
    strictEqual(fields(min), '100-1-1 0:0:0');
    strictEqual(min.weekday, 5);
    const max = zonedFromTimestamp(8640000000000000, 'UTC');
    strictEqual(fields(max), '275760-9-13 0:0:0');
    strictEqual(max.weekday, 6);
    const maxNY = zonedFromTimestamp(8640000000000000, NY);
    strictEqual(fields(maxNY), '275760-9-12 20:0:0');
    strictEqual(maxNY.offset, -240);
  });

  it('reads the minimum bound in a second-precision offset era', () => {
    const min = zonedFromTimestamp(-59011459200000, BERLIN);
    strictEqual(min.timestamp, -59011459200000);
    strictEqual(fields(min), '100-1-1 0:53:28');
    strictEqual(min.offset, 53.46666666666667);
  });

  it('crosses day boundaries when converting', () => {
    const berlin = zonedFromTimestamp(Date.UTC(2024, 5, 30, 22, 30), BERLIN);
    strictEqual(fields(berlin), '2024-7-1 0:30:0');
    strictEqual(berlin.weekday, 1);
    strictEqual(berlin.offset, 120);
  });

  it('keeps the offset whole before 1970 when the instant has milliseconds', () => {
    const utc = zonedFromTimestamp(-1500, 'UTC');
    strictEqual(fields(utc), '1969-12-31 23:59:58');
    strictEqual(utc.millisecond, 500);
    strictEqual(utc.offset, 0);
    strictEqual(zonedFromTimestamp(-250, NY).offset, -300);
  });
});

describe('startOfZonedDay', () => {
  it('finds wall midnight in the zone', () => {
    const noon = zonedFromTimestamp(Date.UTC(2024, 6, 15, 16), NY);
    strictEqual(startOfZonedDay(noon, WINTER).timestamp, 1721016000000);
    strictEqual(startOfZonedDay(noon, SUMMER).timestamp, 1721016000000);
  });

  it('is seed-independent on DST transition days when midnight itself is unambiguous', () => {
    const spring = zonedFromTimestamp(Date.UTC(2024, 2, 10, 16), NY);
    for (const reference of [WINTER, SUMMER]) {
      const start = startOfZonedDay(spring, reference);
      strictEqual(start.timestamp, 1710046800000);
      strictEqual(start.offset, -300);
    }
    const fall = zonedFromTimestamp(Date.UTC(2024, 10, 3, 16), NY);
    for (const reference of [WINTER, SUMMER]) {
      const start = startOfZonedDay(fall, reference);
      strictEqual(start.timestamp, 1730606400000);
      strictEqual(start.offset, -240);
    }
    const berlin = zonedFromTimestamp(Date.UTC(2024, 2, 31, 12), BERLIN);
    strictEqual(startOfZonedDay(berlin, WINTER).timestamp, 1711839600000);
  });

  it('rolls forward when midnight falls into a DST gap', () => {
    // Chile starts DST at midnight, so 2019-09-08 00:00 does not exist.
    const day = zonedFromTimestamp(Date.UTC(2019, 8, 8, 15), 'America/Santiago');
    const start = startOfZonedDay(day, WINTER);
    strictEqual(start.timestamp, 1567915200000);
    strictEqual(start.hour, 1);
    strictEqual(start.offset, -180);
  });
});

describe('addZonedMonths', () => {
  it('moves the wall clock and keeps the captured offset across DST changes', () => {
    const march = zonedFromWallClock(NY, 2024, 3, 1, 0, 0, 0, WINTER);
    const april = addZonedMonths(march, 1);
    strictEqual(april.timestamp, 1711947600000);
    strictEqual(fields(april), '2024-4-1 0:0:0');
    strictEqual(april.offset, -300);
    strictEqual(april.weekday, 1);
    const back = addZonedMonths(zonedFromWallClock(NY, 2024, 4, 1, 0, 0, 0, WINTER), -1);
    strictEqual(back.timestamp, 1709265600000);
    strictEqual(back.offset, -240);
  });

  it('clamps the day to the target month length', () => {
    const leap = addZonedMonths(zonedFromWallClock(NY, 2024, 1, 31, 10, 0, 0, WINTER), 1);
    strictEqual(leap.timestamp, 1709218800000);
    strictEqual(fields(leap), '2024-2-29 10:0:0');
    const plain = addZonedMonths(zonedFromWallClock(NY, 2023, 1, 31, 0, 0, 0, WINTER), 1);
    strictEqual(plain.timestamp, 1677560400000);
    strictEqual(plain.day, 28);
    const shorter = addZonedMonths(zonedFromWallClock(NY, 2024, 5, 31, 0, 0, 0, WINTER), -1);
    strictEqual(shorter.timestamp, 1714449600000);
    strictEqual(shorter.day, 30);
  });

  it('crosses year boundaries in both directions', () => {
    const december = addZonedMonths(zonedFromWallClock('UTC', 2024, 1, 1), -1);
    strictEqual(december.timestamp, 1701388800000);
    strictEqual(`${december.year}-${december.month}`, '2023-12');
    const january = addZonedMonths(zonedFromWallClock('UTC', 2024, 12, 1), 1);
    strictEqual(january.timestamp, 1735689600000);
    strictEqual(`${january.year}-${january.month}`, '2025-1');
    const far = addZonedMonths(zonedFromWallClock('UTC', 2024, 3, 15), -13);
    strictEqual(far.timestamp, Date.UTC(2023, 1, 15));
    strictEqual(`${far.year}-${far.month}-${far.day}`, '2023-2-15');
    const berlin = addZonedMonths(zonedFromWallClock(BERLIN, 2024, 10, 1, 0, 0, 0, WINTER), 1);
    strictEqual(berlin.timestamp, 1730412000000);
    strictEqual(berlin.offset, 120);
  });
});

describe('addZonedYears', () => {
  it('clamps February 29 in a non-leap target year', () => {
    const clamped = addZonedYears(zonedFromWallClock(NY, 2024, 2, 29, 0, 0, 0, WINTER), 1);
    strictEqual(clamped.timestamp, 1740718800000);
    strictEqual(fields(clamped), '2025-2-28 0:0:0');
    const backward = addZonedYears(zonedFromWallClock('UTC', 2024, 2, 29), -1);
    strictEqual(backward.timestamp, Date.UTC(2023, 1, 28));
  });

  it('keeps day and time when no clamp applies', () => {
    const next = addZonedYears(zonedFromWallClock('UTC', 2024, 3, 5, 14, 30), 1);
    strictEqual(next.timestamp, Date.UTC(2025, 2, 5, 14, 30));
    strictEqual(next.weekday, 3);
  });
});

describe('clampZoned', () => {
  const min = zonedFromWallClock('UTC', 2024, 3, 1);
  const max = zonedFromWallClock('UTC', 2024, 3, 31);

  it('returns the input objects themselves', () => {
    const inside = zonedFromWallClock('UTC', 2024, 3, 15);
    strictEqual(clampZoned(inside, min, max), inside);
    strictEqual(clampZoned(zonedFromWallClock('UTC', 2024, 2, 1), min, max), min);
    strictEqual(clampZoned(zonedFromWallClock('UTC', 2024, 4, 15), min, max), max);
  });

  it('keeps the date itself on an exact tie', () => {
    const tie = zonedFromWallClock('UTC', 2024, 3, 1);
    strictEqual(clampZoned(tie, min, max), tie);
  });
});

describe('daysInMonth', () => {
  it('knows month lengths and leap rules', () => {
    strictEqual(daysInMonth(2024, 2), 29);
    strictEqual(daysInMonth(2023, 2), 28);
    strictEqual(daysInMonth(1900, 2), 28);
    strictEqual(daysInMonth(2000, 2), 29);
    strictEqual(daysInMonth(100, 2), 28);
    strictEqual(daysInMonth(2024, 1), 31);
    strictEqual(daysInMonth(2024, 4), 30);
    strictEqual(daysInMonth(2024, 12), 31);
  });
});

describe('parseDateInput', () => {
  it('passes numbers through', () => {
    strictEqual(parseDateInput(1734220800000), 1734220800000);
  });

  it('reads unzoned strings as local time', () => {
    strictEqual(parseDateInput('2024-12-15'), new Date(2024, 11, 15).getTime());
    strictEqual(parseDateInput('2024'), new Date(2024, 0, 1).getTime());
    strictEqual(parseDateInput('2024/03/05'), new Date(2024, 2, 5).getTime());
    strictEqual(parseDateInput('2024-12-15 13:45'), new Date(2024, 11, 15, 13, 45).getTime());
    strictEqual(
      parseDateInput('2024-12-15T13:45:30.250'),
      new Date(2024, 11, 15, 13, 45, 30, 250).getTime(),
    );
  });

  it('reads Z-suffixed strings as UTC via the Date parser', () => {
    strictEqual(parseDateInput('2024-12-15T00:00:00.000Z'), 1734220800000);
  });
});

describe('parseDateTime', () => {
  it('parses through Date.parse, so date-only strings are UTC', () => {
    strictEqual(parseDateTime(1734220800000), 1734220800000);
    strictEqual(parseDateTime('2024-12-15T00:00:00.000Z'), 1734220800000);
    strictEqual(parseDateTime('2024'), 1704067200000);
  });
});

describe('parseTimeSpan', () => {
  it('passes numbers through and sums objects', () => {
    strictEqual(parseTimeSpan(1800000), 1800000);
    strictEqual(parseTimeSpan({ hours: 1 }), 3600000);
    strictEqual(parseTimeSpan({ days: 1, hours: 2 }), 93600000);
    strictEqual(parseTimeSpan({ minutes: 1, seconds: 30 }), 90000);
    strictEqual(parseTimeSpan({}), 0);
  });

  it('parses jose-style duration strings', () => {
    strictEqual(parseTimeSpan('1 hour'), 3600000);
    strictEqual(parseTimeSpan('30 minutes'), 1800000);
    strictEqual(parseTimeSpan('2 hours'), 7200000);
    strictEqual(parseTimeSpan('1.5 minutes'), 90000);
    strictEqual(parseTimeSpan('90 s'), 90000);
    strictEqual(parseTimeSpan('3 days'), 259200000);
    strictEqual(parseTimeSpan('1 week'), 604800000);
    strictEqual(parseTimeSpan('1 year'), 31557600000);
    strictEqual(parseTimeSpan('1.5 seconds'), 2000);
  });

  it('honors sign and ago/from now suffixes', () => {
    strictEqual(parseTimeSpan('1 minute ago'), -60000);
    strictEqual(parseTimeSpan('-1 minute'), -60000);
    strictEqual(parseTimeSpan('+2 hours'), 7200000);
    strictEqual(parseTimeSpan('1 minute from now'), 60000);
    strictEqual(parseTimeSpan('1 minute AGO'), -60000);
  });

  it('throws on malformed durations', () => {
    throws(() => parseTimeSpan('eventually'), TypeError);
    throws(() => parseTimeSpan('-1 minute ago'), TypeError);
    throws(() => parseTimeSpan('1 month'), TypeError);
  });
});

describe('resolveTimezone', () => {
  it('passes real zones through and resolves empty or local to the environment zone', () => {
    strictEqual(resolveTimezone('Europe/Berlin'), 'Europe/Berlin');
    const guessed = Intl.DateTimeFormat().resolvedOptions().timeZone;
    strictEqual(resolveTimezone(), guessed);
    strictEqual(resolveTimezone(''), guessed);
    strictEqual(resolveTimezone('local'), guessed);
  });
});

describe('timezones', () => {
  it('carries the full IANA zone list', () => {
    strictEqual(timezones.length, 598);
    strictEqual(timezones.includes('Europe/Berlin'), true);
    strictEqual(timezones.includes('UTC'), true);
    strictEqual(timezones.includes('America/New_York'), true);
  });
});
