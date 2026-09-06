import { applyHook, queryMetadata } from 'ohne';
import { isUndefined } from 'ohne/utils';

import type { User } from './types.ts';

declare module 'ohne' {
  interface Hooks {
    /**
     * Filters the `Users` fields a signed-in user edits on the account page and through `PATCH /auth/me`.
     * Fires per request, inside the request context, with the defaults in form order.
     * Drop a setting the app does not offer, or add a field the app declared on `Users`.
     * A name that is not a writable declared field is ignored; an empty list hides the page.
     * Return a replacement `string[]`, or mutate the array in place and return nothing.
     */
    'auth:account-fields': (
      fields: string[],
      context: { user: User },
    ) => void | string[] | Promise<void | string[]>;
  }
}

/**
 * The fields the account page edits when no hook changes the list, in form order.
 * `email` and `roles` are never listed: an administrator changes those through the `Users` collection.
 */
export const DEFAULT_ACCOUNT_FIELDS: readonly string[] = [
  'contentLanguage',
  'dashboardLanguage',
  'timezone',
  'dateFormat',
  'timeFormat',
  'smartClipboard',
  'password',
];

/**
 * Resolves the `Users` fields `user` may edit on the account page, in form order.
 * Runs the `auth:account-fields` hook over the defaults, then keeps the writable declared fields alone.
 * `PATCH /auth/me` and `GET /dashboard` both read it, so the allowlist and the form cannot drift.
 *
 * @example
 * ```ts
 * await accountFields(user) // -> ['contentLanguage', 'dashboardLanguage', 'timezone', ...]
 * ```
 */
export async function accountFields(user: User): Promise<string[]> {
  const fields = await applyHook('auth:account-fields', [...DEFAULT_ACCOUNT_FIELDS], { user });
  const declared = queryMetadata('Users').fields;
  return fields.filter((name) => {
    const field = declared[name];
    return !isUndefined(field) && !isUndefined(field.fieldType) && field.writable !== false;
  });
}
