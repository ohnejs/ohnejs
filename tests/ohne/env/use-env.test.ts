import { deepStrictEqual, strictEqual, throws } from 'node:assert';
import { afterEach, describe, it } from 'node:test';
import { useEnv } from 'ohne';
import { effect } from 'ohne/utils';

const KEYS = ['SILENT', 'DEBUG', 'NO_COLOR', 'FORCE_COLOR', 'SKIP_CODEGEN'] as const;

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

    it('SILENT throws on unrecognized strings', () => {
      process.env['SILENT'] = 'random';
      throws(() => useEnv().get('SILENT'), /Expected boolean/);
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
    it('reports the five built-ins', () => {
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
});
