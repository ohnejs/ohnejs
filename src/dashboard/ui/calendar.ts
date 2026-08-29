import type { Ref } from '../../utils/reactive/ref.ts';
import type { Child } from '../render/insert.ts';
import type { Timezone, ZonedDate } from './calendar-date.ts';
import type { IconName } from './icon.ts';

import { withDefaults } from '../../utils/defaults/with-defaults.ts';
import { isFunction } from '../../utils/is/is-function.ts';
import { isNull } from '../../utils/is/is-null.ts';
import { isNumber } from '../../utils/is/is-number.ts';
import { isString } from '../../utils/is/is-string.ts';
import { isUndefined } from '../../utils/is/is-undefined.ts';
import { computed } from '../../utils/reactive/computed.ts';
import { onCleanup } from '../../utils/reactive/effect-scope.ts';
import { effect } from '../../utils/reactive/effect.ts';
import { nextTick } from '../../utils/reactive/next-tick.ts';
import { ref } from '../../utils/reactive/ref.ts';
import { untracked } from '../../utils/reactive/untracked.ts';
import { searchByKeywords } from '../../utils/search/search-by-keywords.ts';
import { sleep } from '../../utils/sleep/sleep.ts';
import { css } from '../render/css.ts';
import { h } from '../render/h.ts';
import { when } from '../render/when.ts';
import { button } from './button.ts';
import {
  addZonedMonths,
  addZonedYears,
  clampZoned,
  parseDateInput,
  resolveTimezone,
  startOfZonedDay,
  zonedFromTimestamp,
  zonedFromWallClock,
} from './calendar-date.ts';
import { calendarMonth } from './calendar-month.ts';
import { floater } from './floater.ts';
import { isEditingText } from './hotkeys.ts';
import { icon } from './icon.ts';
import { time as timeInput } from './time.ts';
import { listenTrigger } from './trigger.ts';
import './tokens.ts';

/**
 * Labels used by `calendar` and `calendarRange`.
 */
export interface CalendarLabels {
  /**
   * The names of the months, starting with January.
   *
   * @default
   * ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September',
   *  'October', 'November', 'December']
   */
  months?: string[];

  /**
   * The full names of the days of the week, starting with Sunday.
   *
   * @default
   * ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
   */
  days?: string[];

  /**
   * The short names of the days of the week, starting with Sunday.
   *
   * @default
   * ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
   */
  daysShort?: string[];

  /**
   * The tooltip for the clear button.
   *
   * @default
   * 'Clear'
   */
  clear?: string;

  /**
   * The tooltip for a button that selects a date.
   *
   * @default
   * 'Select date'
   */
  selectDate?: string;

  /**
   * The tooltip for the previous month button.
   *
   * @default
   * 'Previous month'
   */
  previousMonth?: string;

  /**
   * The tooltip for the next month button.
   *
   * @default
   * 'Next month'
   */
  nextMonth?: string;

  /**
   * The suffix of the hours segment in the time input.
   *
   * @default
   * 'h'
   */
  hoursSuffix?: string;

  /**
   * The suffix of the minutes segment in the time input.
   *
   * @default
   * 'm'
   */
  minutesSuffix?: string;

  /**
   * The suffix of the seconds segment in the time input.
   *
   * @default
   * 's'
   */
  secondsSuffix?: string;
}

/**
 * Options for `calendar`.
 */
export interface CalendarOptions {
  /**
   * The initial year and month shown when the calendar opens.
   * A timestamp in milliseconds or an ISO 8601 formatted date.
   * Omitted, the calendar starts on the current value, falling back to the current year and month.
   *
   * @default
   * null
   */
  initial?: number | string | null;

  /**
   * Whether the calendar includes time selection.
   * When disabled, every emitted timestamp is midnight in the resolved time zone.
   *
   * @default
   * false
   */
  withTime?: boolean;

  /**
   * Whether the time picker shows the seconds segment.
   *
   * @default
   * true
   */
  showSeconds?: boolean;

