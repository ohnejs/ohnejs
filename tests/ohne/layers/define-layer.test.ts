import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { defineLayer } from '../../../src/ohne/index.ts';

describe('defineLayer', () => {
  it('returns the definition unchanged', () => {
    const layer = {
      defaults: { disable: { routes: ['/x'] } },
      strategies: { 'disable.routes': 'concat-unique' as const },
    };
    strictEqual(defineLayer(layer), layer);
  });
});
