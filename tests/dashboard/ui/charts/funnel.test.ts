import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { type FakeElement } from '../../_fake-dom.ts';
import { allByClass } from './_chart-dom.ts';

const { funnel } = await import('../../../../src/dashboard/ui/charts/funnel.ts');

const RECRUITMENT = [
  { step: 'Applied', players: 800 },
  { step: 'Trial raid', players: 200 },
  { step: 'Raider', players: 50 },
  { step: 'Officer', players: 60 },
];

describe('funnel', () => {
  it('numbers each step and sizes its bar against the largest', () => {
    const element = funnel(() => RECRUITMENT, {
      label: (row) => row.step,
      value: (row) => row.players,
    }) as unknown as FakeElement;
    const heads = allByClass(element, 'ohne-funnel-head').map((head) => head.textContent);
    strictEqual(heads.join(' | '), '1Applied800 | 2Trial raid200 | 3Raider50 | 4Officer60');
    const fill = allByClass(element, 'ohne-funnel-fill')[1]!;
    strictEqual(fill.getAttribute('style'), '--ohne-chart-ink: var(--ohne-chart-1); width: 25%');
  });

  it('writes the share of the step before and of the first, and none past its base', () => {
    const element = funnel(() => RECRUITMENT, {
      label: (row) => row.step,
      value: (row) => row.players,
    }) as unknown as FakeElement;
    const rates = allByClass(element, 'ohne-funnel-rate').map((rate) => rate.textContent);
    strictEqual(rates[0], '');
    strictEqual(rates[1], '25% of previous');
    strictEqual(rates[2], '25% of previous · 6.3% of first');
    strictEqual(rates[3], '');
  });

  it('writes no share of a first step of zero', () => {
    const element = funnel(() => [0, 5, 0], {
      label: (players) => String(players),
      value: (players) => players,
    }) as unknown as FakeElement;
    const rates = allByClass(element, 'ohne-funnel-rate').map((rate) => rate.textContent);
    strictEqual(rates.join(' | '), ' |  | 0.0% of previous');
  });
});
