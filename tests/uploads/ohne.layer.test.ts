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
import uploadsLayer from '../../src/uploads/ohne.layer.ts';

type Outline = (string | { [id: string]: Outline })[];

useLayers().add({ path: '/menu-base', defaults: { ...DEFAULTS, ...baseLayer.defaults } });
useLayers().add({ path: '/menu-uploads', defaults: uploadsLayer.defaults });
useRoles().register('menu-admin', { name: 'menu-admin', role: { capabilities: ['*'] } });
useRoles().register('menu-viewer', { name: 'menu-viewer', role: { capabilities: [] } });

const collections = ['Users', 'Uploads', 'UploadsJournal', 'UploadsSessions'].map(
  (name) => ({ name, segment: name.toLowerCase(), label: name }) as DashboardCollection,
);

/**
 * The tree a user holding `role` sees, as ids, each group as `{ id: children }`.
 */
async function outline(role: string): Promise<Outline> {
  const user = { roles: [role] } as unknown as User;
  const walk = (menu: DashboardMenuItem[]): Outline =>
    menu.map((node) => (node.children ? { [node.id]: walk(node.children) } : node.id));
  return walk(await resolveDashboardMenu(user, collections));
}

describe('the uploads menu nodes', () => {
  it('show the media page in place of the uploads tables', async () => {
    deepStrictEqual(await outline('menu-admin'), [
      { general: ['overview', 'media'] },
      { management: ['Users'] },
    ]);
  });

  it('show no media page to a viewer who may not read `Uploads`', async () => {
    deepStrictEqual(await outline('menu-viewer'), [
      { general: ['overview'] },
      { management: ['Users'] },
    ]);
  });

  it('let an app bring the `Uploads` table back', async () => {
    useLayers().add({
      path: '/menu-app',
      input: { dashboard: { menu: { Uploads: { hidden: false } } } },
    });
    try {
      deepStrictEqual(await outline('menu-admin'), [
        { general: ['overview', 'media'] },
        { collections: ['Uploads'] },
        { management: ['Users'] },
      ]);
    } finally {
      useLayers().remove('/menu-app');
    }
  });
});
