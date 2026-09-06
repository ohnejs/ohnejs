import { deepStrictEqual, strictEqual, throws } from 'node:assert';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { createEnvRegistry } from '../../../src/utils/env/create-env-registry.ts';
import { parseBoolean, parseInteger, parseNumber } from '../../../src/utils/index.ts';
import { effect } from '../../../src/utils/reactive/effect.ts';

interface SampleEnv {
  STR: string;
  NUM: number;
  INT: number;
  BOOL: boolean;
  JSON: { a: number };
  CUSTOM: { value: string };
}

const KEYS = ['STR', 'NUM', 'INT', 'BOOL', 'JSON', 'CUSTOM'] as const;

function defineAll(env: ReturnType<typeof createEnvRegistry<SampleEnv>>): void {
  env.define('STR', { default: 'fallback' });
  env.define('NUM', { default: 0, parse: parseNumber });
  env.define('INT', { default: 0, parse: parseInteger });
  env.define('BOOL', { default: false, parse: parseBoolean });
  env.define('JSON', { default: { a: 0 }, parse: (raw) => JSON.parse(raw) });
  env.define('CUSTOM', { default: { value: '' }, parse: (raw) => ({ value: raw.toUpperCase() }) });
}

describe('createEnvRegistry', () => {
  let prev: Record<string, string | undefined>;

  beforeEach(() => {
    prev = {};
    for (const k of KEYS) {
      prev[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of KEYS) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  });

  describe('defaults', () => {
    it('returns the spec default when the env var is unset', () => {
      const env = createEnvRegistry<SampleEnv>();
      defineAll(env);
      strictEqual(env.get('STR'), 'fallback');
      strictEqual(env.get('NUM'), 0);
      strictEqual(env.get('BOOL'), false);
      deepStrictEqual(env.get('JSON'), { a: 0 });
    });
  });

  describe('parse', () => {
    it('passes the raw value through when `parse` is omitted', () => {
      process.env['STR'] = 'hello';
      const env = createEnvRegistry<SampleEnv>();
      defineAll(env);
      strictEqual(env.get('STR'), 'hello');
    });

    it('runs the registered parser on the raw env value', () => {
      process.env['NUM'] = '3.14';
      process.env['INT'] = '42';
      process.env['BOOL'] = 'TRUE';
      process.env['JSON'] = '{"a":7}';
      const env = createEnvRegistry<SampleEnv>();
      defineAll(env);
      strictEqual(env.get('NUM'), 3.14);
      strictEqual(env.get('INT'), 42);
      strictEqual(env.get('BOOL'), true);
      deepStrictEqual(env.get('JSON'), { a: 7 });
    });

    it('propagates parser errors', () => {
      process.env['INT'] = '1.5';
      const env = createEnvRegistry<SampleEnv>();
      defineAll(env);
      throws(() => env.get('INT'), /Expected integer/);
    });

    it('supports custom `parse`', () => {
      process.env['CUSTOM'] = 'mixed';
      const env = createEnvRegistry<SampleEnv>();
      defineAll(env);
      deepStrictEqual(env.get('CUSTOM'), { value: 'MIXED' });
    });

    it('passes the var name to the parser as its second argument', () => {
      process.env['STR'] = 'raw';
      const env = createEnvRegistry<SampleEnv>();
      env.define('STR', { default: '', parse: (raw, name) => `${name}=${raw}` });
      strictEqual(env.get('STR'), 'STR=raw');
    });
  });

  describe('overrides', () => {
    it('`set` wins over `process.env`', () => {
      process.env['STR'] = 'from-env';
      const env = createEnvRegistry<SampleEnv>();
      defineAll(env);
      env.set('STR', 'from-override');
      strictEqual(env.get('STR'), 'from-override');
    });

    it('`unset` returns `true` when an override was cleared, `false` otherwise', () => {
      const env = createEnvRegistry<SampleEnv>();
      defineAll(env);
      env.set('STR', 'x');
      strictEqual(env.unset('STR'), true);
      strictEqual(env.unset('STR'), false);
    });

    it('`unset` falls back to env then default', () => {
      process.env['STR'] = 'from-env';
      const env = createEnvRegistry<SampleEnv>();
      defineAll(env);
      env.set('STR', 'x');
      env.unset('STR');
      strictEqual(env.get('STR'), 'from-env');
      delete process.env['STR'];
      strictEqual(env.get('STR'), 'fallback');
    });

    it('does not mutate `process.env`', () => {
      const env = createEnvRegistry<SampleEnv>();
      defineAll(env);
      env.set('STR', 'in-registry');
      strictEqual(process.env['STR'], undefined);
    });
  });

  describe('setRaw', () => {
    it('parses the raw string through the spec and stores it as an override', () => {
      const env = createEnvRegistry<SampleEnv>();
      defineAll(env);
      env.setRaw('INT', '42');
      strictEqual(env.get('INT'), 42);
    });

    it('wins over `process.env`, like `set`', () => {
      process.env['INT'] = '1';
      const env = createEnvRegistry<SampleEnv>();
      defineAll(env);
      env.setRaw('INT', '99');
      strictEqual(env.get('INT'), 99);
    });

    it('marks the var present for `has`', () => {
      const env = createEnvRegistry<SampleEnv>();
      defineAll(env);
      env.setRaw('STR', 'x');
      strictEqual(env.has('STR'), true);
    });

    it('passes the raw string through when `parse` is omitted', () => {
      const env = createEnvRegistry<SampleEnv>();
      defineAll(env);
      env.setRaw('STR', 'raw');
      strictEqual(env.get('STR'), 'raw');
    });

    it('propagates parser errors', () => {
      const env = createEnvRegistry<SampleEnv>();
      defineAll(env);
      throws(() => env.setRaw('INT', '1.5'), /Expected integer/);
    });

    it('does not mutate `process.env`', () => {
      const env = createEnvRegistry<SampleEnv>();
      defineAll(env);
      env.setRaw('STR', 'x');
      strictEqual(process.env['STR'], undefined);
    });

    it('throws on an undefined name', () => {
      const env = createEnvRegistry<SampleEnv>();
      throws(() => env.setRaw('STR', 'x'), /Env var not defined: STR/);
    });
  });

  describe('flag', () => {
    it('returns the registered flag kind, or undefined when none', () => {
      const env = createEnvRegistry<SampleEnv>();
      env.define('STR', { default: '', flag: 'value' });
      env.define('BOOL', { default: false, parse: parseBoolean, flag: 'boolean' });
      env.define('NUM', { default: 0, parse: parseNumber });
      strictEqual(env.flag('STR'), 'value');
      strictEqual(env.flag('BOOL'), 'boolean');
      strictEqual(env.flag('NUM'), undefined);
    });
  });

  describe('has', () => {
    it('returns `true` for an override', () => {
      const env = createEnvRegistry<SampleEnv>();
      defineAll(env);
      env.set('STR', 'x');
      strictEqual(env.has('STR'), true);
    });

    it('returns `true` when `process.env[name]` is set', () => {
      process.env['STR'] = 'present';
      const env = createEnvRegistry<SampleEnv>();
      defineAll(env);
      strictEqual(env.has('STR'), true);
    });

    it('returns `false` when neither override nor env is set', () => {
      const env = createEnvRegistry<SampleEnv>();
      defineAll(env);
      strictEqual(env.has('STR'), false);
    });
  });

  describe('names', () => {
    it('returns every defined var in registration order', () => {
      const env = createEnvRegistry<SampleEnv>();
      defineAll(env);
      deepStrictEqual([...env.names()], ['STR', 'NUM', 'INT', 'BOOL', 'JSON', 'CUSTOM']);
    });
  });

  describe('errors', () => {
    it('throws on `get` of an undefined name', () => {
      const env = createEnvRegistry<SampleEnv>();
      throws(() => env.get('STR'), /Env var not defined: STR/);
    });
  });

  describe('reactivity', () => {
    it('`get` inside an effect re-runs on `set`', () => {
      const env = createEnvRegistry<SampleEnv>();
      defineAll(env);
      let last: string | undefined;
      effect(() => {
        last = env.get('STR');
      });
      strictEqual(last, 'fallback');
      env.set('STR', 'updated');
      strictEqual(last, 'updated');
    });

    it('`get` inside an effect re-runs on `unset`', () => {
      const env = createEnvRegistry<SampleEnv>();
      defineAll(env);
      env.set('STR', 'override');
      let last: string | undefined;
      effect(() => {
        last = env.get('STR');
      });
      strictEqual(last, 'override');
      env.unset('STR');
      strictEqual(last, 'fallback');
    });

    it('is fine-grained per key - setting `STR` does not re-run an effect reading only `NUM`', () => {
      const env = createEnvRegistry<SampleEnv>();
      defineAll(env);
      let runs = 0;
      effect(() => {
        env.get('NUM');
        runs++;
      });
      strictEqual(runs, 1);
      env.set('STR', 'x');
      strictEqual(runs, 1);
      env.set('NUM', 42);
      strictEqual(runs, 2);
    });

    it('`fill` writes only the names `process.env` lacks and returns them in order', () => {
      process.env['STR'] = 'shell';
      const env = createEnvRegistry<SampleEnv>();
      defineAll(env);
      deepStrictEqual(env.fill({ STR: 'file', NUM: '1', BOOL: 'true' }), ['NUM', 'BOOL']);
      strictEqual(process.env['STR'], 'shell');
      strictEqual(env.get('NUM'), 1);
      strictEqual(env.get('BOOL'), true);
    });

    it('`fill` keeps an empty string already in `process.env`', () => {
      process.env['STR'] = '';
      const env = createEnvRegistry<SampleEnv>();
      defineAll(env);
      deepStrictEqual(env.fill({ STR: 'file' }), []);
      strictEqual(process.env['STR'], '');
    });

    it('a repeat `fill` removes what the previous one wrote before applying the new values', () => {
      process.env['STR'] = 'shell';
      const env = createEnvRegistry<SampleEnv>();
      defineAll(env);
      env.fill({ STR: 'file', NUM: '1', INT: '2' });
      deepStrictEqual(env.fill({ NUM: '3' }), ['NUM']);
      strictEqual(process.env['STR'], 'shell');
      strictEqual(process.env['NUM'], '3');
      strictEqual(process.env['INT'], undefined);
      env.fill({});
      strictEqual(process.env['NUM'], undefined);
    });

    it('`fill` fills a name that was never defined', () => {
      const env = createEnvRegistry<SampleEnv>();
      deepStrictEqual(env.fill({ STR: 'file' }), ['STR']);
      strictEqual(process.env['STR'], 'file');
    });

    it('an effect reading `get` through `process.env` re-runs on `fill`', () => {
      const env = createEnvRegistry<SampleEnv>();
      defineAll(env);
      let last = '';
      effect(() => {
        last = env.get('STR');
      });
      strictEqual(last, 'fallback');
      env.fill({ STR: 'file' });
      strictEqual(last, 'file');
      env.fill({});
      strictEqual(last, 'fallback');
    });

    it('an effect reading `has` flips on `fill`', () => {
      const env = createEnvRegistry<SampleEnv>();
      defineAll(env);
      let present = false;
      effect(() => {
        present = env.has('STR');
      });
      strictEqual(present, false);
      env.fill({ STR: 'file' });
      strictEqual(present, true);
      env.fill({});
      strictEqual(present, false);
    });

    it('a `fill` that changes nothing does not re-run an effect', () => {
      process.env['STR'] = 'shell';
      const env = createEnvRegistry<SampleEnv>();
      defineAll(env);
      let runs = 0;
      effect(() => {
        env.get('STR');
        runs++;
      });
      env.fill({ STR: 'file' });
      strictEqual(runs, 1);
    });

    it('an override still wins after `fill`, and its reader does not re-run', () => {
      const env = createEnvRegistry<SampleEnv>();
      defineAll(env);
      env.set('STR', 'override');
      let runs = 0;
      let last = '';
      effect(() => {
        last = env.get('STR');
        runs++;
      });
      env.fill({ STR: 'file' });
      strictEqual(last, 'override');
      strictEqual(runs, 1);
    });

    it('`has` inside an effect re-runs on `set` and `unset`', () => {
      const env = createEnvRegistry<SampleEnv>();
      defineAll(env);
      let present = false;
      effect(() => {
        present = env.has('STR');
      });
      strictEqual(present, false);
      env.set('STR', 'x');
      strictEqual(present, true);
      env.unset('STR');
      strictEqual(present, false);
    });
  });
});
