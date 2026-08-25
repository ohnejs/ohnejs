import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { structureAccepts, structureDropIndex } from '../../../src/dashboard/ui/structure-model.ts';

describe('structureAccepts', () => {
  it('refuses without a drag in flight', () => {
    strictEqual(structureAccepts(null, 'a', false), false);
    strictEqual(structureAccepts(null, 'a', true, ['x']), false);
  });

  it('accepts the structure own item', () => {
    strictEqual(structureAccepts({ structureId: 'a', type: undefined }, 'a', false), true);
    strictEqual(structureAccepts({ structureId: 'a', type: 'x' }, 'a', true, ['y']), true);
  });

  it('refuses another structure non-cross item', () => {
    strictEqual(structureAccepts({ structureId: 'b', type: undefined }, 'a', false), false);
    strictEqual(structureAccepts({ structureId: 'b', type: 'x' }, 'a', true, ['x']), false);
  });

  it('refuses a cross-drop item unless cross drops are allowed', () => {
    strictEqual(structureAccepts({ structureId: null, type: undefined }, 'a', false), false);
    strictEqual(structureAccepts({ structureId: null, type: undefined }, 'a', true), true);
  });

  it('filters cross-drop items by type', () => {
    strictEqual(structureAccepts({ structureId: null, type: 'y' }, 'a', true, ['x']), false);
    strictEqual(structureAccepts({ structureId: null, type: 'x' }, 'a', true, ['x']), true);
  });

  it('skips the type filter when either side leaves the type open', () => {
    strictEqual(structureAccepts({ structureId: null, type: undefined }, 'a', true, ['x']), true);
    strictEqual(structureAccepts({ structureId: null, type: 'y' }, 'a', true), true);
  });
});

describe('structureDropIndex', () => {
  it('keeps the index for a before drop', () => {
    strictEqual(structureDropIndex(2, 'before', null), 2);
  });

  it('advances by one for an after drop', () => {
    strictEqual(structureDropIndex(2, 'after', null), 3);
  });

  it('shifts a same-list target below the removed slot up by one', () => {
    strictEqual(structureDropIndex(3, 'before', 1), 2);
    strictEqual(structureDropIndex(3, 'after', 1), 3);
  });

  it('keeps a same-list target at or above the removed slot', () => {
    strictEqual(structureDropIndex(0, 'before', 3), 0);
    strictEqual(structureDropIndex(1, 'before', 1), 1);
  });

  it('resolves a drop on the dragged item own zones to its slot', () => {
    strictEqual(structureDropIndex(1, 'after', 1), 1);
  });
});
