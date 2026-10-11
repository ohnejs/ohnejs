import type { DashboardMenuGroup } from 'ohnejs/dashboard';

import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';

import { baseBrowser } from '../_browser.ts';

type Sidebar = typeof import('../../../../src/base/dashboard/components/sidebar.ts');

const group = (...targets: string[]): DashboardMenuGroup => ({
  label: '',
  items: targets.map((to) => ({ to, label: to })),
});

describe('activeTarget', () => {
  let activeTarget!: Sidebar['activeTarget'];

  before(async () => {
    baseBrowser('/');
    ({ activeTarget } = await import('../../../../src/base/dashboard/components/sidebar.ts'));
  });

  it('lights the closest target over a shorter prefix', () => {
    const menu = [group('/kit', '/kit/charts'), group('/overview')];
    assert.equal(activeTarget(menu, '/kit/charts'), '/kit/charts');
    assert.equal(activeTarget(menu, '/kit'), '/kit');
  });

  it('lights a collection for its record pages', () => {
    const menu = [group('/collections/posts')];
    assert.equal(activeTarget(menu, '/collections/posts/new'), '/collections/posts');
  });

  it('matches whole segments only', () => {
    assert.equal(activeTarget([group('/kit')], '/kitchen'), undefined);
  });

  it('matches the root exactly', () => {
    const menu = [group('/', '/overview')];
    assert.equal(activeTarget(menu, '/'), '/');
    assert.equal(activeTarget(menu, '/overview'), '/overview');
  });
});
