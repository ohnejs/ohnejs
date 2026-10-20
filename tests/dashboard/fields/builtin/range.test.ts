import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { DashboardField } from '../../../../src/dashboard/runtime/meta-types.ts';

import { flush } from '../../../../src/utils/reactive/_scheduler.ts';
import { effectScope } from '../../../../src/utils/reactive/effect-scope.ts';
import { type FakeElement, findElement, hasClass } from '../../_fake-dom.ts';
import { seedMessages } from '../../_fake-messages.ts';
import { fire } from '../../ui/_events.ts';
import { type } from '../_controls.ts';

await seedMessages(
  {
    'dashboard.range.between': '{start} - {end}',
    'dashboard.range.from': 'From {start}',
    'dashboard.range.start': 'Start',
    'dashboard.range.end': 'End',
    'dashboard.range.noEnd': 'No end',
  },
  'dashboard',
);
const { rangeType } = await import('../../../../src/dashboard/fields/builtin/range.ts');
const { summaryParts, summaryTitle } = await import('../../../../src/dashboard/fields/_summary.ts');
const { useT } = await import('../../../../src/dashboard/runtime/use-t.ts');

const rangeField = (options: Record<string, unknown>, nullable = false): DashboardField => ({
  name: 'window',
  type: 'range',
  kind: 'childOne',
  label: 'Siege window',
  nullable,
  required: !nullable,
  unique: false,
  translatable: false,
  readable: true,
  writable: true,
  immutable: false,
  options,
});

const control = (field: DashboardField, initial: unknown) =>
  rangeType.control!({
    field,
    initial,
    mode: 'edit',
    path: 'window',
    language: () => 'en',
    onInput() {},
  })!;

const WEEK = { UUID: 'u1', start: '2008-11-13', end: '2008-11-20' };

