import { strictEqual } from 'node:assert';
import { before, describe, it } from 'node:test';

import { type FakeElement, findElement, hasClass } from '../_fake-dom.ts';

const { cell, divider, grid, row, section, split, stack, toolbar } =
  await import('../../../src/dashboard/ui/layout.ts');

before(() => {
  Object.assign(document, {
    getElementById: () => ({
      textContent: JSON.stringify({
        apiURL: 'http://api',
        defaultLanguage: 'en',
        messageGroups: [],
      }),
    }),
  });
});

const fake = (element: HTMLElement | ChildNode): FakeElement => element as unknown as FakeElement;

describe('stack', () => {
  it('reads leading options and keeps the rest as children', () => {
    const element = stack({ gap: 1, align: 'center' }, 'Thrall', 'Jaina');
    strictEqual(element.getAttribute('class'), 'ohne-stack ohne-layout-items-center ohne-gap-1');
    strictEqual(element.textContent, 'ThrallJaina');
  });

  it('takes children alone with the defaults', () => {
    const element = stack('Thrall', 'Jaina');
    strictEqual(element.getAttribute('class'), 'ohne-stack ohne-layout-items-stretch ohne-gap-0');
    strictEqual(element.textContent, 'ThrallJaina');
  });
});

describe('row', () => {
  it('centers, starts, and wraps by default', () => {
    strictEqual(
      row('Thrall').getAttribute('class'),
      'ohne-layout-row ohne-layout-items-center ohne-layout-justify-start ohne-gap-0 ohne-layout-wrap',
    );
  });

  it('keeps one line when `wrap` is off', () => {
    strictEqual(
      hasClass(fake(row({ wrap: false, justify: 'between' }, 'Thrall')), 'ohne-layout-wrap'),
      false,
    );
  });
});

describe('grid', () => {
  const inner = (element: HTMLElement): FakeElement => fake(element).childNodes[0] as FakeElement;

  it('fits tracks of at least `min` by default', () => {
    const element = inner(grid('Alliance', 'Horde'));
    strictEqual(element.getAttribute('class'), 'ohne-grid ohne-grid-auto ohne-gap-0');
    strictEqual(element.getAttribute('style'), '--ohne-grid-min: 16rem');
  });

  it('keeps two tracks with `minColumns: 2`', () => {
    strictEqual(
      hasClass(inner(grid({ minColumns: 2, min: '20rem' }, 'Alliance')), 'ohne-grid-pair'),
      true,
    );
  });

  it('holds a fixed track count', () => {
    const element = inner(grid({ columns: 3 }, 'Alliance'));
    strictEqual(element.getAttribute('class'), 'ohne-grid ohne-grid-fixed ohne-gap-0');
    strictEqual(element.getAttribute('style'), '--ohne-grid-columns: 3');
  });

  it('carries each step count up to the next step that sets one', () => {
    strictEqual(
      inner(grid({ columns: { md: 2, xl: 4 } }, 'Alliance')).getAttribute('style'),
      '--ohne-grid-base: 1; --ohne-grid-sm: 1; --ohne-grid-md: 2; --ohne-grid-lg: 2; --ohne-grid-xl: 4',
    );
  });
});

describe('cell', () => {
  it('spans a track count or the whole row', () => {
    strictEqual(cell({ span: 2 }, 'Arthas').getAttribute('style'), '--ohne-cell-span: 2');
    strictEqual(cell({ span: 'full' }, 'Arthas').getAttribute('class'), 'ohne-cell-full');
  });
});

describe('split', () => {
  it('puts main before the aside, stacking under `md` by default', () => {
    const element = fake(split({}, 'Quest log', 'Filters')).childNodes[0] as FakeElement;
    strictEqual(
      element.getAttribute('class'),
      'ohne-split ohne-split-md ohne-split-end ohne-gap-1',
    );
    strictEqual(element.getAttribute('style'), '--ohne-split-aside: 20rem');
    strictEqual(element.textContent, 'Quest logFilters');
  });
});

describe('section', () => {
  it('draws no header without a title, description, or actions', () => {
    const element = section('Thrall');
    strictEqual(element.childNodes.length, 1);
    strictEqual(element.textContent, 'Thrall');
  });

  it('heads the children with an `h2`', () => {
    const element = section({ title: 'Raid roster', gap: 1 }, 'Thrall');
    strictEqual(
      findElement(fake(element), (child) => child.tagName === 'H2')?.textContent,
      'Raid roster',
    );
    strictEqual(hasClass(fake(element.childNodes[1]!), 'ohne-gap-1'), true);
  });
});

describe('divider', () => {
  it('is a rule without a label', () => {
    strictEqual(fake(divider()).tagName, 'HR');
  });

  it('names a labeled separator', () => {
    const element = divider({ label: 'Or' });
    strictEqual(element.getAttribute('role'), 'separator');
    strictEqual(element.getAttribute('aria-label'), 'Or');
    strictEqual(element.textContent, 'Or');
  });
});

describe('toolbar', () => {
  it('spaces by step -1 and sticks on request', () => {
    strictEqual(toolbar('Search').getAttribute('class'), 'ohne-toolbar ohne-gap--1');
    strictEqual(hasClass(fake(toolbar({ sticky: true }, 'Search')), 'ohne-toolbar-sticky'), true);
  });
});
