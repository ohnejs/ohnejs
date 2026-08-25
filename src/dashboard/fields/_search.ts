import type { DashboardCollection, DashboardField } from '../runtime/meta-types.ts';

import { isUndefined } from '../../utils/is/is-undefined.ts';
import { dashboardMeta } from '../runtime/meta.ts';

/**
 * The relation's target collection, when the discovery read lists it as readable for the user.
 */
export function targetOf(field: DashboardField): DashboardCollection | undefined {
  const target = dashboardMeta()?.collections.find((entry) => entry.name === field.target);
  if (isUndefined(target) || target.operations.read?.allowed !== true) return undefined;
  return target;
}

/**
 * The target's first plain readable text field, the one a search matches and shows.
 */
export function labelFieldOf(target: DashboardCollection): DashboardField | undefined {
  return target.fields.find(
    (field) =>
      field.readable &&
      field.kind === 'column' &&
      field.logicalType === 'text' &&
      field.type !== 'password' &&
      field.name !== 'UUID',
  );
}
