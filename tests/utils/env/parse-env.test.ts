import { deepStrictEqual, throws } from 'node:assert';
import { describe, it } from 'node:test';

import { parseEnv } from '../../../src/utils/env/index.ts';

describe('parseEnv', () => {
  describe('basic assignment', () => {
    it('parses a single pair', () => {
      deepStrictEqual(parseEnv('FOO=bar'), { FOO: 'bar' });
    });

    it('parses multiple pairs', () => {
      deepStrictEqual(parseEnv('FOO=bar\nBAZ=qux'), { FOO: 'bar', BAZ: 'qux' });
    });

    it('parses an empty value', () => {
      deepStrictEqual(parseEnv('FOO='), { FOO: '' });
    });

    it('tolerates a missing trailing newline', () => {
      deepStrictEqual(parseEnv('A=1\nB=2'), { A: '1', B: '2' });
    });

    it('handles CRLF line endings', () => {
      deepStrictEqual(parseEnv('A=1\r\nB=2\r\n'), { A: '1', B: '2' });
    });

    it('returns an empty object for empty input', () => {
      deepStrictEqual(parseEnv(''), {});
    });

    it('returns an empty object for whitespace-only input', () => {
      deepStrictEqual(parseEnv('   \n\t\n'), {});
    });
  });

  describe('whitespace', () => {
    it('allows whitespace around `=`', () => {
      deepStrictEqual(parseEnv('FOO =bar'), { FOO: 'bar' });
      deepStrictEqual(parseEnv('FOO= bar'), { FOO: 'bar' });
      deepStrictEqual(parseEnv('FOO  =  bar'), { FOO: 'bar' });
    });

    it('trims leading whitespace before the key', () => {
      deepStrictEqual(parseEnv('  FOO=bar'), { FOO: 'bar' });
    });

    it('trims trailing whitespace from bare values', () => {
      deepStrictEqual(parseEnv('FOO=hello world  '), { FOO: 'hello world' });
    });

    it('preserves internal whitespace in bare values', () => {
      deepStrictEqual(parseEnv('FOO=hello   world'), { FOO: 'hello   world' });
    });
  });

  describe('comments', () => {
    it('skips full-line comments', () => {
      deepStrictEqual(parseEnv('# top\nFOO=bar\n  # indented\nBAZ=qux'), {
        FOO: 'bar',
        BAZ: 'qux',
      });
    });

    it('strips inline comments after bare values', () => {
      deepStrictEqual(parseEnv('FOO=bar # tail'), { FOO: 'bar' });
    });

    it('requires whitespace before `#` to start an inline comment', () => {
      deepStrictEqual(parseEnv('COLOR=#fff'), { COLOR: '#fff' });
      deepStrictEqual(parseEnv('FOO=bar#tag'), { FOO: 'bar#tag' });
    });

    it('treats `#` at value start as a comment', () => {
      deepStrictEqual(parseEnv('FOO= # nothing'), { FOO: '' });
    });

    it('keeps `#` literal inside double quotes', () => {
      deepStrictEqual(parseEnv('FOO="a # b"'), { FOO: 'a # b' });
    });

    it('keeps `#` literal inside single quotes', () => {
      deepStrictEqual(parseEnv("FOO='a # b'"), { FOO: 'a # b' });
    });

    it('allows a comment after a closing double quote', () => {
      deepStrictEqual(parseEnv('FOO="bar" # tail'), { FOO: 'bar' });
    });
  });

  describe('double-quoted values', () => {
    it('preserves surrounding whitespace inside quotes', () => {
      deepStrictEqual(parseEnv('FOO="  hello  "'), { FOO: '  hello  ' });
    });

    it('interprets standard escapes', () => {
      deepStrictEqual(parseEnv('FOO="a\\nb\\tc\\r\\\\\\""'), { FOO: 'a\nb\tc\r\\"' });
    });

    it('drops the backslash for unknown escapes', () => {
      deepStrictEqual(parseEnv('FOO="\\x"'), { FOO: 'x' });
    });

    it('spans multiple physical lines', () => {
      deepStrictEqual(parseEnv('FOO="line1\nline2"'), { FOO: 'line1\nline2' });
    });

    it('throws on an unterminated quote', () => {
      throws(() => parseEnv('FOO="bar'), /unterminated double-quoted/);
    });
  });

  describe('single-quoted values', () => {
    it('treats the body literally', () => {
      deepStrictEqual(parseEnv("FOO='a\\nb'"), { FOO: 'a\\nb' });
    });

    it('spans multiple physical lines', () => {
      deepStrictEqual(parseEnv("FOO='line1\nline2'"), { FOO: 'line1\nline2' });
    });

    it('throws on an unterminated quote', () => {
      throws(() => parseEnv("FOO='bar"), /unterminated single-quoted/);
    });
  });

  describe('errors', () => {
    it('throws on a missing `=`', () => {
      throws(() => parseEnv('FOO bar'), /expected "="/);
    });

    it('throws on an invalid leading character', () => {
      throws(() => parseEnv('1FOO=bar'), /unexpected character/);
    });

    it('throws on non-whitespace after a closing quote', () => {
      throws(() => parseEnv('FOO="bar"baz'), /after closing quote/);
    });

    it('rejects the `export` prefix form', () => {
      throws(() => parseEnv('export FOO=bar'), /expected "="/);
    });
  });

  it('last assignment wins for duplicate keys', () => {
    deepStrictEqual(parseEnv('FOO=a\nFOO=b'), { FOO: 'b' });
  });

  it('parses a realistic mixed file', () => {
    const text = [
      '# database',
      'DB_URL="postgres://user:pass@host/db"',
      'DB_POOL = 8   # max connections',
      '',
      "RAW='no \\n escape here'",
      'EMPTY=',
      'COLOR=#abcdef',
      'GREETING="hello\\nworld"',
    ].join('\n');

    deepStrictEqual(parseEnv(text), {
      DB_URL: 'postgres://user:pass@host/db',
      DB_POOL: '8',
      RAW: 'no \\n escape here',
      EMPTY: '',
      COLOR: '#abcdef',
      GREETING: 'hello\nworld',
    });
  });
});
