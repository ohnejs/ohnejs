import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { flush } from '../../../../src/utils/reactive/_scheduler.ts';
import { ref } from '../../../../src/utils/reactive/ref.ts';
import { type FakeElement, findElement } from '../../_fake-dom.ts';
import { allByClass, byClass, dispatch } from './_chart-dom.ts';

const { lineChart } = await import('../../../../src/dashboard/ui/charts/line-chart.ts');

interface Day {
  day: string;
  gold: number | null;
  previous: number | null;
}

const WEEK: Day[] = [
  { day: 'Mon', gold: 120, previous: 90 },
  { day: 'Tue', gold: 340, previous: 150 },
  { day: 'Wed', gold: null, previous: 210 },
  { day: 'Thu', gold: 410, previous: 260 },
  { day: 'Fri', gold: 520, previous: 300 },
];

function gold(data: () => Day[] | undefined, twoSeries = false): FakeElement {
  return lineChart(data, {
    x: (row) => row.day,
    series: [
      { name: 'Gold looted', value: (row) => row.gold },
      ...(twoSeries
        ? [{ name: 'Last week', value: (row: Day) => row.previous, dashed: true }]
        : []),
    ],
  }) as unknown as FakeElement;
}

function lines(element: FakeElement): string[] {
  return allByClass(element, 'ohne-chart-line')
    .filter((path) => !(path.getAttribute('class') ?? '').includes('partial'))
    .map((path) => path.getAttribute('d') ?? '');
}

describe('lineChart', () => {
  it('holds a placeholder while loading, then an empty state, then the plot', () => {
    const days = ref<Day[] | undefined>(undefined);
    const element = gold(() => days.value);
    strictEqual(
      findElement(element, (el) => el.getAttribute('aria-busy') === 'true')?.tagName,
      'DIV',
    );
    days.value = [];
    flush();
    ok(element.textContent.includes('No data yet'));
    days.value = WEEK;
    flush();
    strictEqual(lines(element).length, 1);
  });

  it('breaks the line at a null instead of dropping to zero', () => {
    const [path] = lines(gold(() => WEEK));
    strictEqual(path!.match(/M/g)?.length, 2);
  });

  it('shows a legend for two series and none for one', () => {
    strictEqual(
      byClass(
        gold(() => WEEK),
        'ohne-chart-legend',
      ),
      undefined,
    );
    const legend = byClass(
      gold(() => WEEK, true),
      'ohne-chart-legend',
    )!;
    strictEqual(legend.textContent, 'Gold lootedLast week');
    ok(byClass(legend, 'ohne-chart-key-dashed'));
  });

  it('paints series in fixed slots by index', () => {
    const element = gold(() => WEEK, true);
    const styles = allByClass(element, 'ohne-chart-key').map((key) => key.getAttribute('style'));
    deepStrictEqual(styles, [
      '--ohne-chart-ink: var(--ohne-chart-1)',
      '--ohne-chart-ink: var(--ohne-chart-2)',
    ]);
  });

  it('carries every value in the hidden table, a gap as an empty cell', () => {
    const table = byClass(
      gold(() => WEEK, true),
      'ohne-chart-sr',
    )!;
    ok(table.textContent.startsWith('Gold lootedLast week'));
    ok(table.textContent.includes('Wed210'));
    ok(table.textContent.includes('Fri520300'));
  });

  it('steps the crosshair with the keyboard and reads every series', () => {
    const element = byClass(
      gold(() => WEEK, true),
      'ohne-chart',
    )!;
    const tip = byClass(element, 'ohne-chart-tip')!;
    dispatch(element, 'focus');
    flush();
    strictEqual(tip.textContent, 'Fri520Gold looted300Last week');
    dispatch(element, 'keydown', { key: 'ArrowLeft' });
    flush();
    strictEqual(tip.textContent, 'Thu410Gold looted260Last week');
    dispatch(element, 'keydown', { key: 'ArrowLeft' });
    flush();
    strictEqual(tip.textContent, 'Wed210Last week');
    dispatch(element, 'keydown', { key: 'Home' });
    flush();
    strictEqual(tip.textContent, 'Mon120Gold looted90Last week');
  });

  it('dashes the segments into a partial row', () => {
    const element = lineChart(() => WEEK.slice(3), {
      x: (row) => row.day,
      series: [{ name: 'Gold looted', value: (row) => row.gold }],
      partial: (row) => row.day === 'Fri',
    }) as unknown as FakeElement;
    const partial = allByClass(element, 'ohne-chart-line-partial');
    strictEqual(lines(element)[0], '');
    ok(partial[0]!.getAttribute('d')!.startsWith('M'));
  });

  it('folds series past the eighth into one Other', () => {
    const element = lineChart(() => WEEK, {
      x: (row) => row.day,
      series: Array.from({ length: 10 }, (_, index) => ({
        name: `Realm ${index + 1}`,
        value: () => index,
      })),
    }) as unknown as FakeElement;
    const legend = byClass(element, 'ohne-chart-legend')!;
    strictEqual(legend.childNodes.length, 8);
    ok(legend.textContent.endsWith('Realm 7Other'));
    const table = byClass(element, 'ohne-chart-sr')!;
    ok(table.textContent.includes('Mon012345624'));
  });

  it('plots a value too small for a step', () => {
    const element = lineChart(() => [{ day: 'Mon', drift: 0.1 + 0.2 - 0.3 }], {
      x: (row) => row.day,
      series: [{ name: 'Drift', value: (row) => row.drift }],
    }) as unknown as FakeElement;
    strictEqual(lines(element).length, 1);
  });
});
