import { deepStrictEqual } from 'node:assert';
import { afterEach, describe, it } from 'node:test';
import { useConfig, useLayers } from 'ohne';

describe('database config merge', () => {
  const added = ['/db-helpers-base', '/db-helpers-app'];

  afterEach(() => {
    for (const path of added) useLayers().remove(path);
  });

  it('merges helpers per key, the closer layer winning a shared name', () => {
    const layers = useLayers();
    layers.add({
      path: '/db-helpers-base',
      defaults: { database: { helpers: { cache: 'a.db', rate: 'a.db' } } },
    });
    layers.add({
      path: '/db-helpers-app',
      input: { database: { helpers: { rate: 'b.db', jobs: 'b.db' } } },
    });
    deepStrictEqual(useConfig().database?.helpers, { cache: 'a.db', rate: 'b.db', jobs: 'b.db' });
  });
});
