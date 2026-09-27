import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { canonicalPath } from '../../../src/utils/index.ts';

describe('canonicalPath', () => {
  it('decodes escapes of unreserved characters', () => {
    strictEqual(canonicalPath('/%70ublic/x'), '/public/x');
    strictEqual(canonicalPath('/%41%7e%2D%5f'), '/A~-_');
    strictEqual(canonicalPath('/a%2eb'), '/a.b');
  });

  it('uppercases the hex of every other escape', () => {
    strictEqual(canonicalPath('/caf%c3%a9'), '/caf%C3%A9');
    strictEqual(canonicalPath('/a%20b'), '/a%20b');
  });

  it('refuses an encoded slash in either case', () => {
    strictEqual(canonicalPath('/a%2Fb'), null);
    strictEqual(canonicalPath('/a%2fb'), null);
  });

  it('decodes in a single pass', () => {
    strictEqual(canonicalPath('/%2570'), '/%2570');
    strictEqual(canonicalPath('/%252F'), '/%252F');
  });

  it('keeps a malformed or trailing percent as it is', () => {
    strictEqual(canonicalPath('/%zz/%70'), '/%zz/p');
    strictEqual(canonicalPath('/a%'), '/a%');
  });

  it('returns a path without escapes unchanged', () => {
    strictEqual(canonicalPath('/public/x/'), '/public/x/');
  });
});