describe('rangeType control', () => {
  it('stays pristine over none, and reads the stored ends without the `UUID` until touched', () => {
    effectScope().run(() => {
      deepStrictEqual(control(rangeField({ of: 'date' }), undefined).read(), {});
      const window = control(rangeField({ of: 'date' }), WEEK);
      deepStrictEqual(window.read(), { value: { start: '2008-11-13', end: '2008-11-20' } });
      strictEqual(window.dirty(), false);
      deepStrictEqual(control(rangeField({ of: 'date' }, true), null).read(), { value: null });
    });
  });

  it('reads a restored pair in wire form, dirty only against a different stored one', () => {
    effectScope().run(() => {
      const window = control(rangeField({ of: 'date' }), WEEK);
      window.restore!({ start: '2008-11-14', end: '2008-11-20' });
      deepStrictEqual(window.read(), { value: { start: '2008-11-14', end: '2008-11-20' } });
      strictEqual(window.dirty(), true);
      window.restore!({ start: '2008-11-13', end: '2008-11-20' });
      strictEqual(window.dirty(), false);
      window.restore!(undefined);
      deepStrictEqual(window.read(), { value: { start: '2008-11-13', end: '2008-11-20' } });
    });
  });

  it('asks for a missing end, unless the range is open', () => {
    effectScope().run(() => {
      const closed = control(rangeField({ of: 'date' }), undefined);
      closed.restore!({ start: '2008-11-13', end: null });
      deepStrictEqual(closed.read(), { errors: { end: 'validation.required' } });
      closed.restore!({ start: null, end: '2008-11-13' });
      deepStrictEqual(closed.read(), { errors: { start: 'validation.required' } });
      const open = control(rangeField({ of: 'dateTime', open: true }), undefined);
      open.restore!({ start: 5000, end: null });
      deepStrictEqual(open.read(), { value: { start: 5000, end: null } });
    });
  });

  it('writes `null` once both ends clear on a nullable range, and omits on a required one', () => {
    effectScope().run(() => {
      const nullable = control(rangeField({ of: 'date' }, true), WEEK);
      nullable.restore!(null);
      deepStrictEqual(nullable.read(), { value: null });
      strictEqual(nullable.dirty(), true);
      const required = control(rangeField({ of: 'date' }), WEEK);
      required.restore!(null);
      deepStrictEqual(required.read(), {});
    });
  });

  it('checks a changed span with the server’s messages, canonical times included', () => {
    effectScope().run(() => {
      const window = control(rangeField({ of: 'date', minSpan: '1 day' }), undefined);
      window.restore!({ start: '2008-11-13', end: '2008-11-13' });
      deepStrictEqual(window.read(), { errors: { '': 'validation.minSpan' } });
      window.restore!({ start: '2008-11-14', end: '2008-11-13' });
      deepStrictEqual(window.read(), { errors: { '': 'validation.invalidRange' } });
      const shift = control(rangeField({ of: 'time', maxSpan: '8h' }), undefined);
      shift.restore!({ start: '09:00', end: '17:00' });
      deepStrictEqual(shift.read(), { value: { start: '09:00:00', end: '17:00:00' } });
    });
  });

  it('seeds an empty time range inside its bounds, read as its value unless nullable', () => {
    effectScope().run(() => {
      const seeds = [
        [{ minSpan: '1h' }, { start: '00:00:00', end: '01:00:00' }],
        [{ min: '09:00' }, { start: '09:00:00', end: '09:00:00' }],
      ] as const;
      for (const [options, seed] of seeds) {
        for (const nullable of [false, true]) {
          const shift = control(rangeField({ of: 'time', ...options }, nullable), undefined);
          const [hours] = (shift.element as HTMLElement).querySelectorAll(
            'input.ohne-number-input',
          );
          fire(hours as never, 'focus');
          fire(hours as never, 'blur');
          flush();
          deepStrictEqual(shift.read(), nullable ? {} : { value: seed }, JSON.stringify(options));
          strictEqual(shift.dirty(), false);
        }
      }
      const defaulted = { ...rangeField({ of: 'time', min: '09:00' }), required: false };
      deepStrictEqual(control(defaulted, undefined).read(), {});
    });
  });

  it('clears a nullable time range one end at a time, and shows an empty one empty', () => {
    effectScope().run(() => {
      const shift = control(rangeField({ of: 'time' }, true), {
        UUID: 'u1',
        start: '09:00:00',
        end: '10:00:00',
      });
      const clears = () => {
        const found: FakeElement[] = [];
        findElement(shift.element as unknown as FakeElement, (element) => {
          if (hasClass(element, 'ohne-time-clear')) found.push(element);
          return false;
        });
        return found;
      };
      strictEqual(clears().length, 2);
      fire(clears()[0]! as never, 'click');
      flush();
      deepStrictEqual(shift.read(), { errors: { start: 'validation.required' } });
      fire(clears()[0]! as never, 'click');
      flush();
      deepStrictEqual(shift.read(), { value: null });
      strictEqual(shift.dirty(), true);
      const empty = control(rangeField({ of: 'time' }, true), undefined);
      flush();
      const values: string[] = [];
      findElement(empty.element as unknown as FakeElement, (element) => {
        if (hasClass(element, 'ohne-number-input'))
          values.push((element as unknown as { value: string }).value);
        return false;
      });
      deepStrictEqual(values, ['', '', '', '', '', '']);
      strictEqual(
        (control(rangeField({ of: 'time' }), undefined).element as HTMLElement).querySelector(
          '.ohne-time-clear',
        ),
        null,
      );
    });
  });

  it('hosts every message of the pair on its one line, each end named', () => {
    effectScope().run(() => {
      const window = control(rangeField({ of: 'date' }), WEEK);
      strictEqual(window.setErrors({ end: 'Too late', other: 'Elsewhere' }), 'Elsewhere');
      strictEqual(window.error(), 'End: Too late');
      window.setErrors({ '': 'Backwards', start: 'Too early' });
      strictEqual(window.error(), 'Backwards');
    });
  });

  it('clears the end handle alone on an open required range', () => {
    effectScope().run(() => {
      const shown = control(rangeField({ of: 'date', open: true }), WEEK).element as HTMLElement;
      const [from, to] = shown.querySelectorAll('div.ohne-calendar');
      strictEqual(from!.querySelectorAll('span.ohne-calendar-clear').length, 0);
      strictEqual(to!.querySelectorAll('span.ohne-calendar-clear').length, 1);
    });
  });
});

