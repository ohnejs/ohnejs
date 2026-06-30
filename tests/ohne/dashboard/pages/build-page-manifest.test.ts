import { deepStrictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { buildDashboardManifest, type DashboardPage } from '../../../../src/ohne/index.ts';

const page = (pattern: string, module: string): DashboardPage => ({
  pattern,
  module,
  file: '',
  layer: 'app',
});

describe('buildDashboardManifest', () => {
  it('builds the served URL from base and module', () => {
    deepStrictEqual(buildDashboardManifest([page('/', 'pages/index.ts')], '/m/app'), [
      { pattern: '/', url: '/m/app/pages/index.ts' },
    ]);
  });

  it('orders most-specific-first regardless of input order', () => {
    const manifest = buildDashboardManifest(
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
