import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { permissionsOf } from '../../../../src/uploads/dashboard/components/_permissions.ts';

const ROUTES = [
  'POST /uploads',
  'POST /uploads/fetch',
  'POST /uploads/folders',
  'POST /uploads/[uuid]/replace',
  'PATCH /uploads/[uuid]',
  'POST /uploads/move',
  'POST /uploads/private',
  'POST /uploads/[uuid]/link',
  'POST /uploads/delete',
];

function without(...dropped: string[]): string[] {
  return ROUTES.filter((route) => !dropped.includes(route));
}

describe('permissionsOf', () => {
  it('grants every action to a wildcard viewer while the app serves every route', () => {
    deepStrictEqual(permissionsOf(['*'], ROUTES, true), {
      canUpload: true,
      canFetch: true,
      canCreateFolder: true,
      canReplace: true,
      canEdit: true,
      canMove: true,
      canSetPrivate: true,
      canLink: true,
      canDelete: true,
    });
  });

  it('withholds an action whose route the app dropped, whatever the capabilities', () => {
    const routes = without('POST /uploads', 'POST /uploads/folders');
    const permissions = permissionsOf(['*'], routes, true);
    strictEqual(permissions.canUpload, false);
    strictEqual(permissions.canCreateFolder, false);
    strictEqual(permissions.canMove, true);
    strictEqual(permissions.canDelete, true);
  });

  it('counts an any-method route for the action it serves', () => {
    const routes = [...without('POST /uploads/move'), '/uploads/move'];
    strictEqual(permissionsOf(['*'], routes, true).canMove, true);
  });

  it('withholds upload from a URL without `uploads.fetch`, though the route is served', () => {
    strictEqual(permissionsOf(['collection.Uploads.*'], ROUTES, true).canFetch, false);
  });

  it('follows the capability each action takes', () => {
    deepStrictEqual(permissionsOf(['collection.Uploads.update'], ROUTES, true), {
      canUpload: false,
      canFetch: false,
      canCreateFolder: false,
      canReplace: true,
      canEdit: true,
      canMove: true,
      canSetPrivate: true,
      canLink: true,
      canDelete: false,
    });
  });

  it('links only for a viewer the `Uploads` read admits, while the link route is served', () => {
    strictEqual(permissionsOf([], ROUTES, true).canLink, true);
    strictEqual(permissionsOf(['*'], ROUTES, false).canLink, false);
    strictEqual(permissionsOf(['*'], without('POST /uploads/[uuid]/link'), true).canLink, false);
  });
});
