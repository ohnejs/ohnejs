import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { hasRoute } from '../../../src/utils/index.ts';

describe('hasRoute', () => {
  it('finds a listed id', () => {
    strictEqual(hasRoute(['GET /quests', 'POST /uploads'], 'POST /uploads'), true);
  });

  it('rejects an empty list', () => {
    strictEqual(hasRoute([], 'POST /uploads'), false);
  });

  it('rejects the same pattern under another method', () => {
    strictEqual(hasRoute(['GET /uploads'], 'POST /uploads'), false);
  });

  it('counts an any-method route for every method', () => {
    strictEqual(hasRoute(['/uploads'], 'POST /uploads'), true);
    strictEqual(hasRoute(['/uploads'], '/uploads'), true);
  });

  it('never widens a method-bound route to a bare id', () => {
    strictEqual(hasRoute(['POST /uploads'], '/uploads'), false);
  });
});