  /**
   * The IANA time zone the calendar displays dates in, or `'local'` for the environment's zone.
   *
   * @default
   * 'UTC'
   */
  timezone?: Timezone | 'local';

  /**
   * Formats the selected timestamp for display in the handle.
   *
   * @default
   * (timestamp) => new Date(timestamp).toUTCString()
   */
  formatter?: (timestamp: number) => string;

  /**
   * Size step of the component: -2 very small, -1 small, 0 default, 1 large, 2 very large.
   * Omitted inherits `--ohne-size` from the nearest ancestor.
   */
  size?: number;

  /**
   * Placeholder text shown while the value is `null`.
   */
  placeholder?: string;

  /**
   * Whether the clear button renders while a value is selected.
   *
   * @default
   * true
   */
  clearable?: boolean;

  /**
   * The icon in the handle: a Tabler icon name, an element, or `null` for none.
   *
   * @default
   * 'calendar-week'
   */
  icon?: IconName | Element | null;

  /**
   * The minimum selectable date: a timestamp, an ISO 8601 string, or a getter for either.
   * Numbers are floored at the default, January 1st, 100 CE.
   *
   * @default
   * -59011459200000
   */
  min?: number | string | (() => number | string);

  /**
   * The maximum selectable date: a timestamp, an ISO 8601 string, or a getter for either.
   *
   * @default
   * 8640000000000000
   */
  max?: number | string | (() => number | string);

  /**
   * Reports the error state reactively.
   * While it returns `true` the border and the focus ring turn destructive.
   */
  error?: () => boolean;

  /**
   * Disables the calendar reactively while it returns `true`.
   */
  disabled?: () => boolean;

  /**
   * The `id` attribute of the hidden input element.
   * A `fieldLabel` for this id focuses the handle through the trigger bus.
   */
  id?: string;

  /**
   * The `name` attribute of the hidden input element that holds the selected value.
   */
  name?: string;

  /**
   * The starting day of the week, `0` (Sunday) to `6` (Saturday).
   *
   * @default
   * 1
   */
  startDay?: number;

  /**
   * Labels used for the calendar component.
   */
  labels?: CalendarLabels;

  /**
   * The CSS position of the picker.
   * `'fixed'` is right for most cases; `'absolute'` positions inside a scrolling container.
   *
   * @default
   * 'fixed'
   */
  strategy?: 'fixed' | 'absolute';

  /**
   * Called with the settled value when the picker closes, and immediately on clear.
   */
  onCommit?: (value: number | null) => void;
}

const LABEL_DEFAULTS: Required<CalendarLabels> = {
  months: [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ],
  days: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  daysShort: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  clear: 'Clear',
  selectDate: 'Select date',
  previousMonth: 'Previous month',
  nextMonth: 'Next month',
  hoursSuffix: 'h',
  minutesSuffix: 'm',
  secondsSuffix: 's',
};

const MIN_TIMESTAMP = -59011459200000;

