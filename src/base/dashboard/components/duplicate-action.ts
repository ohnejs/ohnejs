import { dashboardMeta, type DashboardCollection, useAction } from 'ohnejs/dashboard';
import { hasRoute, untracked } from 'ohnejs/utils';

const DUPLICATE_ROUTE = 'POST /collections/[collection]/[uuid]/duplicate';

/**
 * Whether the dashboard offers Duplicate on `collection`.
 * The user may create there, the app serves the route, and a copy can succeed without input.
 */
export function canDuplicate(collection: DashboardCollection): boolean {
  if (collection.operations.create?.allowed !== true || !collection.duplicable) return false;
  return hasRoute(untracked(dashboardMeta)?.routes ?? [], DUPLICATE_ROUTE);
}

/**
 * Binds duplicating one record of `collection`, every locale it holds included.
 * The returned function resolves whether the copy landed, and `onDone` gets the copy as the server answers it.
 * A `422` toasts the fields it names, any other failure the server's message.
 */
export function duplicateAction(
  collection: DashboardCollection,
  onDone: (copy: Record<string, unknown>) => void,
): (uuid: string) => Promise<boolean> {
  const action = useAction<Record<string, unknown>>(DUPLICATE_ROUTE, {
    params: { collection: collection.segment },
    onDone,
  });
  return (uuid) => action.run({ params: { uuid }, body: {} });
}
