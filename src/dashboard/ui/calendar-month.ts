import type { CalendarLabels } from './calendar.ts';

import { css } from '../render/css.ts';
import { h } from '../render/h.ts';
import {
  type ZonedDate,
  addZonedMonths,
  daysInMonth,
  zonedFromWallClock,
} from './calendar-date.ts';
import './tokens.ts';

/**
 * Options for `calendarMonth`.
 */
export interface CalendarMonthOptions {
  /**
   * Reports the selected date reactively, or `null` when nothing is selected.
   */
  modelValue: () => ZonedDate | null;

  /**
   * Reports the displayed year reactively.
   */
  year: () => number;

  /**
   * Reports the displayed month reactively, `1` (January) to `12` (December).
   */
  month: () => number;

  /**
   * Reports the minimum allowed date reactively.
   */
  min: () => ZonedDate;

  /**
   * Reports the maximum allowed date reactively.
   */
  max: () => ZonedDate;

  /**
   * The starting day of the week, `0` (Sunday) to `6` (Saturday).
   */
  startDay: number;

  /**
   * The current date.
   */
  today: ZonedDate;

  /**
   * Resolves the IANA time zone the grid is computed in.
   */
  resolveTimezone: () => string;

  /**
   * The labels of the calendar; the grid uses `daysShort` and `selectDate`.
   */
  labels: Required<CalendarLabels>;

  /**
   * Called with the clicked day of the month and the click event.
   */
  onSelectDay?: (day: number, event: MouseEvent) => void;
}

interface DayCell {
  day: number;
  disabled: boolean;
  selected: boolean;
  isToday: boolean;
}

css`
  .ohne-calendar-month {
    table-layout: fixed;
    padding: calc(0.5em - 0.0625rem);
    border-collapse: separate;
    border-spacing: 0;
    text-indent: 0;
    vertical-align: middle;
  }

  .ohne-calendar-month :where(th, td) {
    width: calc(2.5em + 0.125rem);
    height: calc(2.5em + 0.125rem);
    padding: 0.0625rem;
    text-align: center;
  }

  .ohne-calendar-month :where(th) {
    font-size: calc(1em - 0.0625rem);
    font-weight: 500;
    color: hsl(var(--ohne-muted-foreground));
  }

  .ohne-calendar-day-button {
    position: relative;
    display: flex;
    justify-content: center;
    align-items: center;
    width: 2.5em;
    height: 2.5em;
    border-radius: calc(var(--ohne-radius) - 0.125rem);
    background-color: transparent;
    color: hsl(var(--ohne-foreground));
    text-decoration: none;
    transition: var(--ohne-transition);
    transition-property: background-color, box-shadow, color;
  }

  .ohne-calendar-day-button:hover {
    background-color: hsl(var(--ohne-secondary));
    color: hsl(var(--ohne-secondary-foreground));
  }

  .ohne-calendar-day-button:focus-visible {
    box-shadow:
      0 0 0 0.125rem hsl(var(--ohne-ring)),
      0 0 #0000;
    outline: none;
  }

  .ohne-calendar-day-button-disabled {
    pointer-events: none;
    opacity: 0.36;
  }

  .ohne-calendar-day-button:not(.ohne-calendar-day-button-disabled) {
    font-weight: 500;
  }

  .ohne-calendar-day-button-selected {
    background-color: hsl(var(--ohne-primary));
    color: hsl(var(--ohne-primary-foreground));
  }

  .ohne-calendar-day-button-selected:hover {
    background-color: hsl(var(--ohne-primary) / 0.9);
    color: hsl(var(--ohne-primary-foreground));
  }

  .ohne-calendar-day-button-today::before {
    content: '';
    position: absolute;
    bottom: 0.325em;
    left: 50%;
    width: 0.25em;
    height: 0.25em;
    margin-left: -0.125em;
    background-color: hsl(var(--ohne-primary));
    border-radius: 50%;
  }

  .ohne-calendar-day-button-today.ohne-calendar-day-button-selected::before {
    background-color: hsl(var(--ohne-primary-foreground));
  }
`;

/**
 * The displayed month as week rows of seven cells, padded with disabled adjacent-month days.
 */
