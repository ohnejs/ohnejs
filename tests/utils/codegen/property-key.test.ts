import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { propertyKey } from '../../../src/utils/codegen/index.ts';

describe('propertyKey', () => {
  it('emits a valid identifier bare', () => {
    strictEqual(propertyKey('codegen'), 'codegen');
    strictEqual(propertyKey('_$x0'), '_$x0');
  });

  it('leaves reserved words bare, valid as property keys', () => {
    strictEqual(propertyKey('class'), 'class');
  });

  it('quotes a key with invalid characters', () => {
    strictEqual(propertyKey('a-b'), "'a-b'");
    strictEqual(propertyKey('user.profile'), "'user.profile'");
  });

  it('quotes a key with a leading digit', () => {
    strictEqual(propertyKey('2cool'), "'2cool'");
  });

  it('quotes an empty key', () => {
    strictEqual(propertyKey(''), "''");
  });
});
