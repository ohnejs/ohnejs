import { describe, it } from 'node:test';

import type {
  CommonFieldOptions,
  KnownFieldTypes,
} from '../../../src/dashboard/fields/known-field-types.ts';
import type { Text } from '../../../src/dashboard/runtime/text-type.ts';
import type { FieldInstance } from '../../../src/ohne/fields/field.ts';
import type { Message } from '../../../src/ohne/messages/known-messages.ts';

/**
 * The browser options as the wire carries them: every `Text` becomes the server's `Message`.
 * An options type of `{}` stays itself, since a `Text` is assignable to it.
 */
// oxlint-disable-next-line typescript/no-empty-object-type
type Wire<T> = [T, {}, keyof T] extends [{}, T, never]
  ? T
  : [Text] extends [T]
    ? Message
    : T extends readonly (infer E)[]
      ? readonly Wire<E>[]
      : T extends object
        ? { [K in keyof T]: Wire<T[K]> }
        : T;

/**
 * The browser options of `K` the server types alike.
 * A composite's `fields` are browser specs here and server instances there, so they stay out on both sides.
 */
type BrowserOptions<K extends keyof KnownFieldTypes> = Wire<
  Omit<KnownFieldTypes[K]['options'], 'fields'>
> &
  Wire<Omit<CommonFieldOptions, 'default' | 'when'>>;

type ServerOptions<K extends keyof KnownFieldTypes> = Omit<FieldInstance<K>['options'], 'fields'>;

/**
 * Compiles only when the browser options of `K` are assignable to the server's.
 */
function assertDrift<K extends keyof KnownFieldTypes>(
  _proof: [BrowserOptions<K>] extends [ServerOptions<K>] ? true : false,
): void {}

describe('browser field options', () => {
  it('stay assignable to the server options of every builtin type', () => {
    assertDrift<'text'>(true);
    assertDrift<'richText'>(true);
    assertDrift<'integer'>(true);
    assertDrift<'number'>(true);
    assertDrift<'boolean'>(true);
    assertDrift<'select'>(true);
    assertDrift<'multiSelect'>(true);
    assertDrift<'date'>(true);
    assertDrift<'time'>(true);
    assertDrift<'color'>(true);
    assertDrift<'code'>(true);
    assertDrift<'email'>(true);
    assertDrift<'url'>(true);
    assertDrift<'dateTime'>(true);
    assertDrift<'link'>(true);
    assertDrift<'record'>(true);
    assertDrift<'records'>(true);
    assertDrift<'object'>(true);
    assertDrift<'repeater'>(true);
  });
});
