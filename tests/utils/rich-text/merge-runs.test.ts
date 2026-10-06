import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { RichTextRun } from '../../../src/utils/index.ts';

import { mergeRuns } from '../../../src/utils/index.ts';

describe('mergeRuns', () => {
  it('returns [] for no runs', () => {
    deepStrictEqual(mergeRuns([]), []);
  });

  it('drops runs with empty text', () => {
    deepStrictEqual(
      mergeRuns([{ text: '' }, { text: 'a', marks: ['em'] }, { text: '', marks: ['em'] }]),
      [{ text: 'a', marks: ['em'] }],
    );
  });

  it('merges neighbours whose marks are equal as sets', () => {
    deepStrictEqual(
      mergeRuns([
        { text: 'a', marks: ['em', 'strong'] },
        { text: 'b', marks: ['strong', 'em', 'strong'] },
      ]),
      [{ text: 'ab', marks: ['strong', 'em'] }],
    );
  });

  it('merges neighbours whose links are deeply equal', () => {
    deepStrictEqual(
      mergeRuns([
        { text: 'a', link: { url: '/x' } },
        { text: 'b', link: { url: '/x' } },
      ]),
      [{ text: 'ab', link: { url: '/x' } }],
    );
  });

  it('merges across a run it drops', () => {
    deepStrictEqual(mergeRuns([{ text: 'a' }, { text: '', marks: ['em'] }, { text: 'b' }]), [
      { text: 'ab' },
    ]);
  });

  it('keeps neighbours with different marks apart', () => {
    deepStrictEqual(mergeRuns([{ text: 'a' }, { text: 'b', marks: ['em'] }, { text: 'c' }]), [
      { text: 'a' },
      { text: 'b', marks: ['em'] },
      { text: 'c' },
    ]);
  });

  it('keeps neighbours with different links apart', () => {
    deepStrictEqual(
      mergeRuns([
        { text: 'a', link: { url: '/x' } },
        { text: 'b', link: { url: '/x', newTab: true } },
        { text: 'c' },
      ]),
      [
        { text: 'a', link: { url: '/x' } },
        { text: 'b', link: { url: '/x', newTab: true } },
        { text: 'c' },
      ],
    );
  });

  it('dedupes marks and sorts them by `RICH_TEXT_MARKS`', () => {
    deepStrictEqual(mergeRuns([{ text: 'a', marks: ['code', 'del', 'em', 'strong', 'code'] }]), [
      { text: 'a', marks: ['strong', 'em', 'del', 'code'] },
    ]);
  });

  it('drops an empty mark list', () => {
    deepStrictEqual(mergeRuns([{ text: 'a', marks: [] }]), [{ text: 'a' }]);
  });

  it('never changes the text', () => {
    const runs: RichTextRun[] = [
      { text: ' \r\n\u0000' },
      { text: 'e', marks: ['em'] },
      { text: '́', marks: ['em'] },
      { text: '\n' },
    ];
    strictEqual(
      mergeRuns(runs)
        .map((run) => run.text)
        .join(''),
      ' \r\n\u0000é\n',
    );
  });

  it('never mutates its input', () => {
    const runs: RichTextRun[] = [
      { text: 'a', marks: ['em', 'strong'] },
      { text: 'b', marks: ['strong', 'em'] },
      { text: '' },
    ];
    const before = structuredClone(runs);
    const merged = mergeRuns(runs);
    merged[0].text += '!';
    deepStrictEqual(runs, before);
  });
});
