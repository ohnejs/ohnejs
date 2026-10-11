import { ok, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { flush } from '../../../../src/utils/reactive/_scheduler.ts';
import { ref } from '../../../../src/utils/reactive/ref.ts';
import { type FakeElement, findElement } from '../../_fake-dom.ts';
import { allByClass, byClass, dispatch } from './_chart-dom.ts';

const { barList } = await import('../../../../src/dashboard/ui/charts/bar-list.ts');

interface Realm {
  name: string;
  raids: number;
  before: number;
}

const REALMS: Realm[] = [
  { name: 'Argent Dawn', raids: 400, before: 320 },
  { name: 'Silvermoon', raids: 200, before: 250 },
  { name: 'Draenor', raids: 100, before: 100 },
  { name: 'Ragnaros', raids: 50, before: 0 },
];

describe('barList', () => {
  it('sizes each bar against the largest row and prints the value at the end', () => {
    const element = barList(() => REALMS, {
      label: (realm) => realm.name,
      value: (realm) => realm.raids,
    }) as unknown as FakeElement;
    const fills = allByClass(element, 'ohne-bar-list-fill').map((fill) =>
      fill.getAttribute('style'),
    );
    ok(fills[0]!.endsWith('width: 100%'));
    ok(fills[1]!.endsWith('width: 50%'));
    const values = allByClass(element, 'ohne-bar-list-value').map((value) => value.textContent);
    strictEqual(values.join(' '), '400 200 100 50');
  });

  it('sizes fractional rows against the largest, not against one', () => {
    const element = barList(() => [0.42, 0.21], {
      label: (share) => String(share),
      value: (share) => share,
    }) as unknown as FakeElement;
    const fills = allByClass(element, 'ohne-bar-list-fill').map((fill) =>
      fill.getAttribute('style'),
    );
    ok(fills[0]!.endsWith('width: 100%'));
    ok(fills[1]!.endsWith('width: 50%'));
  });

  it('shows a change per row against the previous period', () => {
    const element = barList(() => REALMS, {
      label: (realm) => realm.name,
      value: (realm) => realm.raids,
      previous: (realm) => realm.before,
    }) as unknown as FakeElement;
    const deltas = allByClass(element, 'ohne-delta').map((pill) => pill.textContent);
    strictEqual(deltas.join(' '), '+25% -20% 0% New');
  });

  it('shows the top rows, then every row behind the button', () => {
    const element = barList(() => REALMS, {
      label: (realm) => realm.name,
      value: (realm) => realm.raids,
      visible: 2,
    }) as unknown as FakeElement;
    strictEqual(allByClass(element, 'ohne-bar-list-row').length, 2);
    const more = findElement(element, (el) => el.tagName === 'BUTTON')!;
    ok(more.textContent.includes('Show all'));
    dispatch(more, 'click');
    flush();
    strictEqual(allByClass(element, 'ohne-bar-list-row').length, 4);
    ok(more.textContent.includes('Show fewer'));
  });

  it('turns rows into links and keeps one Tab stop', () => {
    const element = barList(() => REALMS, {
      label: (realm) => realm.name,
      value: (realm) => realm.raids,
      href: (realm) => `/realms/${realm.name}`,
    }) as unknown as FakeElement;
    const rows = allByClass(element, 'ohne-bar-list-row');
    strictEqual(rows[0]!.tagName, 'A');
    strictEqual(rows[1]!.getAttribute('href'), '/realms/Silvermoon');
    strictEqual(rows.filter((row) => row.getAttribute('tabindex') === '0').length, 1);
  });

  it('holds placeholder rows while loading', () => {
    const realms = ref<Realm[] | undefined>(undefined);
    const element = barList(() => realms.value, {
      label: (realm) => realm.name,
      value: (realm) => realm.raids,
      visible: 3,
    }) as unknown as FakeElement;
    strictEqual(allByClass(element, 'ohne-skeleton').length, 3);
    realms.value = REALMS;
    flush();
    strictEqual(byClass(element, 'ohne-skeleton'), undefined);
  });
});