css`
  .ohne-calendar {
    font-size: calc(1rem + var(--ohne-size) * 0.125rem);
  }

  .ohne-calendar-focus-visible .ohne-floater-handle {
    border-color: transparent;
    box-shadow: 0 0 0 0.125rem hsl(var(--ohne-ring));
    outline: none;
  }

  .ohne-calendar-displayed-value,
  .ohne-calendar-placeholder {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .ohne-calendar-icon {
    flex-shrink: 0;
  }

  .ohne-calendar-icon-offset {
    margin-top: -1px;
  }

  .ohne-calendar-clear {
    flex-shrink: 0;
    display: flex;
    justify-content: flex-start;
    align-items: center;
    height: calc(100% - 2px);
    aspect-ratio: 1;
    margin-right: calc(-0.5em - 1px);
    margin-left: auto;
  }

  .ohne-calendar-clear .ohne-button {
    border-radius: calc(var(--ohne-radius) - 0.25rem);
  }

  .ohne-calendar-placeholder {
    color: hsl(var(--ohne-muted-foreground));
  }

  .ohne-calendar-main {
    transition: var(--ohne-transition);
    transition-property: filter;
  }

  .ohne-calendar-main-blurred {
    filter: blur(2px);
  }

  .ohne-calendar-header {
    display: flex;
    gap: 0.5em;
    padding: 0.5em 0.5em 0;
  }

  .ohne-calendar-header-nav {
    display: flex;
    margin-left: auto;
  }

  .ohne-calendar-selector {
    display: flex;
    flex-direction: column;
    gap: 0.5em;
    padding: 0.5em;
    overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: hsl(var(--ohne-foreground) / 0.25) transparent;
  }

  .ohne-calendar-time {
    display: flex;
    width: calc(1em + (2.5em + 0.125rem) * 7 - 0.125rem);
    padding: 0.5em;
  }

  .ohne-calendar-keyword {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    left: 0;
    display: flex;
    justify-content: center;
    align-items: center;
    padding: 0.5em;
    overflow: hidden;
    background-color: hsl(var(--ohne-card) / 0.82);
    border-radius: calc(var(--ohne-radius) - 0.125rem);
    font-size: 2em;
    font-weight: 500;
    text-align: center;
    opacity: 0;
    visibility: hidden;
    transition: var(--ohne-transition);
    transition-property: opacity, visibility;
  }

  .ohne-calendar-keyword-visible {
    opacity: 1;
    visibility: visible;
  }
`;

/**
 * The date picker.
 *
 * A floater whose panel holds a month grid, month and year selector panes, and optionally a time row.
 * The model is a millisecond timestamp or `null`.
 * Without `withTime` every emitted value is midnight in the resolved time zone.
 * Arrow keys navigate while open: Left/Right step months, Down is the previous year, Up the next.
 * Shift-clicking the header chevrons steps years; Escape dismisses an open selector pane first.
 * Typing while open collects a keyword overlay that jumps to a day, month name, or year after 750ms.
 * `commit` fires with the settled value when the picker closes, and immediately on clear.
 *
 * @example
 * ```ts
 * const publishedAt = ref<number | null>(null)
 * calendar(publishedAt, { timezone: 'Europe/Berlin', withTime: true })
 * ```
 */
