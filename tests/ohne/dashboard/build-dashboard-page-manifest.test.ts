import { deepStrictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { buildDashboardPageManifest, type DashboardPage } from '../../../src/ohne/index.ts';

const page = (pattern: string, module: string): DashboardPage => ({
  pattern,
  module,
  file: '',
  layer: 'app',
});

describe('buildDashboardPageManifest', () => {
  it('builds the served URL from base and module', () => {
    deepStrictEqual(buildDashboardPageManifest([page('/', 'pages/index.ts')], '/m/app'), [
      { pattern: '/', url: '/m/app/pages/index.ts' },
    ]);
  });

  it('orders most-specific-first regardless of input order', () => {
    const manifest = buildDashboardPageManifest(
      [
        page('/[...all]', 'pages/[...all].ts'),
        page('/users/[id]', 'pages/users/[id].ts'),
        page('/users/new', 'pages/users/new.ts'),
      ],
      '/m/app',
    );
    deepStrictEqual(
      manifest.map((entry) => entry.pattern),
      ['/users/new', '/users/[id]', '/[...all]'],
    );
  });
});
