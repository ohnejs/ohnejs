import { defineField, type UncheckedMessage, useRoles } from 'ohnejs';
import { foldCase, isArray, isString, isUndefined, uniqueArray } from 'ohnejs/utils';
import { literalUnion } from 'ohnejs/utils/codegen';

/**
 * The `roles` field type: a list of role names, stored as a JSON list.
 *
 * Each entry must name a registered role; an unknown name rejects with `auth.unknownRole`.
 * Duplicate entries collapse on write, keeping the first occurrence.
 * The generated value type is `GeneratedRoleName[]`, so an assignment autocompletes and typechecks.
 * A website reads the registered role names inline, or `string[]` when none is registered.
 * The `includes` operators probe the list, so a query can filter users by role.
 * Search is off until a field sets `search: true`; then a role name, in any case, finds its holders.
 */
export default defineField({
  columnType: 'json',
  jsonList: true,
  defaultValue: () => [],
  emitType: (ctx) => `${ctx.importGenerated('roles.ts', 'GeneratedRoleName')}[]`,
  emitJSONType: () => {
    const names = useRoles().keys().sort();
    return names.length === 0 ? 'string[]' : `(${literalUnion(names)})[]`;
  },
  sanitizers: [(value) => (isArray<string[]>(value) ? uniqueArray(value) : value)],
  validators: [
    (value) => {
      if (!isArray(value) || !value.every(isString)) return 'auth.invalidRoles';
      const roles = useRoles();
      const unknown = value.find((name) => isUndefined(roles.get(name)));
      return isUndefined(unknown) ? undefined : unknownRoleMessage(unknown);
    },
  ],
  search: {
    default: false,
    match: ({ token }) => {
      const role = useRoles()
        .keys()
        .find((name) => foldCase(name) === foldCase(token));
      return isUndefined(role) ? null : { includes: role };
    },
  },
});

/**
 * The `unknownRole` failure as its `{ key, params }` message object.
 * An app can drop the catalog that defines the key, so the cast brands it unchecked.
 */
function unknownRoleMessage(role: string): UncheckedMessage {
  return { key: 'auth.unknownRole', params: { role } } as unknown as UncheckedMessage;
}
