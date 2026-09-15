import { queryMetadata, type RoleName } from 'ohnejs';
import { hasKey } from 'ohnejs/utils';

import type { User } from './types.ts';

/**
 * The `Users` fields `toUser` projects, in the order the collection declares them.
 */
export const USER_FIELDS = [
  'UUID',
  'email',
  'roles',
  'dashboardLanguage',
  'contentLanguage',
  'timezone',
  'dateFormat',
  'timeFormat',
  'smartClipboard',
] as const;

/**
 * Projects a `Users` record onto the public `User` shape.
 * A settings member the record lacks or holds as `null` takes its default: `null`, `LL`, `LTS`, or `false`.
 * An override of `Users` that dropped a settings field therefore degrades to defaults instead of throwing.
 * Nothing else is copied, so a record read with `password` selected still answers without the hash.
 */
export function toUser(record: Record<string, unknown>): User {
  return {
    UUID: record.UUID as string,
    email: record.email as string,
    roles: record.roles as RoleName[],
    dashboardLanguage: (record.dashboardLanguage ?? null) as string | null,
    contentLanguage: (record.contentLanguage ?? null) as string | null,
    timezone: (record.timezone ?? null) as string | null,
    dateFormat: (record.dateFormat ?? 'LL') as string,
    timeFormat: (record.timeFormat ?? 'LTS') as string,
    smartClipboard: (record.smartClipboard ?? false) as boolean,
  };
}

/**
 * The `USER_FIELDS` the `Users` collection declares, for a read that names its columns.
 * A field an override dropped is skipped, so the select never names a column the table lacks.
 */
export function userColumns(): string[] {
  const { fields } = queryMetadata('Users');
  return USER_FIELDS.filter((name) => hasKey(fields, name));
}
