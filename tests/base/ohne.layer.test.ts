import { deepStrictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { DashboardMenuItem } from '../../src/base/api/dashboard.get.ts';
import type { User } from '../../src/base/auth/types.ts';
import type { DashboardCollection } from '../../src/base/collections-api/describe.ts';

import { resolveDashboardMenu } from '../../src/base/menu/resolve-menu.ts';
import baseLayer from '../../src/base/ohne.layer.ts';
import { DEFAULTS } from '../../src/ohne/layers/config.ts';
import { useLayers } from '../../src/ohne/layers/use-layers.ts';
import { useRoles } from '../../src/ohne/roles/use-roles.ts';

type Outline = (string | { [id: string]: Outline })[];

useLayers().add({ path: '/menu-base', defaults: { ...DEFAULTS, ...baseLayer.defaults } });
useRoles().register('menu-admin', { name: 'menu-admin', role: { capabilities: ['*'] } });

const collections = ['Users', 'Sessions', 'Posts'].map(
  (name) => ({ name, segment: name.toLowerCase(), label: name }) as DashboardCollection,
);

/**
 * The tree an admin sees, as ids, each group as `{ id: children }`.
 */
async function outline(): Promise<Outline> {
  const user = { roles: ['menu-admin'] } as unknown as User;
  const walk = (menu: DashboardMenuItem[]): Outline =>
    menu.map((node) => (node.children ? { [node.id]: walk(node.children) } : node.id));
  return walk(await resolveDashboardMenu(user, collections));
}

describe('the base menu nodes', () => {
  it('keep `Sessions` out of the sidebar', async () => {
    deepStrictEqual(await outline(), [
      { general: ['overview'] },
      { collections: ['Posts'] },
      { management: ['Users'] },
    ]);
  });

  it('let an app bring `Sessions` back', async () => {
    useLayers().add({
      path: '/menu-app',
      input: { dashboard: { menu: { Sessions: { hidden: false, parent: 'management' } } } },
    });
    try {
      deepStrictEqual(await outline(), [
        { general: ['overview'] },
        { collections: ['Posts'] },
        { management: ['Users', 'Sessions'] },
      ]);
    } finally {
      useLayers().remove('/menu-app');
    }
  });
});
