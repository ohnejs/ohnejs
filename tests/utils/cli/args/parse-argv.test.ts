import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { parseArgv } from '../../../../src/utils/cli/index.ts';

const flags = <T extends object>(o: T): T => Object.assign(Object.create(null), o);

describe('parseArgv', () => {
  it('collects positionals in order', () => {
    deepStrictEqual(parseArgv(['build', 'src', 'dist']), {
      positionals: ['build', 'src', 'dist'],
      flags: flags({}),
    });
  });

  it('treats a bare long flag as true', () => {
    deepStrictEqual(parseArgv(['--prod']), { positionals: [], flags: flags({ prod: true }) });
  });

  it('consumes the next token as a long flag value', () => {
    deepStrictEqual(parseArgv(['--name', 'app']), {
      positionals: [],
      flags: flags({ name: 'app' }),
    });
  });

  it('parses --name=value', () => {
    deepStrictEqual(parseArgv(['--name=my app']), {
      positionals: [],
      flags: flags({ name: 'my app' }),
    });
  });

  it('keeps an empty value after =', () => {
    deepStrictEqual(parseArgv(['--name=']), { positionals: [], flags: flags({ name: '' }) });
  });

  it('parses --no-name as false', () => {
    deepStrictEqual(parseArgv(['--no-cache']), { positionals: [], flags: flags({ cache: false }) });
  });

  it('takes a --no- flag verbatim when its full name is a declared boolean', () => {
    deepStrictEqual(parseArgv(['--no-cache'], { booleans: ['no-cache'] }), {
      positionals: [],
      flags: flags({ 'no-cache': true }),
    });
  });

  it('does not consume the next token for a declared boolean', () => {
    deepStrictEqual(parseArgv(['--force', 'build'], { booleans: ['force'] }), {
      positionals: ['build'],
      flags: flags({ force: true }),
    });
  });

  it('does not consume a following flag', () => {
    deepStrictEqual(parseArgv(['--name', '--prod']), {
      positionals: [],
      flags: flags({ name: true, prod: true }),
    });
  });

  it('expands a short bundle into booleans', () => {
    deepStrictEqual(parseArgv(['-abc']), {
      positionals: [],
      flags: flags({ a: true, b: true, c: true }),
    });
  });

  it('lets the last short flag in a bundle take a value', () => {
    deepStrictEqual(parseArgv(['-ab', '5']), {
      positionals: [],
      flags: flags({ a: true, b: '5' }),
    });
  });

  it('parses an attached short value', () => {
    deepStrictEqual(parseArgv(['-p3000']), { positionals: [], flags: flags({ p: '3000' }) });
  });

  it('parses -p=3000', () => {
    deepStrictEqual(parseArgv(['-p=3000']), { positionals: [], flags: flags({ p: '3000' }) });
  });

  it('collects a repeated flag into an array', () => {
    deepStrictEqual(parseArgv(['--tag', 'a', '--tag', 'b']), {
      positionals: [],
      flags: flags({ tag: ['a', 'b'] }),
    });
  });

  it('passes everything after -- through as positionals', () => {
    deepStrictEqual(parseArgv(['run', '--', '--raw', '-x']), {
      positionals: ['run', '--raw', '-x'],
      flags: flags({}),
    });
  });

  it('keeps a lone dash positional', () => {
    deepStrictEqual(parseArgv(['cat', '-']), { positionals: ['cat', '-'], flags: flags({}) });
  });

  it('keeps a negative number positional', () => {
    deepStrictEqual(parseArgv(['-5', '-1.5']), {
      positionals: ['-5', '-1.5'],
      flags: flags({}),
    });
  });

  it('consumes a negative number as a flag value', () => {
    deepStrictEqual(parseArgv(['--offset', '-5']), {
      positionals: [],
      flags: flags({ offset: '-5' }),
    });
  });

  it('stores a __proto__ flag safely', () => {
    const result = parseArgv(['--__proto__', 'x']);
    strictEqual(result.flags['__proto__'], 'x');
    strictEqual(Object.getPrototypeOf(result.flags), null);
  });

  it('returns a null-prototype flags object', () => {
    strictEqual(Object.getPrototypeOf(parseArgv([]).flags), null);
  });
});
