import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';
import { domainToASCII, domainToUnicode } from 'node:url';

import { isDomainName, lowercase } from '../../../src/utils/index.ts';

describe('isDomainName', () => {
  it('returns true for ASCII, unicode and punycode names', () => {
    strictEqual(isDomainName('dalaran.example'), true);
    strictEqual(isDomainName('a-b.c-d.example'), true);
    strictEqual(isDomainName('münchen.de'), true);
    strictEqual(isDomainName('xn--mnchen-3ya.de'), true);
    strictEqual(isDomainName('café.example'), true);
  });

  it('returns false for a single label', () => {
    strictEqual(isDomainName('localhost'), false);
  });

  it('returns false for a last label that reads as a number', () => {
    strictEqual(isDomainName('1.2'), false);
    strictEqual(isDomainName('127.0.0.1'), false);
    strictEqual(isDomainName('0x7f.0x1'), false);
    strictEqual(isDomainName('a.0x'), false);
  });

  it('returns false for compatibility characters a browser would fold', () => {
    strictEqual(isDomainName('ｅｘａｍｐｌｅ.com'), false);
    strictEqual(isDomainName('ﬁle.com'), false);
    strictEqual(isDomainName('ℌ.com'), false);
  });

  it('returns false for invisible code points a browser drops', () => {
    for (const mark of ['\u034f', '\ufe0f', '\ufe00', '\u180b', '\u{e0100}', '\u115f', '\u1160']) {
      strictEqual(isDomainName(`orgr${mark}immar.example`), false, mark);
    }
  });

  it('returns false for letters IDNA folds past their lowercase, and keeps `ß` and `ς`', () => {
    strictEqual(isDomainName('x\uab70y.example'), false);
    strictEqual(isDomainName('x\u13a0y.example'), false);
    strictEqual(isDomainName('x\u1fb3y.example'), false);
    strictEqual(isDomainName('x\u1c80y.example'), false);
    strictEqual(isDomainName('straße.de'), true);
    strictEqual(isDomainName('οδος.gr'), true);
  });

  it('accepts only names whose `lowercase` is the name a browser resolves', () => {
    const blocks = [
      [0x00c0, 0x024f],
      [0x0370, 0x03ff],
      [0x0400, 0x04ff],
      [0x13a0, 0x13ff],
      [0x1c80, 0x1c8f],
      [0x1e00, 0x1fff],
      [0xab70, 0xabbf],
    ];
    for (const [start, end] of blocks) {
      for (let point = start; point <= end; point++) {
        const char = String.fromCodePoint(point);
        for (const name of [`x${char}y.example`, `x${char.toUpperCase()}y.example`]) {
          const ascii = domainToASCII(name);
          if (!isDomainName(name) || ascii === '') continue;
          strictEqual(lowercase(name), domainToUnicode(ascii), name);
        }
      }
    }
  });

  it('returns false for characters outside a label', () => {
    strictEqual(isDomainName('x_y.example'), false);
    strictEqual(isDomainName('-x.example'), false);
    strictEqual(isDomainName('x-.example'), false);
    strictEqual(isDomainName('a​b.example'), false);
    strictEqual(isDomainName('a..example'), false);
  });

  it('caps a label at 63 characters and the name at 253', () => {
    strictEqual(isDomainName(`${'a'.repeat(63)}.example`), true);
    strictEqual(isDomainName(`${'a'.repeat(64)}.example`), false);
    const name = Array.from({ length: 4 }, () => 'a'.repeat(63)).join('.');
    strictEqual(isDomainName(name.slice(0, 253)), true);
    strictEqual(isDomainName(`${name.slice(0, 253)}a`), false);
  });

  it('returns false for non-strings', () => {
    strictEqual(isDomainName(undefined), false);
    strictEqual(isDomainName(42), false);
  });
});
