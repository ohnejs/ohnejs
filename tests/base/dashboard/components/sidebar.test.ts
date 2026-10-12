import type { DashboardMenuItem } from 'ohnejs/dashboard';

import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';

import { baseBrowser } from '../_browser.ts';

type Sidebar = typeof import('../../../../src/base/dashboard/components/sidebar.ts');

const link = (to: string): DashboardMenuItem => ({ id: to, label: to, to });

const group = (id: string, ...children: DashboardMenuItem[]): DashboardMenuItem => ({
  id,
  label: id,
  children,
});

describe('activeTarget', () => {
  let activeTarget!: Sidebar['activeTarget'];

  before(async () => {
    baseBrowser('/');
    ({ activeTarget } = await import('../../../../src/base/dashboard/components/sidebar.ts'));
  });

  it('lights the closest target over a shorter prefix', () => {
    const menu = [group('kit', link('/kit'), link('/kit/charts')), link('/overview')];
    assert.equal(activeTarget(menu, '/kit/charts'), '/kit/charts');
    assert.equal(activeTarget(menu, '/kit'), '/kit');
  });

  it('lights a collection for its record pages', () => {
    const menu = [group('content', link('/collections/posts'))];
    assert.equal(activeTarget(menu, '/collections/posts/new'), '/collections/posts');
  });

  it('reaches a link nested below a group, or below another link', () => {
    const reports = { ...link('/reports'), children: [link('/reports/weekly')] };
    const menu = [group('outer', group('inner', reports))];
    assert.equal(activeTarget(menu, '/reports/weekly'), '/reports/weekly');
    assert.equal(activeTarget(menu, '/reports/daily'), '/reports');
  });

  it('matches whole segments only', () => {
    assert.equal(activeTarget([link('/kit')], '/kitchen'), undefined);
  });

  it('matches the root exactly', () => {
    const menu = [link('/'), link('/overview')];
    assert.equal(activeTarget(menu, '/'), '/');
    assert.equal(activeTarget(menu, '/overview'), '/overview');
  });
});
