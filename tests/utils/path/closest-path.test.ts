import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { closestPath } from '../../../src/utils/index.ts';

describe('closestPath', () => {
  const tabs = ['/sites/a', '/sites/a/logs', '/sites/a/domains'];

  it('takes an exact match, else the longest parent', () => {
    strictEqual(closestPath(tabs, '/sites/a'), '/sites/a');
    strictEqual(closestPath(tabs, '/sites/a/logs'), '/sites/a/logs');
    strictEqual(closestPath(tabs, '/sites/a/logs/42'), '/sites/a/logs');
    strictEqual(closestPath(tabs, '/sites/a/backups'), '/sites/a');
  });

  it('compares whole segments', () => {
    strictEqual(closestPath(tabs, '/sites/ab'), undefined);
    strictEqual(closestPath(tabs, '/sites/a/logsx'), '/sites/a');
  });

  it('ignores a trailing slash', () => {
    strictEqual(closestPath(['/sites/a/'], '/sites/a'), '/sites/a/');
    strictEqual(closestPath(['/sites/a'], '/sites/a/'), '/sites/a');
  });

  it('matches the root only exactly', () => {
    strictEqual(closestPath(['/', '/sites'], '/'), '/');
    strictEqual(closestPath(['/', '/sites'], '/sites/a'), '/sites');
    strictEqual(closestPath(['/'], '/logs'), undefined);
  });
});