function weeks(options: CalendarMonthOptions): DayCell[][] {
  const year = options.year();
  const month = options.month();
  const zone = options.resolveTimezone();
  const modelValue = options.modelValue();
  const min = options.min().timestamp;
  const max = options.max().timestamp;

  const firstDayOfMonth = zonedFromWallClock(zone, year, month, 1);
  const startDayIndex = (firstDayOfMonth.weekday + 7 - options.startDay) % 7;
  const previousMonth = addZonedMonths(firstDayOfMonth, -1);
  const prevMonthDays = daysInMonth(previousMonth.year, previousMonth.month);
  const isActiveMonthAndYear = modelValue?.year === year && modelValue.month === month;
  const isTodayMonthAndYear = options.today.year === year && options.today.month === month;

  const currentMonthDays = Array.from({ length: daysInMonth(year, month) }, (_, i): DayCell => {
    const day = i + 1;
    // Deliberately a fixed 24h window: the bounds test ignores DST.
    const start = zonedFromWallClock(zone, year, month, day).timestamp;
    const end = start + 86400000 - 1;
    return {
      day,
      disabled: (start < min && end < min) || (start > max && end > max),
      selected: isActiveMonthAndYear && modelValue.day === day,
      isToday: isTodayMonthAndYear && options.today.day === day,
    };
  });

  const prevMonthFiller = Array.from(
    { length: startDayIndex },
    (_, i): DayCell => ({
      day: prevMonthDays - startDayIndex + i + 1,
      disabled: true,
      selected: false,
      isToday: false,
    }),
  );

  let calendarDays = [...prevMonthFiller, ...currentMonthDays];

  const nextMonthDaysNeeded = 7 - (calendarDays.length % 7 || 7);

  if (nextMonthDaysNeeded < 7) {
    const nextMonthFiller = Array.from(
      { length: nextMonthDaysNeeded },
      (_, i): DayCell => ({ day: i + 1, disabled: true, selected: false, isToday: false }),
    );
    calendarDays = [...calendarDays, ...nextMonthFiller];
  }

  const weekCount = Math.ceil(calendarDays.length / 7);
  return Array.from({ length: weekCount }, (_, i) => calendarDays.slice(i * 7, i * 7 + 7));
}

/**
 * One day cell as a `data-day` button; a disabled day leaves the tab order and drops its tooltip.
 */
function dayButton(cell: DayCell, options: CalendarMonthOptions): HTMLElement {
  return h(
    'button',
    {
      'data-day': cell.day,
      disabled: cell.disabled ? true : null,
      tabindex: cell.disabled ? -1 : null,
      title: cell.disabled ? null : options.labels.selectDate,
      type: 'button',
      class:
        'ohne-calendar-day-button ohne-raw' +
        (cell.disabled ? ' ohne-calendar-day-button-disabled' : '') +
        (cell.selected ? ' ohne-calendar-day-button-selected' : '') +
        (cell.isToday ? ' ohne-calendar-day-button-today' : ''),
      onClick: (event: MouseEvent) => options.onSelectDay?.(cell.day, event),
    },
    cell.day,
  );
}

/**
 * The month grid of the calendar.
 *
 * A fixed-layout table: one header row of rotated short day names, then 4 to 6 week rows.
 * Leading and trailing filler cells carry real adjacent-month day numbers but stay disabled.
 * A day is enabled when any instant of its fixed 24h window lies within the bounds.
 * So the boundary days themselves stay selectable.
 * Every day renders as a `.ohne-calendar-day-button` with a `data-day` attribute.
 * That is the focus contract the calendar's keyword jump relies on.
 */
export function calendarMonth(options: CalendarMonthOptions): HTMLElement {
  const days = Array.from({ length: 7 }, (_, i) => ((i + options.startDay) % 7) + 1);
  return h(
    'table',
    { class: 'ohne-calendar-month' },
    h(
      'thead',
      null,
      h(
        'tr',
        null,
        days.map((day) => h('th', null, options.labels.daysShort[day - 1])),
      ),
    ),
    h('tbody', null, () =>
      weeks(options).map((week) =>
        h(
          'tr',
          null,
          week.map((cell) => h('td', null, dayButton(cell, options))),
        ),
      ),
    ),
  );
}
