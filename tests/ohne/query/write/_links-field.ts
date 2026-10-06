import type { FieldInstance } from '../../../../src/ohne/fields/field.ts';
import type { FieldTypeName } from '../../../../src/ohne/fields/known-fields.ts';

import { defineField } from '../../../../src/ohne/fields/define-field.ts';
import { useFields } from '../../../../src/ohne/fields/use-fields.ts';
import { isArray, isRecordLink } from '../../../../src/utils/index.ts';

useFields().register('testLinks', {
  name: 'testLinks' as FieldTypeName,
  fieldType: defineField({
    columnType: 'json',
    links: (value) =>
      isArray(value)
        ? value.flatMap((link, index) => (isRecordLink(link) ? [{ path: `[${index}]`, link }] : []))
        : [],
  }),
});

/**
 * A nullable field of the test-only `testLinks` type: a list of links, each listed at `[i]`.
 */
export function linksField(): FieldInstance {
  return { type: 'testLinks', options: { nullable: true } } as unknown as FieldInstance;
}
