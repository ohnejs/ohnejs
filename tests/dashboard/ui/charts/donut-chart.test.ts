import { ok, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { h } from '../../../../src/dashboard/render/h.ts';
import { flush } from '../../../../src/utils/reactive/_scheduler.ts';
import { type FakeElement } from '../../_fake-dom.ts';
import { allByClass, byClass, dispatch } from './_chart-dom.ts';

const { donutChart } = await import('../../../../src/dashboard/ui/charts/donut-chart.ts');

interface Class {
  name: string;
  players: number;
}

const CLASSES: Class[] = [
  { name: 'Warrior', players: 40 },
  { name: 'Mage', players: 30 },
  { name: 'Priest', players: 20 },
  { name: 'Rogue', players: 10 },
];

const MANY: Class[] = [
  'Warrior',
  'Paladin',
  'Hunter',
  'Rogue',
  'Priest',
  'Shaman',
  'Mage',
  'Warlock',
  'Druid',
  'Death Knight',
].map((name, index) => ({ name, players: index === 0 ? 1 : 10 - index }));

function donut(rows: Class[], center?: HTMLElement): FakeElement {
  return donutChart(() => rows, {
    label: (row) => row.name,
    value: (row) => row.players,
    center,
  }) as unknown as FakeElement;
}

describe('donutChart', () => {
  it('draws a slice per row and lists each with its value and share', () => {
    const element = donut(CLASSES);
    strictEqual(allByClass(element, 'ohne-donut-slice').length, 4);
    const legend = byClass(element, 'ohne-donut-legend')!;
    ok(legend.textContent.startsWith('Warrior4040%Mage3030%'));
  });

  it('shows the total in the hole unless a center is given', () => {
    strictEqual(byClass(donut(CLASSES), 'ohne-donut-center')!.textContent, '100Total');
    const custom = donut(CLASSES, h('strong', null, 'Raid ready'));
    strictEqual(byClass(custom, 'ohne-donut-center')!.textContent, 'Raid ready');
  });

  it('keeps the seven largest of more than eight rows and folds the rest into Other', () => {
    const element = donut(MANY);
    const names = allByClass(element, 'ohne-donut-name').map((name) => name.textContent);
    strictEqual(names.length, 8);
    strictEqual(names.join(','), 'Paladin,Hunter,Rogue,Priest,Shaman,Mage,Warlock,Other');
    const values = allByClass(element, 'ohne-donut-value').map((value) => value.textContent);
    strictEqual(values.at(-1), '4');
    const keys = allByClass(element, 'ohne-chart-key').map((key) => key.getAttribute('style'));
    strictEqual(keys.at(-1), '--ohne-chart-ink: var(--ohne-muted-foreground)');
  });

  it('draws one whole ring for a single slice', () => {
    const element = donut([{ name: 'Warrior', players: 5 }]);
    const [slice] = allByClass(element, 'ohne-donut-slice');
    strictEqual(slice!.getAttribute('d')!.match(/M/g)?.length, 2);
  });

  it('lifts the slice under the keyboard and reads it in the tooltip', () => {
    const element = byClass(donut(CLASSES), 'ohne-chart')!;
    dispatch(element, 'focus');
    flush();
    strictEqual(byClass(element, 'ohne-chart-tip')!.textContent, 'Warrior4040%');
    ok(byClass(element, 'ohne-donut-active'));
    dispatch(element, 'keydown', { key: 'End' });
    flush();
    strictEqual(byClass(element, 'ohne-chart-tip')!.textContent, 'Rogue1010%');
  });
});
