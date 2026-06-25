import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { parseForwarded } from '../../../src/utils/index.ts';

describe('parseForwarded', () => {
  it('parses the parameters of a single element', () => {
    deepStrictEqual(parseForwarded('for=192.0.2.60;proto=http;by=203.0.113.43'), [
      { for: '192.0.2.60', proto: 'http', by: '203.0.113.43' },
    ]);
  });

  it('splits multiple elements, leftmost first', () => {
    deepStrictEqual(parseForwarded('for=192.0.2.43, for=198.51.100.17'), [
      { for: '192.0.2.43' },
      { for: '198.51.100.17' },
    ]);
  });

  it('lowercases parameter names but keeps values verbatim', () => {
    deepStrictEqual(parseForwarded('For=192.0.2.60;Proto=HTTPS'), [
      { for: '192.0.2.60', proto: 'HTTPS' },
    ]);
  });

  it('unwraps a quoted value and keeps a comma inside it', () => {
    deepStrictEqual(parseForwarded('for="[2001:db8::17]:4711"'), [{ for: '[2001:db8::17]:4711' }]);
  });

  it('honors a backslash escape inside a quoted value', () => {
    deepStrictEqual(parseForwarded('host="a\\"b"'), [{ host: 'a"b' }]);
  });

  it('keeps the first value of a duplicate parameter per element', () => {
    deepStrictEqual(parseForwarded('for=a;for=b'), [{ for: 'a' }]);
  });

  it('ignores a parameter with no value', () => {
    deepStrictEqual(parseForwarded('for=192.0.2.60;bogus;proto=http'), [
      { for: '192.0.2.60', proto: 'http' },
    ]);
  });

  it('drops an empty element from a trailing comma', () => {
    deepStrictEqual(parseForwarded('for=a, ,for=b'), [{ for: 'a' }, { for: 'b' }]);
  });

  it('returns an empty array for a blank header', () => {
    deepStrictEqual(parseForwarded(''), []);
  });

  it('lands a __proto__ parameter as an own property without polluting', () => {
    const [element] = parseForwarded('__proto__=evil;for=a');
    strictEqual(element.__proto__, 'evil');
    strictEqual(Object.getPrototypeOf({}), Object.prototype);
  });
});
