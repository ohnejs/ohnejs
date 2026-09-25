import { hasCapability, hasRoute } from 'ohnejs/utils';

/**
 * What the signed-in viewer may do with uploads, one flag per action.
 * A flag holds while the viewer has the capability its route takes and the app serves that route.
 * The write routes sit outside the collections API, so the collection's operations cannot say.
 */
export interface UploadsPermissions {
  /**
   * Whether the viewer may upload files, through `POST /uploads`.
   */
  canUpload: boolean;

  /**
   * Whether the viewer may upload from a URL, through `POST /uploads/fetch`.
   * It takes `uploads.fetch` on top of create.
   */
  canFetch: boolean;

  /**
   * Whether the viewer may create folders, through `POST /uploads/folders`.
   */
  canCreateFolder: boolean;

  /**
   * Whether the viewer may replace a file's bytes, through `POST /uploads/[uuid]/replace`.
   */
  canReplace: boolean;

  /**
   * Whether the viewer may rename an upload and edit its details, through `PATCH /uploads/[uuid]`.
   */
  canEdit: boolean;

  /**
   * Whether the viewer may move uploads, through `POST /uploads/move`.
   */
  canMove: boolean;

  /**
   * Whether the viewer may make uploads private or public, through `POST /uploads/private`.
   */
  canSetPrivate: boolean;

  /**
   * Whether the viewer may copy a temporary link to a private file, through `POST /uploads/[uuid]/link`.
   * It takes the `Uploads` read, public or held.
   */
  canLink: boolean;

  /**
   * Whether the viewer may delete uploads, through `POST /uploads/delete`.
   */
  canDelete: boolean;
}

/**
 * The upload permissions of a viewer holding `held`, while the app serves `routes`.
 * `readable` is the viewer's `Uploads` read verdict, which a temporary link takes.
 */
export function permissionsOf(
  held: readonly string[],
  routes: readonly string[],
  readable: boolean,
): UploadsPermissions {
  const can = (operation: string, route: string): boolean =>
    hasCapability(held, `collection.Uploads.${operation}`) && hasRoute(routes, route);
  return {
    canUpload: can('create', 'POST /uploads'),
    canFetch: can('create', 'POST /uploads/fetch') && hasCapability(held, 'uploads.fetch'),
    canCreateFolder: can('create', 'POST /uploads/folders'),
    canReplace: can('update', 'POST /uploads/[uuid]/replace'),
    canEdit: can('update', 'PATCH /uploads/[uuid]'),
    canMove: can('update', 'POST /uploads/move'),
    canSetPrivate: can('update', 'POST /uploads/private'),
    canLink: readable && hasRoute(routes, 'POST /uploads/[uuid]/link'),
    canDelete: can('delete', 'POST /uploads/delete'),
  };
}
