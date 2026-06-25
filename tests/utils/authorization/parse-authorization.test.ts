import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { parseAuthorization } from '../../../src/utils/index.ts';

describe('parseAuthorization', () => {
  it('splits scheme from token and lowercases the scheme', () => {
    deepStrictEqual(parseAuthorization('Bearer abc.def'), {
      scheme: 'bearer',
      token: 'abc.def',
    });
  });

  it('keeps the token verbatim across casing', () => {
    deepStrictEqual(parseAuthorization('Bearer AbC.dEf'), {
      scheme: 'bearer',
      token: 'AbC.dEf',
    });
  });

  it('decodes Basic credentials on the first colon', () => {
    deepStrictEqual(parseAuthorization('Basic dXNlcjpwYXNz'), {
      scheme: 'basic',
      token: 'dXNlcjpwYXNz',
      username: 'user',
      password: 'pass',
    });
  });

  it('keeps colons in a Basic password', () => {
    const token = btoa('user:pa:ss');
    deepStrictEqual(parseAuthorization(`Basic ${token}`), {
      scheme: 'basic',
      token,
      username: 'user',
      password: 'pa:ss',
    });
  });

  it('decodes a UTF-8 Basic password', () => {
    const token = btoa(String.fromCharCode(...new TextEncoder().encode('user:pässwörd')));
    deepStrictEqual(parseAuthorization(`Basic ${token}`), {
      scheme: 'basic',
      token,
      username: 'user',
      password: 'pässwörd',
    });
  });

  it('omits credentials for a Basic token with no colon', () => {
    const token = btoa('nocolon');
    deepStrictEqual(parseAuthorization(`Basic ${token}`), { scheme: 'basic', token });
  });

  it('omits credentials for an invalid base64 Basic token', () => {
    deepStrictEqual(parseAuthorization('Basic @@@'), { scheme: 'basic', token: '@@@' });
  });

  it('collapses extra whitespace between scheme and token', () => {
    deepStrictEqual(parseAuthorization('  Bearer   tok  '), {
      scheme: 'bearer',
      token: 'tok',
    });
  });

  it('returns null for a blank header', () => {
    strictEqual(parseAuthorization(''), null);
    strictEqual(parseAuthorization('   '), null);
  });

  it('returns null for a scheme with no credentials', () => {
    strictEqual(parseAuthorization('Bearer'), null);
  });
});