describe('rangeType numeric control', () => {
  const inputs = (shown: ReturnType<typeof control>) =>
    (shown.element as HTMLElement).querySelectorAll('input') as unknown as FakeElement[];
  const value = (input: FakeElement): string => (input as unknown as { value: string }).value;

  it('pairs an end control per end, each parsing and checking its own text', () => {
    effectScope().run(() => {
      const floors = control(rangeField({ of: 'integer', max: 99 }), undefined);
      deepStrictEqual(floors.read(), {});
      const [start, end] = inputs(floors);
      type(start!, '1e1');
      type(end!, '20');
      deepStrictEqual(floors.read(), { value: { start: 10, end: 20 } });
      strictEqual(floors.dirty(), true);
      type(start!, '1.5');
      deepStrictEqual(floors.read(), { errors: { start: 'dashboard.invalidInteger' } });
      type(start!, '1');
      type(end!, '100');
      deepStrictEqual(floors.read(), { errors: { end: 'validation.maxValue' } });
    });
  });

  it('stays pristine over a stored pair and asks for a missing end unless open', () => {
    effectScope().run(() => {
      const stored = { UUID: 'u1', start: 2.5, end: 4 };
      const weight = control(rangeField({ of: 'number' }), stored);
      deepStrictEqual(weight.read(), { value: { start: 2.5, end: 4 } });
      strictEqual(weight.dirty(), false);
      weight.restore!({ start: 2.5, end: null });
      deepStrictEqual(weight.read(), { errors: { end: 'validation.required' } });
      const open = control(rangeField({ of: 'number', open: true }), undefined);
      open.restore!({ start: 3, end: null });
      deepStrictEqual(open.read(), { value: { start: 3, end: null } });
      const nullable = control(rangeField({ of: 'number' }, true), stored);
      nullable.restore!(null);
      deepStrictEqual(nullable.read(), { value: null });
      nullable.restore!(undefined);
      strictEqual(nullable.dirty(), false);
    });
  });

  it('checks a changed span exactly, in minor units with a currency', () => {
    effectScope().run(() => {
      const weight = control(rangeField({ of: 'number', maxSpan: 0.2 }), undefined);
      weight.restore!({ start: 0.1, end: 0.3 });
      deepStrictEqual(weight.read(), { value: { start: 0.1, end: 0.3 } });
      weight.restore!({ start: 0.3, end: 0.1 });
      deepStrictEqual(weight.read(), { errors: { '': 'validation.invalidRange' } });
      const price = control(
        rangeField({ of: 'integer', currency: 'EUR', minSpan: 1000 }),
        undefined,
      );
      const [start, end] = inputs(price);
      type(start!, '5');
      type(end!, '12.50');
      deepStrictEqual(price.read(), { errors: { '': 'validation.minSpan' } });
      type(end!, '15');
      deepStrictEqual(price.read(), { value: { start: 500, end: 1500 } });
    });
  });

  it('names each end after the label and marks the end that failed', () => {
    effectScope().run(() => {
      const floors = control(rangeField({ of: 'integer' }), undefined);
      const [start, end] = inputs(floors);
      strictEqual(
        start!.getAttribute('aria-labelledby'),
        'field-window-label field-window-input-start-name',
      );
      strictEqual((end as unknown as HTMLElement).id, 'field-window-input-end');
      strictEqual(
        end!.getAttribute('aria-labelledby'),
        'field-window-label field-window-input-end-name',
      );
      strictEqual(floors.setErrors({ start: 'Too low', other: 'Elsewhere' }), 'Elsewhere');
      flush();
      strictEqual(floors.error(), 'Start: Too low');
      strictEqual(start!.getAttribute('aria-invalid'), 'true');
      strictEqual(end!.getAttribute('aria-invalid'), null);
      floors.setErrors({ '': 'Too short' });
      flush();
      strictEqual(floors.error(), 'Too short');
      strictEqual(start!.getAttribute('aria-invalid'), 'true');
      strictEqual(end!.getAttribute('aria-invalid'), 'true');
    });
  });

  it('puts a hidden two-thumb track over the inputs under `display: slider`', () => {
    effectScope().run(() => {
      const options = {
        of: 'integer',
        currency: 'EUR',
        min: 0,
        max: 10000,
        step: 100,
        minSpan: 500,
        display: 'slider',
      };
      const price = control(rangeField(options), { start: 1000, end: 2000 });
      flush();
      const [from, to, start, end] = inputs(price);
      strictEqual(from!.getAttribute('aria-hidden'), 'true');
      strictEqual((to as unknown as HTMLElement).tabIndex, -1);
      (to as unknown as { value: string }).value = '1200';
      fire(to!, 'input');
      flush();
      strictEqual(value(start!), '10.00');
      strictEqual(value(end!), '15.00');
      deepStrictEqual(price.read(), { value: { start: 1000, end: 1500 } });
      (to as unknown as { value: string }).value = '1100';
      fire(to!, 'input');
      flush();
      strictEqual(value(to!), '1500');
      type(start!, '3');
      strictEqual(value(from!), '300');
      strictEqual(
        inputs(control(rangeField({ of: 'integer', display: 'slider' }), undefined)).length,
        2,
      );
    });
  });

  it('marks the thumb of the end that failed', () => {
    effectScope().run(() => {
      const floors = control(
        rangeField({ of: 'integer', min: 0, max: 99, display: 'slider' }),
        undefined,
      );
      const [from, to] = inputs(floors);
      const marks = () => [from, to].map((thumb) => thumb!.getAttribute('aria-invalid'));
      floors.setErrors({ end: 'Too high' });
      flush();
      deepStrictEqual(marks(), [null, 'true']);
      floors.setErrors({ '': 'Too short' });
      flush();
      deepStrictEqual(marks(), ['true', 'true']);
    });
  });
});

