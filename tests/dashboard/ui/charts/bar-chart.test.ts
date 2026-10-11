import { ok, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { flush } from '../../../../src/utils/reactive/_scheduler.ts';
import { type FakeElement } from '../../_fake-dom.ts';
import { allByClass, byClass, dispatch } from './_chart-dom.ts';

const { barChart } = await import('../../../../src/dashboard/ui/charts/bar-chart.ts');

interface Week {
  week: string;
  alliance: number;
  horde: number;
}

const WEEKS: Week[] = [
  { week: 'W1', alliance: 12, horde: 9 },
  { week: 'W2', alliance: 15, horde: 0 },
  { week: 'W3', alliance: 8, horde: 14 },
];

function raids(
  options: { stacked?: boolean; horizontal?: boolean; single?: boolean } = {},
): FakeElement {
  return barChart(() => WEEKS, {
    x: (row) => row.week,
    stacked: options.stacked,
    horizontal: options.horizontal,
    series: [
      { name: 'Alliance', value: (row) => row.alliance },
      ...(options.single ? [] : [{ name: 'Horde', value: (row: Week) => row.horde }]),
    ],
  }) as unknown as FakeElement;
}

function bars(element: FakeElement): string[] {
  return allByClass(element, 'ohne-chart-bar').map((bar) => bar.getAttribute('d') ?? '');
}

describe('barChart', () => {
  it('draws one bar per value and none for a zero', () => {
    strictEqual(bars(raids()).length, 5);
    strictEqual(bars(raids({ single: true })).length, 3);
  });

  it('rounds the data end of every grouped bar', () => {
    for (const d of bars(raids())) ok(d.includes('Q'));
  });

  it('rounds only the top segment of a stack and parts segments by a 2px gap', () => {
    const element = raids({ stacked: true });
    const [allianceW1, hordeW1] = allByClass(element, 'ohne-chart-bar');
    const lower = allianceW1!.getAttribute('d')!;
    const upper = hordeW1!.getAttribute('d')!;
    ok(!lower.includes('Q'));
    ok(upper.includes('Q'));
    const lowerTop = Number(/V([\d.]+)H/.exec(lower)?.[1]);
    const upperBottom = Number(/^M[\d.]+,([\d.]+)/.exec(upper)?.[1]);
    strictEqual(Math.round((lowerTop - upperBottom) * 100) / 100, 2);
  });

  it('grows a horizontal chart with its rows and writes a single series at the tips', () => {
    const element = raids({ horizontal: true, single: true });
    const stage = byClass(element, 'ohne-chart-stage')!;
    ok(/height: \d+px/.test(stage.getAttribute('style')!));
    const tips = allByClass(element, 'ohne-chart-label').map((label) => label.textContent);
    strictEqual(tips.join(' '), '12 15 8');
    strictEqual(byClass(element, 'ohne-chart-gridline'), undefined);
  });

  it('reads every series of the row under the keyboard', () => {
    const element = byClass(raids(), 'ohne-chart')!;
    const tip = byClass(element, 'ohne-chart-tip')!;
    dispatch(element, 'focus');
    flush();
    strictEqual(tip.textContent, 'W112Alliance9Horde');
    dispatch(element, 'keydown', { key: 'ArrowRight' });
    flush();
    strictEqual(tip.textContent, 'W215Alliance0Horde');
    ok(byClass(element, 'ohne-chart-band'));
  });

  it('steps a horizontal chart with the up and down arrows', () => {
    const element = byClass(raids({ horizontal: true }), 'ohne-chart')!;
    const tip = byClass(element, 'ohne-chart-tip')!;
    dispatch(element, 'focus');
    dispatch(element, 'keydown', { key: 'ArrowDown' });
    flush();
    ok(tip.textContent.startsWith('W2'));
    dispatch(element, 'keydown', { key: 'ArrowRight' });
    flush();
    ok(tip.textContent.startsWith('W2'));
  });
});

describe('barChart category labels', () => {
  it('shows every other label in full when shortening would make them read alike', () => {
    const weeks = Array.from({ length: 11 }, (_, index) => ({
      week: `Week ${index + 10}`,
      raids: index,
    }));
    const element = barChart(() => weeks, {
      x: (row) => row.week,
      series: [{ name: 'Raids', value: (row) => row.raids }],
    }) as unknown as FakeElement;
    const labels = allByClass(element, 'ohne-chart-axis')
      .map((label) => label.textContent)
      .filter((text) => text.startsWith('Week'));
    ok(labels.length > 0 && labels.length < weeks.length);
    for (const label of labels) ok(!label.endsWith('…'), label);
  });
});
