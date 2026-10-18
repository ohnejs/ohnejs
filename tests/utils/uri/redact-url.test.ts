import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { redactURL } from '../../../src/utils/uri/redact-url.ts';

describe('redactURL', () => {
  it('removes a user and password', () => {
    strictEqual(redactURL('postgres://app:secret@db:5432/main'), 'postgres://db:5432/main');
  });

  it('removes a lone password parameter', () => {
    strictEqual(redactURL('postgres://db/main?password=secret'), 'postgres://db/main');
  });

  it('removes a password parameter among others, keeping the rest', () => {
    strictEqual(redactURL('postgres://db/main?password=s&ssl=1'), 'postgres://db/main?ssl=1');
    strictEqual(redactURL('postgres://db/main?ssl=1&password=s'), 'postgres://db/main?ssl=1');
    strictEqual(
      redactURL('postgres://db/main?ssl=1&password=s&max=4'),
      'postgres://db/main?ssl=1&max=4',
    );
  });

  it('removes every password parameter and the userinfo together', () => {
    strictEqual(redactURL('postgres://u:secret@x/db?password=p&password=q'), 'postgres://x/db');
  });

  it('removes a password parameter whose name is percent-encoded', () => {
    strictEqual(redactURL('postgres://db/main?pass%77ord=x'), 'postgres://db/main');
    strictEqual(redactURL('postgres://db/main?ssl=1&%70assword=x'), 'postgres://db/main?ssl=1');
  });

  it('removes a password value holding a raw `#`, fragment and all', () => {
    strictEqual(redactURL('postgres://db/main?password=se#cret'), 'postgres://db/main');
    strictEqual(redactURL('postgres://db/main?password=se#cret&ssl=1'), 'postgres://db/main?ssl=1');
  });

  it('keeps the fragment after a parameter that holds no secret', () => {
    strictEqual(redactURL('postgres://db/main?ssl=1#frag'), 'postgres://db/main?ssl=1#frag');
  });

  it('keeps a parameter whose name does not decode', () => {
    strictEqual(redactURL('postgres://db/main?pass%zzword=x'), 'postgres://db/main?pass%zzword=x');
  });

  it('keeps a parameter that only ends in `password`', () => {
    strictEqual(redactURL('postgres://db/main?oldpassword=x'), 'postgres://db/main?oldpassword=x');
  });

  it('removes a password parameter holding an `@`, keeping the host', () => {
    strictEqual(redactURL('postgres://localhost/db?password=p@ss'), 'postgres://localhost/db');
    strictEqual(
      redactURL('postgres://app:secret@localhost/db?user=app&password=abc@def&ssl=1'),
      'postgres://localhost/db?user=app&ssl=1',
    );
  });

  it('removes a password parameter after a userinfo holding a raw `?`', () => {
    strictEqual(redactURL('postgres://app:se?cret@host/db?password=x@y'), 'postgres://host/db');
  });

  it('leaves a value without secrets alone', () => {
    strictEqual(redactURL('.data/app.db'), '.data/app.db');
    strictEqual(redactURL(':memory:'), ':memory:');
    strictEqual(redactURL('postgres://db/main?ssl=1'), 'postgres://db/main?ssl=1');
  });
});
