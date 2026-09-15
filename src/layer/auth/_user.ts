import { queryMetadata } from 'ohnejs';
import { hasKey } from 'ohnejs/utils';

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
 * The `USER_FIELDS` the `Users` collection declares, for a read that names its columns.
 * A field an override dropped is skipped, so the select never names a column the table lacks.
 */
export function userColumns(): string[] {
  const { fields } = queryMetadata('Users');
  return USER_FIELDS.filter((name) => hasKey(fields, name));
}
