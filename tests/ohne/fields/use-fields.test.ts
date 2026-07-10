import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { useFields } from '../../../src/ohne/fields/use-fields.ts';

describe('useFields', () => {
  it('pre-registers the built-in field types', () => {
    deepStrictEqual(useFields().keys().sort(), [
      'boolean',
      'integer',
      'object',
      'record',
      'records',
      'repeater',
      'text',
    ]);
  });

  it('exposes each built-in column type', () => {
    strictEqual(useFields().get('text')?.fieldType.columnType, 'text');
    strictEqual(useFields().get('integer')?.fieldType.columnType, 'integer');
    strictEqual(useFields().get('boolean')?.fieldType.columnType, 'boolean');
    strictEqual(useFields().get('record')?.fieldType.columnType, 'text');
    strictEqual(useFields().get('records')?.fieldType.columnType, false);
    strictEqual(useFields().get('object')?.fieldType.columnType, false);
    strictEqual(useFields().get('repeater')?.fieldType.columnType, false);
  });
});
