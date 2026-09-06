import { defineField, type Message } from 'ohne';
import { isTimezone } from 'ohne/utils';

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
 * The key lives in the layer's own catalog, resolved at the boundary, never in `KnownMessages`.
 * Its object is therefore not a `Message` member here; the cast bridges it.
 */
function invalidTimezoneMessage(timezone: string): Message {
  return { key: 'auth.invalidTimezone', params: { timezone } } as unknown as Message;
}
