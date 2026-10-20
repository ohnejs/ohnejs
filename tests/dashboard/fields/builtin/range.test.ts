import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { DashboardField } from '../../../../src/dashboard/runtime/meta-types.ts';
import type { FakeElement } from '../../_fake-dom.ts';

import { flush } from '../../../../src/utils/reactive/_scheduler.ts';
import { effectScope } from '../../../../src/utils/reactive/effect-scope.ts';
import { seedMessages } from '../../_fake-messages.ts';
import { fire } from '../../ui/_events.ts';
import '../_controls.ts';

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
