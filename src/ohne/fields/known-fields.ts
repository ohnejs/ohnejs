import type { blocks } from './builtin/blocks.ts';
import type { boolean } from './builtin/boolean.ts';
import type { dateTime } from './builtin/date-time.ts';
import type { date } from './builtin/date.ts';
import type { integer } from './builtin/integer.ts';
import type { multiSelect } from './builtin/multi-select.ts';
import type { number } from './builtin/number.ts';
import type { object } from './builtin/object.ts';
import type { record } from './builtin/record.ts';
import type { records } from './builtin/records.ts';
import type { repeater } from './builtin/repeater.ts';
import type { select } from './builtin/select.ts';
import type { text } from './builtin/text.ts';
import type { time } from './builtin/time.ts';

/**
 * The registered field types, each name mapped to its definition.
 * ohne's built-ins are always present; codegen augments this with each layer's own.
 * `field('<name>', ...)` reads the mapped definition to resolve that type's options.
 *
 * `type` aliases cannot be augmented, so the extra names live on this interface instead.
 *
 * @example
 * ```ts
 * declare module 'ohne' {
 *   interface KnownFields {
 *     slug: typeof import('./fields/slug.ts').default
 *   }
 * }
 * ```
 */
export interface KnownFields {
  /**
   * A text value.
   */
  text: typeof text;

  /**
   * A whole number, within JavaScript's safe integer range.
   */
  integer: typeof integer;

  /**
   * A finite floating-point number, the engine's own IEEE 754 double.
   */
  number: typeof number;

  /**
   * A true or false value.
   */
  boolean: typeof boolean;

  /**
   * One value out of a declared choice list.
   */
  select: typeof select;

  /**
   * An ordered list of distinct string values, optionally out of a declared choice list.
   */
  multiSelect: typeof multiSelect;

  /**
   * A calendar day, stored as `YYYY-MM-DD` text.
   */
  date: typeof date;

  /**
   * A time of day, stored as `HH:MM:SS` text.
   */
  time: typeof time;

  /**
   * An instant, stored as epoch milliseconds.
   */
  dateTime: typeof dateTime;

  /**
   * A reference to one row of another collection.
   */
  record: typeof record;

  /**
   * An ordered many-to-many relation to another collection.
   */
  records: typeof records;

  /**
   * A nested group of fields, stored at most once per parent row.
   */
  object: typeof object;

  /**
   * An ordered list of nested field groups.
   */
  repeater: typeof repeater;

  /**
   * An ordered list of block instances.
   */
  blocks: typeof blocks;
}

/**
 * The name of a registered field type, used as the string tag of `field(...)`.
 * Always includes the built-ins, plus any a layer adds through codegen.
 */
export type FieldTypeName = keyof KnownFields;
