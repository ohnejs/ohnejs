import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { flush } from '../../../src/utils/reactive/_scheduler.ts';
import { ref } from '../../../src/utils/reactive/ref.ts';
import { type FakeElement, findElement } from '../_fake-dom.ts';

const { calendarMonth } = await import('../../../src/dashboard/ui/calendar-month.ts');
const { zonedFromWallClock } = await import('../../../src/dashboard/ui/calendar-date.ts');

const LABELS = {
  months: [],
  days: [],
  clear: 'Clear',
  previousMonth: 'Previous month',
  nextMonth: 'Next month',
  hoursSuffix: 'h',
  minutesSuffix: 'm',
  secondsSuffix: 's',
};

describe('calendarMonth', () => {
  it('follows a labels getter', () => {
    const german = ref(false);
    const today = zonedFromWallClock('UTC', 2026, 10, 11);
    const root = calendarMonth({
      modelValue: () => null,
      year: () => 2026,
      month: () => 10,
      min: () => zonedFromWallClock('UTC', 1, 1, 1),
      max: () => zonedFromWallClock('UTC', 9999, 12, 31),
      startDay: 1,
      today,
      resolveTimezone: () => 'UTC',
      labels: () => ({
        ...LABELS,
        daysShort: german.value
          ? ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']
          : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
        selectDate: german.value ? 'Datum wählen' : 'Select date',
      }),
    }) as unknown as FakeElement;
    const head = findElement(root, (element) => element.tagName === 'THEAD');
    const day = findElement(root, (element) => element.getAttribute('data-day') === '11');
    strictEqual(head?.textContent, 'MonTueWedThuFriSatSun');
    strictEqual(day?.getAttribute('title'), 'Select date');
    german.value = true;
    flush();
    strictEqual(head?.textContent, 'MoDiMiDoFrSaSo');
    strictEqual(day?.getAttribute('title'), 'Datum wählen');
  });
});
