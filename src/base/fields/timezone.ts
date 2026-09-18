import { defineField, type Message } from 'ohnejs';
import { isTimezone } from 'ohnejs/utils';

/**
 * The `timezone` field type: an IANA time zone name, like `Europe/Berlin`.
 *
 * Every name `Intl.DateTimeFormat` resolves passes, aliases like `US/Pacific` and `UTC` included.
 * Any other value rejects with `auth.invalidTimezone`, naming the submitted value.
 */
export default defineField({
  columnType: 'text',
  validators: [(value) => (isTimezone(value) ? undefined : invalidTimezoneMessage(value))],
});

/**
 * The `invalidTimezone` failure as its `{ key, params }` message object.
 * Once `KnownMessages` has keys, the object must name one of them.
 * In this repo's typecheck only test fixtures supply those keys, so the cast bridges it.
 */
function invalidTimezoneMessage(timezone: string): Message {
  return { key: 'auth.invalidTimezone', params: { timezone } } as unknown as Message;
}
