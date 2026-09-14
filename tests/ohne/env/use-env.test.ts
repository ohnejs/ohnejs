import { deepStrictEqual, strictEqual, throws } from 'node:assert';
import { afterEach, describe, it } from 'node:test';
import { boolEnv, useEnv } from 'ohnejs';
import { effect } from 'ohnejs/utils';

const KEYS = [
  'SILENT',
  'DEBUG',
  'NO_COLOR',
  'FORCE_COLOR',
  'SKIP_CODEGEN',
  'DASHBOARD_RELOAD',
] as const;

describe('useEnv', () => {
  afterEach(() => {
    for (const k of [...KEYS, 'PORT', 'HOST'] as const) {
      useEnv().unset(k);
      delete process.env[k];
    }
  });

  it('returns the same registry instance across calls', () => {
    strictEqual(useEnv(), useEnv());
  });

  describe('built-in defaults', () => {
    it('SILENT defaults to `false`', () => {
      strictEqual(useEnv().get('SILENT'), false);
    });

    it('DEBUG defaults to `false`', () => {
      strictEqual(useEnv().get('DEBUG'), false);
    });

    it('NO_COLOR defaults to `false`', () => {
      strictEqual(useEnv().get('NO_COLOR'), false);
    });

    it('FORCE_COLOR defaults to `undefined`', () => {
      strictEqual(useEnv().get('FORCE_COLOR'), undefined);
    });

    it('SKIP_CODEGEN defaults to `false`', () => {
      strictEqual(useEnv().get('SKIP_CODEGEN'), false);
    });

    it('DASHBOARD_RELOAD defaults to `false`', () => {
      strictEqual(useEnv().get('DASHBOARD_RELOAD'), false);
    });
  });

  describe('built-in parsers', () => {
    it('SILENT parses `1`/`0`/`true`/`false` (case-insensitive)', () => {
      process.env['SILENT'] = '1';
      strictEqual(useEnv().get('SILENT'), true);

      process.env['SILENT'] = 'TRUE';
      strictEqual(useEnv().get('SILENT'), true);

      process.env['SILENT'] = '0';
      strictEqual(useEnv().get('SILENT'), false);

      process.env['SILENT'] = 'false';
      strictEqual(useEnv().get('SILENT'), false);
    });

    it('SILENT throws on unrecognized strings, naming the var and the value', () => {
      process.env['SILENT'] = 'random';
      throws(() => useEnv().get('SILENT'), /`SILENT` must be .* got `random`/);
    });

    it('DEBUG resolves through `isDebugEnabled` against the `ohne` namespace', () => {
      process.env['DEBUG'] = 'ohne';
      strictEqual(useEnv().get('DEBUG'), true);

      process.env['DEBUG'] = 'ohne:*';
      strictEqual(useEnv().get('DEBUG'), true);

      process.env['DEBUG'] = '*';
      strictEqual(useEnv().get('DEBUG'), true);

      process.env['DEBUG'] = 'express:*';
      strictEqual(useEnv().get('DEBUG'), false);
    });

    it('NO_COLOR is true for any non-empty value (no-color.org standard)', () => {
      process.env['NO_COLOR'] = '1';
      strictEqual(useEnv().get('NO_COLOR'), true);

      process.env['NO_COLOR'] = 'false';
      strictEqual(useEnv().get('NO_COLOR'), true);
    });

    it('NO_COLOR is false when set to the empty string (no-color.org standard)', () => {
      process.env['NO_COLOR'] = '';
      strictEqual(useEnv().get('NO_COLOR'), false);
    });

    it('FORCE_COLOR is `false` only for `0`/`false`, `true` otherwise', () => {
      process.env['FORCE_COLOR'] = '1';
      strictEqual(useEnv().get('FORCE_COLOR'), true);

      process.env['FORCE_COLOR'] = '0';
      strictEqual(useEnv().get('FORCE_COLOR'), false);

      process.env['FORCE_COLOR'] = 'random';
      strictEqual(useEnv().get('FORCE_COLOR'), true);
    });

    it('SKIP_CODEGEN parses `1`/`0`/`true`/`false` (case-insensitive)', () => {
      process.env['SKIP_CODEGEN'] = '1';
      strictEqual(useEnv().get('SKIP_CODEGEN'), true);

      process.env['SKIP_CODEGEN'] = 'TRUE';
      strictEqual(useEnv().get('SKIP_CODEGEN'), true);

      process.env['SKIP_CODEGEN'] = '0';
      strictEqual(useEnv().get('SKIP_CODEGEN'), false);
    });

    it('DASHBOARD_RELOAD parses `1`/`0`/`true`/`false` (case-insensitive)', () => {
      process.env['DASHBOARD_RELOAD'] = '1';
      strictEqual(useEnv().get('DASHBOARD_RELOAD'), true);

      process.env['DASHBOARD_RELOAD'] = 'TRUE';
      strictEqual(useEnv().get('DASHBOARD_RELOAD'), true);

      process.env['DASHBOARD_RELOAD'] = '0';
      strictEqual(useEnv().get('DASHBOARD_RELOAD'), false);
    });

    it('PORT parses an integer string, `0` included; throws on invalid', () => {
      process.env['PORT'] = '3000';
      strictEqual(useEnv().get('PORT'), 3000);

      process.env['PORT'] = '0';
      strictEqual(useEnv().get('PORT'), 0);

      process.env['PORT'] = 'abc';
      throws(() => useEnv().get('PORT'), /`PORT` must be an integer/);

      process.env['PORT'] = '99999';
      throws(() => useEnv().get('PORT'), /`PORT` must be an integer/);
    });
  });

  describe('overrides', () => {
    it('`set` wins over `process.env`', () => {
      process.env['SILENT'] = '1';
      useEnv().set('SILENT', false);
      strictEqual(useEnv().get('SILENT'), false);
    });

    it('`unset` falls back to env value', () => {
      process.env['SILENT'] = '1';
      useEnv().set('SILENT', false);
      useEnv().unset('SILENT');
      strictEqual(useEnv().get('SILENT'), true);
    });
  });

  describe('names', () => {
    it('reports the six built-ins', () => {
      const names = [...useEnv().names()];
      deepStrictEqual(
        names.filter((n) => (KEYS as readonly string[]).includes(n)).sort(),
        [...KEYS].sort(),
      );
    });
  });

  describe('reactivity', () => {
    it('`get` inside an effect re-runs on `set`', () => {
      let seen: boolean | undefined;
      effect(() => {
        seen = useEnv().get('SILENT');
      });
      strictEqual(seen, false);
      useEnv().set('SILENT', true);
      strictEqual(seen, true);
    });

    it('changing one key does not re-run an effect reading another', () => {
      let runs = 0;
      effect(() => {
        useEnv().get('SILENT');
        runs++;
      });
      const before = runs;
      useEnv().set('DEBUG', true);
      strictEqual(runs, before);
      useEnv().set('SILENT', true);
      strictEqual(runs, before + 1);
    });
  });

  describe('database env vars', () => {
    afterEach(() => {
      for (const k of ['DATABASE', 'DB', 'FORCE_SYNC'] as const) {
        useEnv().unset(k);
        delete process.env[k];
      }
    });

    it('DATABASE and DB pass through as strings, defaulting to undefined', () => {
      strictEqual(useEnv().get('DATABASE'), undefined);
      strictEqual(useEnv().get('DB'), undefined);
      process.env['DATABASE'] = '.data/app.db';
      strictEqual(useEnv().get('DATABASE'), '.data/app.db');
      process.env['DB'] = ':memory:';
      strictEqual(useEnv().get('DB'), ':memory:');
    });

    it('FORCE_SYNC parses booleans, defaulting to false', () => {
      strictEqual(useEnv().get('FORCE_SYNC'), false);
      process.env['FORCE_SYNC'] = '1';
      strictEqual(useEnv().get('FORCE_SYNC'), true);
      process.env['FORCE_SYNC'] = '0';
      strictEqual(useEnv().get('FORCE_SYNC'), false);
    });

    it('has() detects DATABASE and DB, for the both-set conflict check', () => {
      strictEqual(useEnv().has('DATABASE'), false);
      process.env['DATABASE'] = ':memory:';
      process.env['DB'] = ':memory:';
      strictEqual(useEnv().has('DATABASE') && useEnv().has('DB'), true);
    });
  });
});

describe('boolEnv', () => {
  it('parses the accepted truthy and falsy forms', () => {
    strictEqual(boolEnv('1', 'MY_FLAG'), true);
    strictEqual(boolEnv('TRUE', 'MY_FLAG'), true);
    strictEqual(boolEnv('0', 'MY_FLAG'), false);
    strictEqual(boolEnv('false', 'MY_FLAG'), false);
  });

  it('throws naming the var and the value on anything else', () => {
    throws(() => boolEnv('nope', 'MY_FLAG'), /`MY_FLAG` must be .* got `nope`/);
  });
});
