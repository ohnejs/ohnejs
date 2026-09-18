import {
  applyHook,
  type FieldLayout,
  type FieldLayoutNode,
  layoutFieldNames,
  queryMetadata,
} from 'ohnejs';
import { isUndefined, jsonClone } from 'ohnejs/utils';

import type { User } from './types.ts';

declare module 'ohnejs' {
  interface Hooks {
    /**
     * Filters the account page's layout: the `Users` fields a signed-in user edits, and their arrangement.
     * Fires per request, inside the request context, with the default cards in order.
     * Drop a setting the app does not offer, or place a field the app declared on `Users`.
     * A name that is not a writable declared field is dropped, with any row, card, or tab it leaves empty.
     * An empty layout hides the page.
     * The fields the layout names are also the ones `PATCH /auth/me` accepts.
     * Return a replacement `FieldLayout`, or mutate the array in place and return nothing.
     */
    'auth:account-layout': (
      layout: FieldLayoutNode[],
      context: { user: User },
    ) => void | FieldLayout | Promise<void | FieldLayout>;
  }
}

/**
 * The account page's layout when no hook changes it: name, languages, time, clipboard, and password cards.
 * `email` and `roles` are never placed: an administrator changes those through the `Users` collection.
 */
export const DEFAULT_ACCOUNT_LAYOUT: FieldLayout = [
  { card: [{ row: ['firstName', 'lastName'] }] },
  { card: [{ row: ['contentLanguage', 'dashboardLanguage'] }] },
  { card: ['timezone', { row: ['dateFormat', 'timeFormat'] }] },
  { card: ['smartClipboard'] },
  { card: ['password'] },
];

/**
 * Resolves the account page layout for `user`: the `auth:account-layout` hook over a copy of the default.
 * The result is as the hook left it; `accountFields` reads the editable names out of it.
 *
 * @example
 * ```ts
 * await accountLayout(user)
 * // -> [{ card: [{ row: ['firstName', 'lastName'] }] }, ...]
 * ```
 */
export async function accountLayout(user: User): Promise<FieldLayout> {
  return applyHook('auth:account-layout', jsonClone([...DEFAULT_ACCOUNT_LAYOUT]), { user });
}

/**
 * The `Users` fields an account layout lets the user edit, in layout order.
 * A name that is not a writable declared field is left out.
 * `PATCH /auth/me` and `GET /dashboard` both read it, so the allowlist and the form cannot drift.
 *
 * @example
 * ```ts
 * accountFields(await accountLayout(user))
 * // -> ['firstName', 'lastName', 'contentLanguage', ...]
 * ```
 */
export function accountFields(layout: FieldLayout): string[] {
  const declared = queryMetadata('Users').fields;
  return layoutFieldNames(layout).filter((name) => {
    const field = declared[name];
    return !isUndefined(field) && !isUndefined(field.fieldType) && field.writable !== false;
  });
}
