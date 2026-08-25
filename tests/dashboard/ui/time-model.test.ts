import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import {
  composeTime,
  parseTime,
  timeRangeBounds,
  timeSegmentBounds,
} from '../../../src/dashboard/ui/time-model.ts';

describe('parseTime', () => {
  it('passes numbers through', () => {
    strictEqual(parseTime(3600000), 3600000);
  });

  it('parses ISO time strings', () => {
    strictEqual(parseTime('01:00:00'), 3600000);
    strictEqual(parseTime('01:00'), 3600000);
    strictEqual(parseTime('23:59:59'), 86399000);
  });

  it('sums a parts object', () => {
    strictEqual(parseTime({ hours: 1, minutes: 30, seconds: 15 }), 5415000);
    strictEqual(parseTime({}), 0);
  });
});

describe('composeTime', () => {
  it('composes segments into ms', () => {
    strictEqual(composeTime(1, 30, 0, 0, 86399000), 5400000);
  });

  it('clamps into the bounds', () => {
    strictEqual(composeTime(0, 0, 0, 3600000, 86399000), 3600000);
    strictEqual(composeTime(23, 59, 59, 0, 7200000), 7200000);
  });
});

describe('timeSegmentBounds', () => {
  it('frees every segment across a full day', () => {
    deepStrictEqual(timeSegmentBounds(43200000, 0, 86399000), {
      minHours: 0,
      maxHours: 23,
      minMinutes: 0,
      maxMinutes: 59,
      minSeconds: 0,
      maxSeconds: 59,
    });
  });

  it('binds the lower segments at the min hour and minute', () => {
    const min = parseTime('01:30:15');
    deepStrictEqual(timeSegmentBounds(min, min, 86399000), {
      minHours: 1,
      maxHours: 23,
      minMinutes: 30,
      maxMinutes: 59,
      minSeconds: 15,
      maxSeconds: 59,
    });
  });

  it('frees the seconds past the min minute', () => {
    const min = parseTime('01:30:15');
    const bounds = timeSegmentBounds(parseTime('01:31:00'), min, 86399000);
    strictEqual(bounds.minMinutes, 30);
    strictEqual(bounds.minSeconds, 0);
  });

  it('frees the minutes past the min hour', () => {
    const bounds = timeSegmentBounds(parseTime('02:00:00'), parseTime('01:30:15'), 86399000);
    strictEqual(bounds.minMinutes, 0);
    strictEqual(bounds.minSeconds, 0);
  });

  it('binds the lower segments at the max hour and minute', () => {
    const max = parseTime('02:15:45');
    deepStrictEqual(timeSegmentBounds(max, 0, max), {
      minHours: 0,
      maxHours: 2,
      minMinutes: 0,
      maxMinutes: 15,
      minSeconds: 0,
      maxSeconds: 45,
    });
  });

  it('frees the lower segments below the max', () => {
    const max = parseTime('02:15:45');
    const bounds = timeSegmentBounds(parseTime('01:00:00'), 0, max);
    strictEqual(bounds.maxMinutes, 59);
    strictEqual(bounds.maxSeconds, 59);
  });

  it('zeroes the lower segments above the max', () => {
    const max = parseTime('02:15:45');
    const bounds = timeSegmentBounds(parseTime('03:00:00'), 0, max);
    strictEqual(bounds.maxMinutes, 0);
    strictEqual(bounds.maxSeconds, 0);
  });

  it('frees the seconds below the max minute', () => {
    const max = parseTime('02:15:45');
    const bounds = timeSegmentBounds(parseTime('02:10:50'), 0, max);
    strictEqual(bounds.maxMinutes, 15);
    strictEqual(bounds.maxSeconds, 59);
  });

  it('zeroes the seconds above the max minute', () => {
    const max = parseTime('02:15:45');
    const bounds = timeSegmentBounds(parseTime('02:20:00'), 0, max);
    strictEqual(bounds.maxSeconds, 0);
  });
});

describe('timeRangeBounds', () => {
  it('spans the whole day without range limits', () => {
    deepStrictEqual(timeRangeBounds([3600000, 7200000], 0, 86399000, 0, 86399000), {
      minFrom: 0,
      maxFrom: 7200000,
      minTo: 3600000,
      maxTo: 86399000,
    });
  });

  it('keeps the sides apart by the min range', () => {
    const bounds = timeRangeBounds([3600000, 7200000], 0, 86399000, 1800000, 86399000);
    strictEqual(bounds.maxFrom, 5400000);
    strictEqual(bounds.minTo, 5400000);
  });

  it('keeps the sides within the max range', () => {
    const bounds = timeRangeBounds([3600000, 7200000], 0, 86399000, 0, 3600000);
    strictEqual(bounds.minFrom, 3600000);
    strictEqual(bounds.maxTo, 7200000);
  });

  it('clamps the range limits to min and max', () => {
    const bounds = timeRangeBounds([3600000, 7200000], 1800000, 9000000, 0, 86399000);
    strictEqual(bounds.minFrom, 1800000);
    strictEqual(bounds.maxTo, 9000000);
  });
});