export function calendar(model: Ref<number | null>, options: CalendarOptions = {}): HTMLElement {
  const error = options.error ?? ((): boolean => false);
  const disabled = options.disabled ?? ((): boolean => false);
  const clearable = options.clearable ?? true;
  const withTime = options.withTime ?? false;
  const formatter =
    options.formatter ?? ((timestamp: number): string => new Date(timestamp).toUTCString());
  const resolvedLabels: Required<CalendarLabels> = withDefaults(
    options.labels ?? {},
    LABEL_DEFAULTS,
  );
  const headerSize = isNumber(options.size) ? options.size - 1 : -2;

  const zone = (): string => resolveTimezone(options.timezone);

  const isMonthSelectorVisible = ref(false);
  const isYearSelectorVisible = ref(false);
  const selectorWidth = ref(0);
  const selectorHeight = ref(0);
  const keyword = ref('');
  const keywordPending = ref(false);
  const focusVisible = ref(false);

  const today = zonedFromTimestamp(Date.now(), zone());
  const initial = options.initial ?? null;
  const initialDate = isNull(initial) ? null : zonedFromTimestamp(parseDateInput(initial), zone());

  const date = ref<ZonedDate | null>(null);
  const selectedDay = ref(today.day);

  let lastModel: number | null | undefined;
  effect(() => {
    const value = model.value;
    if (value === lastModel) return;
    lastModel = value;
    untracked(() => {
      date.value = isNull(value) ? null : zonedFromTimestamp(value, zone());
      selectedDay.value = date.value?.day ?? 0;
    });
  });

  const seed = initialDate ?? untracked(() => date.value) ?? today;
  const selectedYear = ref(seed.year);
  const selectedMonth = ref(seed.month);

  const minInput = (): number | string =>
    (isFunction(options.min) ? options.min() : options.min) ?? MIN_TIMESTAMP;
  const maxInput = (): number | string =>
    (isFunction(options.max) ? options.max() : options.max) ?? 8640000000000000;
  const minDate = computed(() => {
    const value = minInput();
    return zonedFromTimestamp(
      isNumber(value) ? Math.max(value, MIN_TIMESTAMP) : parseDateInput(value),
      zone(),
    );
  });
  const maxDate = computed(() => zonedFromTimestamp(parseDateInput(maxInput()), zone()));

  const time = computed(() => {
    const current = date.value;
    return isNull(current)
      ? 0
      : (current.hour * 3600 + current.minute * 60 + current.second) * 1000;
  });
  const minTime = computed(() => {
    const min = minDate.value;
    return selectedYear.value === min.year &&
      selectedMonth.value === min.month &&
      selectedDay.value === min.day
      ? (min.hour * 3600 + min.minute * 60 + min.second) * 1000
      : 0;
  });
  const maxTime = computed(() => {
    const max = maxDate.value;
    return selectedYear.value === max.year &&
      selectedMonth.value === max.month &&
      selectedDay.value === max.day
      ? (max.hour * 3600 + max.minute * 60 + max.second) * 1000
      : 86399000;
  });

  const displayedValue = (): string | undefined => {
    const value = model.value;
    return isNull(value) ? undefined : formatter(value);
  };

  const clampDate = (input: ZonedDate): ZonedDate =>
    clampZoned(input, minDate.value, maxDate.value);

  const prepareEmitValue = (input: ZonedDate | null): number | null => {
    if (isNull(input)) return null;
    return withTime ? input.timestamp : startOfZonedDay(input).timestamp;
  };

  const applyMonthStep = (step: (current: ZonedDate) => ZonedDate, event?: Event): boolean => {
    if (event && isEditingText()) return false;
    event?.preventDefault();
    event?.stopImmediatePropagation();
    const current = zonedFromWallClock(zone(), selectedYear.value, selectedMonth.value, 1);
    const next = clampDate(step(current));
    selectedYear.value = next.year;
    selectedMonth.value = next.month;
    void nextTick().then(() => fl.container()?.focus());
    return true;
  };

  const prevMonth = (event?: Event): boolean =>
    applyMonthStep((current) => addZonedMonths(current, -1), event);
  const nextMonth = (event?: Event): boolean =>
    applyMonthStep((current) => addZonedMonths(current, 1), event);
  const prevYear = (event?: Event): boolean =>
    applyMonthStep((current) => addZonedYears(current, -1), event);
  const nextYear = (event?: Event): boolean =>
    applyMonthStep((current) => addZonedYears(current, 1), event);

  let keywordTimer: ReturnType<typeof setTimeout> | undefined;

  const runKeywordJump = (): void => {
    if (!fl.isActive.value || !keyword.value.trim()) return;

    const keywords = keyword.value
      .trim()
      .toLowerCase()
      .split(' ')
      .map((entry) => entry.trim())
      .filter(Boolean);

    let day: number | undefined;
    let month: number | undefined;
    let year: number | undefined;

    for (const entry of keywords) {
      if (/^0*([1-9]|[12]\d|3[01])$/.test(entry)) {
        day = Number(entry);
      } else if (/^0*([1-9]|[1-9][0-9]|[1-9][0-9]{2}|[1-9][0-9]{3})$/.test(entry)) {
        year = Number(entry);
      } else {
        const months = resolvedLabels.months.map((name) => name.toLowerCase());
        const results = searchByKeywords(months, entry);
        month = results[0] ? months.indexOf(results[0]) + 1 : undefined;
      }
    }

    keyword.value = '';

    const active = document.activeElement;
    const focusedDay = active?.classList.contains('ohne-calendar-day-button')
      ? Number(active.getAttribute('data-day'))
      : undefined;
    const current = zonedFromWallClock(
      zone(),
      year ?? selectedYear.value,
      month ?? selectedMonth.value,
      day ?? focusedDay ?? 1,
    );
    const clamped = clampDate(current);

    selectedYear.value = clamped.year;
    selectedMonth.value = clamped.month;

    void nextTick().then(() => {
      fl.container()
        ?.querySelector<HTMLElement>(
          `.ohne-calendar-day-button:not(:disabled)[data-day="${clamped.day}"]`,
        )
        ?.focus();
    });
  };

  const startKeywordTimer = (): void => {
    keywordPending.value = true;
    clearTimeout(keywordTimer);
    keywordTimer = setTimeout(() => {
      keywordPending.value = false;
      runKeywordJump();
    }, 750);
  };
  startKeywordTimer();

  const onKeyDown = (event: KeyboardEvent): void => {
    if (fl.isActive.value && !isEditingText()) {
      if (!keywordPending.value) {
        keyword.value = '';
      }

      if (!event.ctrlKey && !event.metaKey && /^[\p{L}\p{N}]$/u.test(event.key)) {
        keyword.value += event.key;
        startKeywordTimer();
      } else if (!event.ctrlKey && !event.metaKey && event.key === ' ' && keyword.value) {
        keyword.value += ' ';
        event.preventDefault();
      } else if (event.key === 'Backspace') {
        keyword.value = keyword.value.slice(0, -1);
        event.preventDefault();
      }
    }
  };

  const openSelector = async (pane: 'month' | 'year'): Promise<void> => {
    const container = fl.container();
    if (!container) return;
    selectorWidth.value = container.offsetWidth;
    selectorHeight.value = container.offsetHeight;
    if (pane === 'month') isMonthSelectorVisible.value = true;
    else isYearSelectorVisible.value = true;
    await sleep(0);
    const target =
      pane === 'month'
        ? `[data-month='${selectedMonth.value}']`
        : `[data-year='${selectedYear.value}']`;
    fl.container()?.querySelector(target)?.scrollIntoView({ block: 'center', behavior: 'instant' });
  };

  const scrollPanelTop = (): void => {
    void nextTick().then(() => fl.container()?.scrollTo({ top: 0, behavior: 'instant' }));
  };

  const header = (): HTMLElement => {
    const previousButton = button(icon('chevron-left'), {
      variant: 'ghost',
      size: headerSize,
      disabled: () =>
        selectedYear.value === minDate.value.year && selectedMonth.value === minDate.value.month,
      onClick: (event) => {
        if (event.shiftKey) prevYear();
        else prevMonth();
      },
    });
    previousButton.title = resolvedLabels.previousMonth;
    const nextButton = button(icon('chevron-right'), {
      variant: 'ghost',
      size: headerSize,
      disabled: () =>
        selectedYear.value === maxDate.value.year && selectedMonth.value === maxDate.value.month,
      onClick: (event) => {
        if (event.shiftKey) nextYear();
        else nextMonth();
      },
    });
    nextButton.title = resolvedLabels.nextMonth;
    return h(
      'div',
      { class: 'ohne-calendar-header' },
      button(() => resolvedLabels.months[selectedMonth.value - 1], {
        variant: 'secondary',
        size: headerSize,
        onClick: () => void openSelector('month'),
      }),
      button(() => selectedYear.value, {
        variant: 'secondary',
        size: headerSize,
        onClick: () => void openSelector('year'),
      }),
      h('div', { class: 'ohne-calendar-header-nav' }, previousButton, nextButton),
    );
  };

  const selectorPane = (content: () => Child): HTMLElement =>
    h(
      'div',
      {
        class: 'ohne-calendar-selector',
        style: () => `width: ${selectorWidth.value}px; height: ${selectorHeight.value}px;`,
      },
      content,
    );

  const monthSelector = (): HTMLElement =>
    selectorPane(() =>
      resolvedLabels.months.map((month, index) => {
        const element = button(month, {
          variant: index + 1 === selectedMonth.value ? 'primary' : 'secondary',
          type: 'button',
          disabled: () =>
            (selectedYear.value === minDate.value.year && index < minDate.value.month - 1) ||
            (selectedYear.value === maxDate.value.year && index > maxDate.value.month - 1),
          onClick: () => {
            selectedMonth.value = resolvedLabels.months.indexOf(month) + 1;
            isMonthSelectorVisible.value = false;
            scrollPanelTop();
          },
        });
        element.dataset.month = String(index + 1);
        return element;
      }),
    );

  const yearSelector = (): HTMLElement =>
    selectorPane(() => {
      const base = selectedYear.value;
      return Array.from({ length: 201 }, (_, i) => base - 100 + i).map((year) => {
        if (year < minDate.value.year || year > maxDate.value.year) return null;
        const element = button(String(year), {
          variant: year === base ? 'primary' : 'secondary',
          type: 'button',
          onClick: () => {
            const current = zonedFromWallClock(zone(), year, selectedMonth.value, 1);
            const clamped = clampDate(current);
            selectedYear.value = clamped.year;
            selectedMonth.value = clamped.month;
            isYearSelectorVisible.value = false;
            scrollPanelTop();
          },
        });
        element.dataset.year = String(year);
        return element;
      });
    });

  const onSelectDay = (day: number, event: MouseEvent): void => {
    const total = time.value / 1000;
    const newDate = zonedFromWallClock(
      zone(),
      selectedYear.value,
      selectedMonth.value,
      day,
      Math.floor(total / 3600),
      Math.floor(total / 60) % 60,
      Math.floor(total) % 60,
    );
    const clamped = clampDate(newDate);
    const emitValue = prepareEmitValue(clamped);
    model.value = emitValue;
    if (!fl.isActive.value) {
      options.onCommit?.(emitValue);
    }
    if (!withTime) {
      void nextTick().then(() => fl.close(event));
    }
  };

  const timeModel: Ref<number> = {
    get value() {
      return time.value;
    },
    set value(next) {
      const total = next / 1000;
      const newDate = zonedFromWallClock(
        zone(),
        untracked(() => selectedYear.value),
        untracked(() => selectedMonth.value),
        untracked(() => selectedDay.value),
        Math.floor(total / 3600),
        Math.floor(total / 60) % 60,
        Math.floor(total) % 60,
      );
      const clamped = untracked(() => clampDate(newDate));
      model.value = prepareEmitValue(clamped);
    },
  };

  const timeRow = (): HTMLElement =>
    h(
      'div',
      { class: 'ohne-calendar-time' },
      timeInput(timeModel, {
        id: options.id ? `${options.id}--time` : undefined,
        name: options.name ? `${options.name}--time` : undefined,
        min: () => minTime.value,
        max: () => maxTime.value,
        showSeconds: options.showSeconds ?? true,
      }),
    );

  const noSelector = (): boolean => !isMonthSelectorVisible.value && !isYearSelectorVisible.value;

  const main = h(
    'div',
    {
      class: () => 'ohne-calendar-main' + (keyword.value ? ' ohne-calendar-main-blurred' : ''),
    },
    when(noSelector, header),
    when(() => isMonthSelectorVisible.value, monthSelector),
    when(() => isYearSelectorVisible.value, yearSelector),
    when(noSelector, () =>
      calendarMonth({
        modelValue: () => date.value,
        year: () => selectedYear.value,
        month: () => selectedMonth.value,
        min: () => minDate.value,
        max: () => maxDate.value,
        startDay: options.startDay ?? 1,
        today,
        resolveTimezone: zone,
        labels: resolvedLabels,
        onSelectDay,
      }),
    ),
    withTime ? when(noSelector, timeRow) : null,
  );

  const keywordOverlay = h(
    'div',
    {
      class: () =>
        'ohne-calendar-keyword' + (keyword.value ? ' ohne-calendar-keyword-visible' : ''),
    },
    h('span', null, () => keyword.value),
  );

  const iconChild = (): Child => {
    const source = options.icon === undefined ? 'calendar-week' : options.icon;
    if (isString(source)) {
      const svg = icon(source);
      svg.classList.add('ohne-calendar-icon');
      if (source.startsWith('calendar')) svg.classList.add('ohne-calendar-icon-offset');
      svg.style.width = 'calc(1em + 0.125rem)';
      svg.style.height = 'calc(1em + 0.125rem)';
      return svg;
    }
    if (source) {
      source.classList.add('ohne-calendar-icon');
      return source;
    }
    return null;
  };

  const clearControl = (): HTMLElement => {
    const x = icon('x');
    x.setAttribute('width', '1.125em');
    x.setAttribute('height', '1.125em');
    const element = button(x, {
      is: 'span',
      variant: 'ghost',
      size: isNumber(options.size) ? options.size - 2 : -3,
      onClick: (event) => {
        event.stopPropagation();
        model.value = null;
        options.onCommit?.(null);
        void nextTick().then(() => fl.close(event));
      },
    });
    element.tabIndex = 0;
    element.title = resolvedLabels.clear;
    element.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        model.value = null;
        options.onCommit?.(null);
        fl.handle.focus();
      }
    });
    return h('span', { class: 'ohne-calendar-clear' }, element);
  };

  const fl = floater([main, keywordOverlay], {
    handle: () => {
      const value = displayedValue();
      return [
        iconChild(),
        value
          ? h('span', { class: 'ohne-calendar-displayed-value' }, value)
          : h('span', { class: 'ohne-calendar-placeholder' }, options.placeholder),
        clearable && model.value !== null && !disabled() ? clearControl() : null,
      ];
    },
    after: h('input', {
      id: options.id,
      name: options.name,
      value: () => model.value,
      hidden: true,
    }),
    size: options.size,
    error,
    disabled,
    strategy: options.strategy,
    onEscapeKey: (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (isMonthSelectorVisible.value || isYearSelectorVisible.value) {
        isMonthSelectorVisible.value = false;
        isYearSelectorVisible.value = false;
      } else {
        void fl.close(event);
        fl.handle.focus();
      }
    },
    onClose: () => options.onCommit?.(prepareEmitValue(date.value)),
    onKeydown: (event) => {
      onKeyDown(event);
      if (event.key === 'ArrowDown') prevYear(event);
      else if (event.key === 'ArrowUp') nextYear(event);
      else if (event.key === 'ArrowLeft') prevMonth(event);
      else if (event.key === 'ArrowRight') nextMonth(event);
    },
    onBlurHandle: () => {
      focusVisible.value = false;
    },
  });

  effect(() => {
    const value = displayedValue();
    if (isUndefined(value)) fl.handle.removeAttribute('title');
    else fl.handle.title = value;
  });

  effect(() => {
    const isActive = fl.isActive.value;
    untracked(() => {
      if (isActive) {
        const current = zonedFromWallClock(zone(), selectedYear.value, selectedMonth.value, 1);
        const clamped = clampDate(current);
        selectedYear.value = clamped.year;
        selectedMonth.value = clamped.month;
      } else {
        isMonthSelectorVisible.value = false;
        isYearSelectorVisible.value = false;
      }
    });
  });

  if (options.id) {
    listenTrigger(`focus:${options.id}`, () => {
      if (!disabled()) {
        fl.handle.focus();
        focusVisible.value = true;
      }
    });
  }

  onCleanup(() => clearTimeout(keywordTimer));

  return h(
    'div',
    {
      class: () => 'ohne-calendar' + (focusVisible.value ? ' ohne-calendar-focus-visible' : ''),
      style: isUndefined(options.size) ? undefined : `--ohne-size: ${options.size};`,
    },
    fl.root,
  );
}
