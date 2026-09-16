import { deepStrictEqual, strictEqual, throws } from 'node:assert';
import { describe, it } from 'node:test';

import { defineRole } from '../../../src/ohne/index.ts';

describe('defineRole', () => {
  it('returns the definition unchanged', () => {
    const definition = { capabilities: ['collection.Posts.*', 'billing.export'] };
    strictEqual(defineRole(definition), definition);
    deepStrictEqual(definition.capabilities, ['collection.Posts.*', 'billing.export']);
  });

  it('accepts an empty capability list', () => {
    deepStrictEqual(defineRole({ capabilities: [] }).capabilities, []);
  });

  it('rejects a non-array capabilities value', () => {
    throws(() => defineRole({ capabilities: '*' as never }), /Invalid role definition/);
  });

  it('rejects an empty-string capability', () => {
    throws(
      () => defineRole({ capabilities: ['collection.Posts.read', ''] }),
      /Invalid role definition/,
    );
  });

  it('rejects a non-string capability', () => {
    throws(() => defineRole({ capabilities: [1 as never] }), /Invalid role definition/);
  });

  it('accepts a label and a description as a string or a `{ key, params }` object', () => {
    const definition = defineRole({
      label: 'Editor',
      description: { key: 'dashMenu.tools', params: { n: 2 } },
      capabilities: [],
    });
    strictEqual(definition.label, 'Editor');
    deepStrictEqual(definition.description, { key: 'dashMenu.tools', params: { n: 2 } });
  });

  it('rejects a label or description of another shape', () => {
    throws(() => defineRole({ label: 1 as never, capabilities: [] }), /Invalid role definition/);
    throws(
      () => defineRole({ description: { params: {} } as never, capabilities: [] }),
      /Invalid role definition/,
    );
  });
});
