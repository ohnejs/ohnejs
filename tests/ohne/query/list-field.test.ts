import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { FieldQueryMeta } from '../../../src/ohne/query/metadata.ts';

import { isListField } from '../../../src/ohne/query/list-field.ts';

const meta = (partial: Partial<FieldQueryMeta>) =>
  ({ nullable: false, ...partial }) as FieldQueryMeta;

describe('isListField', () => {
  it('holds for a relation list, a repeater, and a blocks field', () => {
    strictEqual(isListField(meta({ kind: 'records' })), true);
    strictEqual(isListField(meta({ kind: 'childMany' })), true);
    strictEqual(isListField(meta({ kind: 'blocks' })), true);
  });

  it('holds for a `jsonList` column', () => {
    strictEqual(isListField(meta({ kind: 'column', jsonList: true })), true);
  });

  it('fails for a scalar, a reference, and an object', () => {
    strictEqual(isListField(meta({ kind: 'column' })), false);
    strictEqual(isListField(meta({ kind: 'record' })), false);
    strictEqual(isListField(meta({ kind: 'childOne' })), false);
  });
});
