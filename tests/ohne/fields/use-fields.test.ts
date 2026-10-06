import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { useFields } from '../../../src/ohne/fields/use-fields.ts';

describe('useFields', () => {
  it('pre-registers the built-in field types', () => {
    deepStrictEqual(useFields().keys().sort(), [
      'blocks',
      'boolean',
      'date',
      'dateTime',
      'integer',
      'link',
      'multiSelect',
      'number',
      'object',
      'record',
      'records',
      'repeater',
      'richText',
      'select',
      'text',
      'time',
    ]);
  });

  it('exposes each built-in column type', () => {
    strictEqual(useFields().get('text')?.fieldType.columnType, 'text');
    strictEqual(useFields().get('richText')?.fieldType.columnType, 'json');
    strictEqual(useFields().get('link')?.fieldType.columnType, 'json');
    strictEqual(useFields().get('integer')?.fieldType.columnType, 'integer');
    strictEqual(useFields().get('number')?.fieldType.columnType, 'real');
    strictEqual(useFields().get('boolean')?.fieldType.columnType, 'boolean');
    strictEqual(useFields().get('record')?.fieldType.columnType, 'text');
    strictEqual(useFields().get('records')?.fieldType.columnType, false);
    strictEqual(useFields().get('object')?.fieldType.columnType, false);
    strictEqual(useFields().get('repeater')?.fieldType.columnType, false);
  });
});
