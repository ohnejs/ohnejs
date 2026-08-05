import { deepStrictEqual, strictEqual, throws } from 'node:assert';
import { afterEach, describe, it } from 'node:test';

import { applyEnvFlags, envGlobals } from '../../../src/ohne/env/env-flags.ts';
import { useEnv } from '../../../src/ohne/env/use-env.ts';

const KEYS = ['HOST', 'PORT', 'NO_COLOR', 'FORCE_SYNC', 'DATABASE', 'DB'] as const;

describe('env flags', () => {
  afterEach(() => {
    for (const k of KEYS) {
      useEnv().unset(k);
      delete process.env[k];
    }
  });

  describe('applyEnvFlags', () => {
    it('applies a value flag through the env parser', () => {
      applyEnvFlags(['serve', 'api', '--host', '0.0.0.0']);
      strictEqual(useEnv().get('HOST'), '0.0.0.0');
    });

    it('applies a boolean switch, on and off', () => {
      applyEnvFlags(['sync', '--force-sync']);
      strictEqual(useEnv().get('FORCE_SYNC'), true);
      useEnv().unset('FORCE_SYNC');
      applyEnvFlags(['sync', '--no-force-sync']);
      strictEqual(useEnv().get('FORCE_SYNC'), false);
    });

    it('applies a flag typed in a non-kebab spelling', () => {
      applyEnvFlags(['sync', '--forceSync', 'build']);
      strictEqual(useEnv().get('FORCE_SYNC'), true);
      useEnv().unset('FORCE_SYNC');
      applyEnvFlags(['serve', 'api', '--Host', '0.0.0.0']);
      strictEqual(useEnv().get('HOST'), '0.0.0.0');
    });

    it('leaves a var untouched when its flag is absent', () => {
      applyEnvFlags(['sync']);
      strictEqual(useEnv().has('FORCE_SYNC'), false);
    });

    it('takes `--no-color` verbatim, not as a negation', () => {
      applyEnvFlags(['dev', '--no-color']);
      strictEqual(useEnv().get('NO_COLOR'), true);
    });

    it('routes a value flag through the env validation', () => {
      throws(() => applyEnvFlags(['dev', '--port', '99999']), /`PORT` must be an integer/);
    });

    it('throws when a value flag is given without a value', () => {
      throws(() => applyEnvFlags(['dev', '--host']), /`--host` needs a value/);
    });

    it('throws when a boolean flag is given a non-booleanish value', () => {
      throws(() => applyEnvFlags(['sync', '--force-sync=maybe']), /must be `true` or `false`/);
    });

    it('sets both `DATABASE` and `DB`, so the both-set conflict stays detectable', () => {
      applyEnvFlags(['serve', 'api', '--database', 'a.db', '--db', ':memory:']);
      strictEqual(useEnv().has('DATABASE') && useEnv().has('DB'), true);
    });

    it('overrides an existing env value', () => {
      process.env['HOST'] = 'from-env';
      applyEnvFlags(['dev', '--host', 'from-flag']);
      strictEqual(useEnv().get('HOST'), 'from-flag');
    });
  });

  describe('envGlobals', () => {
    it('maps each flagged var to a camelCase arg of the right type', () => {
      const globals = envGlobals();
      deepStrictEqual(globals['host'], { type: 'string', description: 'Sets HOST' });
      deepStrictEqual(globals['forceSync'], { type: 'boolean', description: 'Sets FORCE_SYNC' });
      deepStrictEqual(globals['noColor'], { type: 'boolean', description: 'Sets NO_COLOR' });
      strictEqual(globals['cookieSecret']?.type, 'string');
    });
  });
});
