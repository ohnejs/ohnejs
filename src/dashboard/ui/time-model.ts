import { isNumber } from '../../utils/is/is-number.ts';
import { isString } from '../../utils/is/is-string.ts';
import { clamp } from '../../utils/number/clamp.ts';

/**
 * A time-of-day value: ms within a day, an ISO 8601 time string, or a parts object.
 */
export type TimeValue = number | string | { hours?: number; minutes?: number; seconds?: number };

/**
 * A time span: ms, a human-readable duration string, or a parts object.
 */
export type TimeSpanValue =
  | number
  | string
  | { days?: number; hours?: number; minutes?: number; seconds?: number };

/**
 * The per-segment bounds of a `time` input, cascading from its `min` and `max` times.
 */
export interface TimeSegmentBounds {
  /**
   * The lowest selectable hour.
   */
  minHours: number;

  /**
   * The highest selectable hour.
   */
  maxHours: number;

  /**
   * The lowest selectable minute at the current hour.
   */
  minMinutes: number;

  /**
   * The highest selectable minute at the current hour.
   */
  maxMinutes: number;

  /**
   * The lowest selectable second at the current hour and minute.
   */
  minSeconds: number;

  /**
   * The highest selectable second at the current hour and minute.
   */
  maxSeconds: number;
}

/**
 * The per-side bounds of a `timeRange` input.
 */
export interface TimeRangeBounds {
  /**
   * The lowest selectable start time in ms.
   */
  minFrom: number;

  /**
   * The highest selectable start time in ms.
   */
  maxFrom: number;

  /**
   * The lowest selectable end time in ms.
   */
  minTo: number;

  /**
   * The highest selectable end time in ms.
   */
  maxTo: number;
}

/**
 * Parses a time-of-day value into ms.
 * A number passes through.
 * A string parses as `Date.parse('1970-01-01T' + time + 'Z')`.
 * A parts object sums its `hours`, `minutes`, and `seconds`.
 */
export function parseTime(time: TimeValue): number {
  if (isNumber(time)) return time;
  if (isString(time)) return Date.parse(`1970-01-01T${time}Z`);
  const { hours = 0, minutes = 0, seconds = 0 } = time;
  return (hours * 3600 + minutes * 60 + seconds) * 1000;
}

/**
 * Composes hour, minute, and second segments into a time-of-day value in ms, clamped to `[min, max]`.
 */
export function composeTime(
  hours: number,
  minutes: number,
  seconds: number,
  min: number,
  max: number,
): number {
  return clamp((hours * 3600 + minutes * 60 + seconds) * 1000, min, max);
}

/**
 * Derives the segment bounds of a `time` input at `value` ms, given `min` and `max` times in ms.
 * The bounds cascade: a mid-range hour frees the minute segment, a mid-range minute frees the seconds.
 */
export function timeSegmentBounds(value: number, min: number, max: number): TimeSegmentBounds {
  const hours = Math.floor(value / 1000 / 3600);
  const minutes = Math.floor(((value / 1000) % 3600) / 60);
  const minHours = Math.floor(min / 1000 / 3600);
  const maxHours = Math.floor(max / 1000 / 3600);
  const minMinutes = hours === minHours ? Math.floor(((min / 1000) % 3600) / 60) : 0;
  const maxMinutes =
    hours < maxHours ? 59 : hours > maxHours ? 0 : Math.floor(((max / 1000) % 3600) / 60);
  const minSeconds =
    hours === minHours && minutes === minMinutes ? Math.floor((min / 1000) % 60) : 0;
  const maxSeconds =
    hours < maxHours || (hours === maxHours && minutes < maxMinutes)
      ? 59
      : hours === maxHours && minutes === maxMinutes
        ? Math.floor((max / 1000) % 60)
        : 0;
  return { minHours, maxHours, minMinutes, maxMinutes, minSeconds, maxSeconds };
}

/**
 * Derives the per-side bounds of a `timeRange` input.
 * `value` is the current `[from, to]` tuple; `min`, `max`, `minRange`, and `maxRange` are ms.
 */
export function timeRangeBounds(
  value: readonly [number, number],
  min: number,
  max: number,
  minRange: number,
  maxRange: number,
): TimeRangeBounds {
  return {
    minFrom: Math.max(value[1] - maxRange, min),
    maxFrom: value[1] - minRange,
    minTo: value[0] + minRange,
    maxTo: Math.min(value[0] + maxRange, max),
  };
}
