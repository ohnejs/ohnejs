import type { DashboardMenuItem } from 'ohnejs/dashboard';

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { menuSections } from '../../../../src/base/dashboard/components/menu-sections.ts';

const link = (id: string): DashboardMenuItem => ({ id, label: id, to: `/${id}` });

describe('menuSections', () => {
  it('makes each root group a section under its label', () => {
    const shop = { id: 'shop', label: 'Shop', children: [link('orders')] };
    assert.deepEqual(menuSections([shop]), [
      { key: 'shop', label: 'Shop', items: [link('orders')] },
    ]);
  });

  it('gathers adjacent root links into one untitled section, keyed by the first', () => {
    const shop = { id: 'shop', label: 'Shop', children: [link('orders')] };
    assert.deepEqual(menuSections([link('a'), link('b'), shop, link('c')]), [
      { key: 'a', label: '', items: [link('a'), link('b')] },
      { key: 'shop', label: 'Shop', items: [link('orders')] },
      { key: 'c', label: '', items: [link('c')] },
    ]);
  });
});
