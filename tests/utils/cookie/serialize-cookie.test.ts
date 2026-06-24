import { strictEqual, throws } from 'node:assert';
import { describe, it } from 'node:test';

import { serializeCookie } from '../../../src/utils/index.ts';

describe('serializeCookie', () => {
  it('serializes a bare name=value pair', () => {
    strictEqual(serializeCookie('id', '42'), 'id=42');
  });

  it('encodes the value', () => {
    strictEqual(serializeCookie('q', 'a b;c'), 'q=a%20b%3Bc');
  });

  it('appends attributes in a stable order', () => {
    const header = serializeCookie('sid', 'abc', {
      maxAge: 3600,
      path: '/',
      domain: 'example.com',
      secure: true,
      httpOnly: true,
      sameSite: 'lax',
    });
    strictEqual(
      header,
      'sid=abc; Max-Age=3600; Domain=example.com; Path=/; Secure; HttpOnly; SameSite=Lax',
    );
  });

  it('formats expires as a UTC string', () => {
    const header = serializeCookie('a', '1', { expires: new Date('2030-01-01T00:00:00Z') });
    strictEqual(header, 'a=1; Expires=Tue, 01 Jan 2030 00:00:00 GMT');
  });

  it('capitalizes sameSite and priority values', () => {
    strictEqual(serializeCookie('a', '1', { sameSite: 'none' }), 'a=1; SameSite=None');
    strictEqual(serializeCookie('a', '1', { priority: 'high' }), 'a=1; Priority=High');
  });

  it('emits Partitioned when set', () => {
    strictEqual(serializeCookie('a', '1', { partitioned: true }), 'a=1; Partitioned');
  });

  it('floors a fractional max-age', () => {
    strictEqual(serializeCookie('a', '1', { maxAge: 60.9 }), 'a=1; Max-Age=60');
  });

  it('throws on an invalid cookie name', () => {
    throws(() => serializeCookie('a b', '1'));
    throws(() => serializeCookie('a;b', '1'));
  });

  it('throws on a domain or path carrying an injection character', () => {
    throws(() => serializeCookie('a', '1', { path: '/x;Secure' }));
    throws(() => serializeCookie('a', '1', { domain: 'e\r\nx' }));
  });
});