describe('rangeType cell and summary', () => {
  const cell = (field: DashboardField, value: unknown) =>
    (
      rangeType.display!({
        field,
        value: () => value,
        language: () => 'en',
      } as never) as () => unknown
    )();

  it('reads both ends in the user’s format, or the start alone while an open end is `null`', () => {
    const day = rangeField({ of: 'date' });
    const shown = cell(day, WEEK) as FakeElement;
    strictEqual(shown.textContent, rangeType.summary!(WEEK, day));
    strictEqual(shown.getAttribute('title'), shown.textContent);
    ok(/ - /.test(shown.textContent ?? ''));
    const open = rangeField({ of: 'dateTime', open: true });
    ok(rangeType.summary!({ start: 0, end: null }, open).startsWith('From '));
  });

  it('reads numeric ends in their notation, the unit once at the end', () => {
    const weight = rangeField({ of: 'number', suffix: 'kg' });
    strictEqual(rangeType.summary!({ start: 2.5, end: 4 }, weight), '2.5 - 4 kg');
    strictEqual(
      (cell(weight, { start: 2.5, end: 4 }) as FakeElement).getAttribute('title'),
      '2.5 - 4 kg',
    );
    const open = rangeField({ of: 'integer', open: true });
    strictEqual(rangeType.summary!({ start: 10, end: null }, open), 'From 10');
    const price = rangeField({ of: 'integer', currency: 'EUR' });
    strictEqual(rangeType.summary!({ start: 500, end: 1250 }, price), '€5.00 - €12.50');
    strictEqual(rangeType.summary!({ start: 1.5, end: 2 }, rangeField({ of: 'integer' })), '');
  });

  it('dims a malformed end as raw text', () => {
    const shown = cell(rangeField({ of: 'date' }), {
      start: '2008-02-30',
      end: '2008-11-20',
    }) as FakeElement;
    strictEqual(shown.textContent, '2008-02-30 - 2008-11-20');
    strictEqual(rangeType.summary!({ start: 'x', end: 'y' }, rangeField({ of: 'date' })), '');
  });

  it('digests as one part inside a composite, labelled once in the title', () => {
    const window = rangeField({ of: 'time' });
    const item = { name: 'Wrathgate', window: { UUID: 'u', start: '09:00:00', end: '17:00:00' } };
    const name: DashboardField = {
      ...window,
      name: 'name',
      type: 'text',
      kind: 'column',
      label: 'Name',
    };
    const text = rangeType.summary!(item.window, window);
    deepStrictEqual(summaryParts(item, [name, window]), ['Wrathgate', text]);
    strictEqual(
      summaryTitle(item, [name, window], useT()),
      `Name: Wrathgate\nSiege window: ${text}`,
    );
  });
});
