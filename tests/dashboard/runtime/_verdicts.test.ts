import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type {
  DashboardCollection,
  DashboardOperation,
  DashboardOperations,
} from '../../../src/dashboard/runtime/meta-types.ts';

import {
  asksVerdicts,
  capabilityVerdicts,
  foldCounts,
  foldVerdicts,
} from '../../../src/dashboard/runtime/_verdicts.ts';

const open: DashboardOperation = { allowed: true, public: false, scoped: false };
const scoped: DashboardOperation = { allowed: true, public: false, scoped: true };
const refused: DashboardOperation = { allowed: false, public: false, scoped: true };

function collection(
  operations: Partial<DashboardOperations>,
  translatable = false,
): DashboardCollection {
  return {
    name: 'Posts',
    segment: 'posts',
    label: 'Posts',
    translatable,
    singleton: false,
    operations: { read: open, create: null, update: null, delete: null, ...operations },
    fields: [],
    labelFields: [],
  };
}

describe('asksVerdicts', () => {
  it('asks nothing while neither update nor delete is scoped', () => {
    strictEqual(asksVerdicts(collection({ update: open, delete: open })), false);
    strictEqual(asksVerdicts(collection({})), false);
  });

  it('asks once an allowed update or delete is scoped', () => {
    strictEqual(asksVerdicts(collection({ update: scoped, delete: open })), true);
    strictEqual(asksVerdicts(collection({ update: open, delete: scoped })), true);
    strictEqual(asksVerdicts(collection({ delete: scoped })), true);
  });

  it('asks nothing for a scoped operation the user may not run', () => {
    strictEqual(asksVerdicts(collection({ update: refused, delete: open })), false);
    strictEqual(asksVerdicts(collection({ update: refused, delete: refused })), false);
  });

  it('ignores the scope of a read or a create', () => {
    strictEqual(asksVerdicts(collection({ read: scoped, create: scoped, update: open })), false);
  });
});

describe('capabilityVerdicts', () => {
  it('admits every asked UUID to each allowed operation', () => {
    deepStrictEqual(capabilityVerdicts(collection({ update: open, delete: scoped }), ['a', 'b']), {
      update: new Set(['a', 'b']),
      delete: new Set(['a', 'b']),
      deleteTranslation: new Set(),
      select: undefined,
    });
  });

  it('admits nothing to a refused or closed operation', () => {
    deepStrictEqual(capabilityVerdicts(collection({ update: refused }, true), ['a']), {
      update: new Set(),
      delete: new Set(),
      deleteTranslation: new Set(),
      select: undefined,
    });
  });

  it('lets the translation delete follow the delete on a translatable collection', () => {
    const verdicts = capabilityVerdicts(collection({ delete: open }, true), ['a']);
    deepStrictEqual(verdicts.deleteTranslation, new Set(['a']));
    deepStrictEqual(verdicts.update, new Set());
  });
});

describe('foldVerdicts', () => {
  it('folds each named list into a set and carries the select', () => {
    deepStrictEqual(
      foldVerdicts({
        update: { UUIDs: ['a'], select: ['title'] },
        delete: { UUIDs: ['a', 'b'] },
        deleteTranslation: { UUIDs: ['b'] },
      }),
      {
        update: new Set(['a']),
        delete: new Set(['a', 'b']),
        deleteTranslation: new Set(['b']),
        select: ['title'],
      },
    );
  });

  it('reads an absent translation delete as no row and an absent select as no limit', () => {
    deepStrictEqual(foldVerdicts({ update: { UUIDs: ['a'] }, delete: { UUIDs: [] } }), {
      update: new Set(['a']),
      delete: new Set(),
      deleteTranslation: new Set(),
      select: undefined,
    });
  });
});

describe('foldCounts', () => {
  it('reads the update and delete totals', () => {
    deepStrictEqual(
      foldCounts({
        update: { total: 3, select: ['title'] },
        delete: { total: 1 },
        deleteTranslation: { total: 2 },
      }),
      { update: 3, delete: 1 },
    );
  });
});
