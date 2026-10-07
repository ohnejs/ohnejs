import type { DashboardCollection, DashboardField } from '../runtime/meta-types.ts';

import { isUndefined } from '../../utils/is/is-undefined.ts';
import { dashboardMeta } from '../runtime/meta.ts';

/**
 * The collection named `name`, when the discovery read lists it as readable for the user.
 */
export function readableCollection(name: string | undefined): DashboardCollection | undefined {
  const collection = dashboardMeta()?.collections.find((entry) => entry.name === name);
  if (isUndefined(collection) || collection.operations.read?.allowed !== true) return undefined;
  return collection;
}

/**
 * The relation's target collection, when the discovery read lists it as readable for the user.
 */
export function targetOf(field: DashboardField): DashboardCollection | undefined {
  return readableCollection(field.target);
}

/**
 * Whether a cell summary may draw from the field: readable, never `UUID` or a password.
 */
export function summarizable(field: DashboardField): boolean {
  return field.readable && field.type !== 'password' && field.name !== 'UUID';
}
