import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { defineConfig } from '../../../src/ohne/index.ts';

describe('defineConfig', () => {
  it('returns the config unchanged', () => {
    const config = { dirs: { api: 'routes' } };
    strictEqual(defineConfig(config), config);
  });
});
