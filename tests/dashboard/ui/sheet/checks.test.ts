import { deepStrictEqual, notStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { createRowChecks } from '../../../../src/dashboard/ui/sheet/checks.ts';

const page = ['a', 'b', 'c', 'd', 'e', 'f'];

function checkedKeys(checks: ReturnType<typeof createRowChecks>): string[] {
  return [...checks.keys()].sort();
}

describe('toggle', () => {
  it('starts empty', () => {
    const checks = createRowChecks();
    strictEqual(checks.count(), 0);
    strictEqual(checks.has('a'), false);
    deepStrictEqual(checkedKeys(checks), []);
  });

  it('flips a row on and off', () => {
    const checks = createRowChecks();
    checks.toggle('b', 1, page);
    strictEqual(checks.has('b'), true);
    strictEqual(checks.count(), 1);
    checks.toggle('b', 1, page);
    strictEqual(checks.has('b'), false);
    strictEqual(checks.count(), 0);
  });

  it('counts independent rows', () => {
    const checks = createRowChecks();
    checks.toggle('a', 0, page);
    checks.toggle('d', 3, page);
    strictEqual(checks.count(), 2);
    deepStrictEqual(checkedKeys(checks), ['a', 'd']);
  });
});

describe('span extend', () => {
  it('applies the new checked state downward', () => {
    const checks = createRowChecks();
    checks.toggle('b', 1, page);
    checks.toggle('e', 4, page, true);
    deepStrictEqual(checkedKeys(checks), ['b', 'c', 'd', 'e']);
  });

  it('applies the new checked state upward', () => {
    const checks = createRowChecks();
    checks.toggle('e', 4, page);
    checks.toggle('b', 1, page, true);
    deepStrictEqual(checkedKeys(checks), ['b', 'c', 'd', 'e']);
  });

  it('applies the new unchecked state across the span', () => {
    const checks = createRowChecks();
    checks.toggle('a', 0, page);
    checks.toggle('e', 4, page, true);
    checks.toggle('c', 2, page);
    checks.toggle('a', 0, page, true);
    deepStrictEqual(checkedKeys(checks), ['d', 'e']);
  });

  it('extend with no prior toggle flips the one row', () => {
    const checks = createRowChecks();
    checks.toggle('c', 2, page, true);
    deepStrictEqual(checkedKeys(checks), ['c']);
  });

  it('extend after clear flips the one row', () => {
    const checks = createRowChecks();
    checks.toggle('a', 0, page);
    checks.clear();
    checks.toggle('e', 4, page, true);
    deepStrictEqual(checkedKeys(checks), ['e']);
  });
});

describe('setAll and clear', () => {
  it('checks exactly the given keys', () => {
    const checks = createRowChecks();
    checks.toggle('f', 5, page);
    checks.setAll(['a', 'b', 'c']);
    deepStrictEqual(checkedKeys(checks), ['a', 'b', 'c']);
  });

  it('clears', () => {
    const checks = createRowChecks();
    checks.setAll(page);
    strictEqual(checks.count(), 6);
    checks.clear();
    strictEqual(checks.count(), 0);
    deepStrictEqual(checkedKeys(checks), []);
  });
});

describe('reactivity', () => {
  it('replaces the set on change, so a read after a write sees the new state', () => {
    const checks = createRowChecks();
    const before = checks.keys();
    checks.toggle('a', 0, page);
    const after = checks.keys();
    notStrictEqual(after, before);
    strictEqual(after.has('a'), true);
    strictEqual(before.has('a'), false);
  });
});
