import { deepStrictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { resolveAllowedBlocks } from '../../../src/ohne/blocks/resolve-allowed-blocks.ts';

describe('resolveAllowedBlocks', () => {
  it('resolves an omitted allow to every registered block, sorted', () => {
    deepStrictEqual(resolveAllowedBlocks(undefined, ['Quote', 'Hero']), {
      ok: true,
      allowed: ['Hero', 'Quote'],
    });
  });

  it('sorts an explicit list without touching the input', () => {
    const allow = ['Quote', 'Hero'];
    deepStrictEqual(resolveAllowedBlocks(allow, ['Hero', 'Quote']), {
      ok: true,
      allowed: ['Hero', 'Quote'],
    });
    deepStrictEqual(allow, ['Quote', 'Hero']);
  });

  it('names the first unregistered block', () => {
    deepStrictEqual(resolveAllowedBlocks(['Hero', 'Ghost'], ['Hero']), {
      ok: false,
      reason: 'unknown',
      block: 'Ghost',
    });
  });

  it('reports empty for an omitted allow with nothing registered', () => {
    deepStrictEqual(resolveAllowedBlocks(undefined, []), { ok: false, reason: 'empty' });
  });

  it('reports empty for an explicit empty list', () => {
    deepStrictEqual(resolveAllowedBlocks([], ['Hero']), { ok: false, reason: 'empty' });
  });
});
