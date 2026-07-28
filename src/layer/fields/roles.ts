import { defineField, type Message, useRoles } from 'ohne';
import { isArray, isString, isUndefined, uniqueArray } from 'ohne/utils';

/**
 * The `roles` field type: a list of role names, stored as a JSON list.
 *
 * Each entry must name a registered role; an unknown name rejects with `auth.unknownRole`.
 * Duplicate entries collapse on write, keeping the first occurrence.
 * The generated value type is `RoleName[]`, so an assignment autocompletes and typechecks.
 * The `includes` operators probe the list, so a query can filter users by role.
 */
export default defineField({
  columnType: 'json',
  jsonList: true,
  defaultValue: () => [],
  emitType: (ctx) => `${ctx.importType('ohne', 'RoleName')}[]`,
  sanitizers: [(value) => (isArray<string[]>(value) ? uniqueArray(value) : value)],
  validators: [
    (value) => {
      if (!isArray(value) || !value.every(isString)) return 'auth.invalidRoles';
      const roles = useRoles();
      const unknown = value.find((name) => isUndefined(roles.get(name)));
      return isUndefined(unknown) ? undefined : unknownRoleMessage(unknown);
    },
  ],
});

/**
 * The `unknownRole` failure as its `[key, params]` message tuple.
 * The key lives in the layer's own catalog, resolved at the boundary, never in `KnownMessages`.
 * Its tuple is therefore not a `Message` member here; the cast bridges it.
 */
function unknownRoleMessage(role: string): Message {
  return ['auth.unknownRole', { role }] as unknown as Message;
}
