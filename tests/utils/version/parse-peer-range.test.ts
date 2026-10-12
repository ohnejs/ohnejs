import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { parsePeerRange } from '../../../src/utils/index.ts';

const LINE = { floor: '0.1.0', ceiling: '0.2.0', exact: false };

describe('parsePeerRange', () => {
  it('reads a written-out range, with or without the `-0`, spaced or not', () => {
    deepStrictEqual(parsePeerRange('>=0.1.0 <0.2.0-0'), LINE);
    deepStrictEqual(parsePeerRange('>=0.1.0 <0.2.0'), LINE);
    deepStrictEqual(parsePeerRange('  >= 0.1.0  <  0.2.0-0 '), LINE);
  });

  it("ends a lone `>=` at its floor's line", () => {
    deepStrictEqual(parsePeerRange('>=0.1.0'), LINE);
    deepStrictEqual(parsePeerRange('>=0.0.2'), { floor: '0.0.2', ceiling: '0.1.0', exact: false });
    deepStrictEqual(parsePeerRange('>=1.3.0'), { floor: '1.3.0', ceiling: '2.0.0', exact: false });
  });

  it('reads an exact version, and keeps a prerelease ceiling as written', () => {
    deepStrictEqual(parsePeerRange('0.2.0-beta.1'), {
      floor: '0.2.0-beta.1',
      ceiling: '0.2.0-beta.1',
      exact: true,
    });
    strictEqual(parsePeerRange('>=0.1.0 <0.2.0-10')?.ceiling, '0.2.0-10');
  });

  it('answers `undefined` for every other shape', () => {
    const others = ['^0.1.0', '~0.1.0', '*', '0.1.x', '>=0.1.0 || 1.0.0', 'workspace:*', '>=x'];
    for (const range of [...others, '>=0.1.0 <bar', '<0.2.0', '']) {
      strictEqual(parsePeerRange(range), undefined, range);
    }
  });
});
