import type { FieldLayout, RoleName } from 'ohnejs';

import { queryMetadata } from 'ohnejs';
import { hasKey, isUndefined } from 'ohnejs/utils';

import type { User } from './types.ts';

import { accountFields } from './account-layout.ts';

/**
 * Projects a `Users` record onto the public `User` shape.
 * A name or settings member the record lacks or holds as `null` takes its default.
 * The defaults are `null`, `LL`, `LTS`, and `false`.
 * An override of `Users` that dropped a settings field therefore degrades to defaults instead of throwing.
 * With `layout`, every readable field it places beyond those members rides along, `null` when absent.
 * The auth routes pass it, so the account page reads a layer's setting back.
 * Nothing else is copied, so a record read with `password` selected still answers without the hash.
 *
 * @example
 * ```ts
 * const record = await query('Users').createOrThrow({ email, password })
 * return toUser(record, await accountLayout(toUser(record)))
 * ```
 */
export function toUser(record: Record<string, unknown>, layout?: FieldLayout): User {
  const user = {
    UUID: record.UUID as string,
    email: record.email as string,
    firstName: (record.firstName ?? null) as string | null,
    lastName: (record.lastName ?? null) as string | null,
    roles: record.roles as RoleName[],
    dashboardLanguage: (record.dashboardLanguage ?? null) as string | null,
    contentLanguage: (record.contentLanguage ?? null) as string | null,
    timezone: (record.timezone ?? null) as string | null,
    dateFormat: (record.dateFormat ?? 'LL') as string,
    timeFormat: (record.timeFormat ?? 'LTS') as string,
    smartClipboard: (record.smartClipboard ?? false) as boolean,
  };
  if (isUndefined(layout)) return user as User;
  const { fields } = queryMetadata('Users');
  const placed: Record<string, unknown> = {};
  for (const name of accountFields(layout)) {
    if (!hasKey(user, name) && fields[name].readable !== false) placed[name] = record[name] ?? null;
  }
  return { ...user, ...placed } as User;
}
