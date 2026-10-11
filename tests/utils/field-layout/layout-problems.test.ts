import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { layoutProblems } from '../../../src/utils/field-layout/layout-problems.ts';

const NAMES = ['thrall', 'jaina', 'arthas', 'sylvanas'];

const titles = (layout: unknown, names = NAMES): string[] =>
  layoutProblems(layout, names).map((problem) => problem.title);

describe('layoutProblems', () => {
  it('finds nothing in a sound or omitted layout', () => {
    deepStrictEqual(layoutProblems(undefined, NAMES), []);
    deepStrictEqual(
      layoutProblems(
        [
          { row: ['thrall | 50%', { card: ['jaina'] }] },
          '---',
          { tabs: [{ label: 'Scourge', fields: ['arthas | auto'] }] },
          { card: { label: { key: 'app.forsaken' }, collapsible: true, fields: ['sylvanas'] } },
        ],
        NAMES,
      ),
      [],
    );
  });

  it('defaults the option name to `layout` and the scope to nothing', () => {
    deepStrictEqual(layoutProblems(['thral'], NAMES), [
      {
        title: '`layout` references unknown field `thral`',
        body: ['No field `thral` is declared.', 'Did you mean `thrall`?'],
      },
    ]);
  });

  it('carries the option name and scope into the messages', () => {
    const [problem] = layoutProblems(['thrall', 'thrall'], NAMES, {
      option: 'dashboard.layout',
      scope: ' in collection `Heroes`',
    });
    strictEqual(problem?.title, '`dashboard.layout` repeats field `thrall`');
    deepStrictEqual(problem?.body, [
      'A field renders once in collection `Heroes`.',
      'Two controls over one value cannot stay in sync.',
    ]);
  });

  it('rejects a non-array or empty layout once', () => {
    deepStrictEqual(titles('thrall'), ['Invalid `layout` declaration']);
    deepStrictEqual(titles([]), ['The `layout` list is empty']);
  });

  it('collects every problem in reading order', () => {
    deepStrictEqual(titles(['nope', 'thrall | wide', { row: ['---'] }, 'thrall']), [
      '`layout` references unknown field `nope`',
      'Invalid `layout` width `wide`',
      'A `layout` row holds a rule',
      '`layout` repeats field `thrall`',
    ]);
  });

  it('reports a malformed container once without entering it', () => {
    deepStrictEqual(titles([{ card: [] }, { tabs: 'x' }, { row: { nope: true } }]), [
      'Invalid `layout` card',
      'Invalid `layout` tabs',
      'Invalid `layout` row',
    ]);
  });

  it('rejects nested rows, bad node shapes, and unknown keys', () => {
    deepStrictEqual(
      titles([
        { row: [{ row: ['thrall'] }] },
        42,
        { row: ['jaina'], card: ['arthas'] },
        { card: { fields: ['sylvanas'], icon: 'x' } },
        { tabs: [{ label: 'A', fields: ['arthas'], icon: 'x' }] },
      ]),
      [
        'A `layout` row nests a row',
        'Invalid `layout` node',
        'Invalid `layout` node',
        'Unknown `layout` card key `icon`',
        'Unknown `layout` tab key `icon`',
      ],
    );
  });

  it('rejects a missing tab label, empty tab fields, and a non-boolean collapsible', () => {
    deepStrictEqual(
      titles([
        { tabs: [{ fields: ['thrall'] }, { label: 'B', fields: [] }] },
        { card: { collapsible: 'yes', fields: ['jaina'] } },
      ]),
      [
        'A `layout` tab has no label',
        'A `layout` tab has no fields',
        'Invalid `layout` card `collapsible` flag',
      ],
    );
  });

  it('checks labels with `isLabel` when given', () => {
    const layout = [{ tabs: [{ label: () => 'Horde', fields: ['thrall'] }] }];
    deepStrictEqual(titles(layout), ['Invalid `layout` tab label']);
    deepStrictEqual(layoutProblems(layout, NAMES, { isLabel: () => true }), []);
  });
});
