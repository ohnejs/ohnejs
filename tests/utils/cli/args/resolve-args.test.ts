import { deepStrictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { resolveArgs } from '../../../../src/utils/cli/index.ts';

describe('resolveArgs', () => {
  it('coerces a number and resolves an alias', () => {
    const schema = { port: { type: 'number', default: 3000, alias: 'p' } } as const;
    deepStrictEqual(resolveArgs(schema, ['-p', '8080']), {
      ok: true,
      values: { port: 8080 },
      positionals: [],
    });
  });

  it('applies a default when the flag is absent', () => {
    const schema = { port: { type: 'number', default: 3000 } } as const;
    deepStrictEqual(resolveArgs(schema, []), { ok: true, values: { port: 3000 }, positionals: [] });
  });

  it('truncates to an integer when `integer` is set', () => {
    const schema = { n: { type: 'number', integer: true } } as const;
    deepStrictEqual(resolveArgs(schema, ['--n', '1.9']), {
      ok: true,
      values: { n: 1 },
      positionals: [],
    });
  });

  it('defaults a boolean to false and reads --no- as false', () => {
    const schema = { force: { type: 'boolean' } } as const;
    deepStrictEqual(resolveArgs(schema, []), {
      ok: true,
      values: { force: false },
      positionals: [],
    });
    deepStrictEqual(resolveArgs(schema, ['--force']), {
      ok: true,
      values: { force: true },
      positionals: [],
    });
    deepStrictEqual(resolveArgs(schema, ['--no-force']), {
      ok: true,
      values: { force: false },
      positionals: [],
    });
  });

  it('resolves a `no`-prefixed boolean key through its kebab flag', () => {
    const schema = { noCache: { type: 'boolean' } } as const;
    deepStrictEqual(resolveArgs(schema, ['--no-cache']), {
      ok: true,
      values: { noCache: true },
      positionals: [],
    });
    deepStrictEqual(resolveArgs(schema, []), {
      ok: true,
      values: { noCache: false },
      positionals: [],
    });
  });

  it('accepts a valid enum value', () => {
    const schema = { mode: { type: 'enum', options: ['dev', 'prod'] } } as const;
    deepStrictEqual(resolveArgs(schema, ['--mode', 'prod']), {
      ok: true,
      values: { mode: 'prod' },
      positionals: [],
    });
  });

  it('carries positionals through', () => {
    const schema = { force: { type: 'boolean' } } as const;
    deepStrictEqual(resolveArgs(schema, ['build', '--force', 'src']), {
      ok: true,
      values: { force: true },
      positionals: ['build', 'src'],
    });
  });

  it('takes the last value of a repeated scalar flag', () => {
    const schema = { tag: { type: 'string' } } as const;
    deepStrictEqual(resolveArgs(schema, ['--tag', 'a', '--tag', 'b']), {
      ok: true,
      values: { tag: 'b' },
      positionals: [],
    });
  });

  it('prefers the canonical name over an alias regardless of argv order', () => {
    const schema = { port: { type: 'number', alias: 'p' } } as const;
    const expected = { ok: true, values: { port: 90 }, positionals: [] };
    deepStrictEqual(resolveArgs(schema, ['-p', '80', '--port', '90']), expected);
    deepStrictEqual(resolveArgs(schema, ['--port', '90', '-p', '80']), expected);
  });

  it('matches a camelCase schema key from a kebab-case flag', () => {
    const schema = { fullFlag: { type: 'string' } } as const;
    const expected = { ok: true, values: { fullFlag: 'x' }, positionals: [] };
    deepStrictEqual(resolveArgs(schema, ['--full-flag', 'x']), expected);
    deepStrictEqual(resolveArgs(schema, ['--fullFlag', 'x']), expected);
  });

  it('does not consume a positional after a kebab-spelled boolean flag', () => {
    const schema = { dryRun: { type: 'boolean' } } as const;
    deepStrictEqual(resolveArgs(schema, ['--dry-run', 'build']), {
      ok: true,
      values: { dryRun: true },
      positionals: ['build'],
    });
  });

  it('reports an unknown flag with a suggestion', () => {
    const schema = { port: { type: 'number' } } as const;
    const result = resolveArgs(schema, ['--prot', '80']);
    deepStrictEqual(result, {
      ok: false,
      errors: [
        {
          kind: 'unknown',
          name: 'prot',
          message: 'Unknown flag `--prot`. Did you mean `--port`?',
          suggestion: 'port',
        },
      ],
      positionals: [],
    });
  });

  it('reports a missing required flag', () => {
    const schema = { name: { type: 'string', required: true } } as const;
    deepStrictEqual(resolveArgs(schema, []), {
      ok: false,
      errors: [{ kind: 'missing', name: 'name', message: 'Missing required flag `--name`' }],
      positionals: [],
    });
  });

  it('reports a string flag given without a value', () => {
    const schema = { name: { type: 'string' } } as const;
    deepStrictEqual(resolveArgs(schema, ['--name']), {
      ok: false,
      errors: [{ kind: 'invalid', name: 'name', message: 'Flag `--name` expects a value' }],
      positionals: [],
    });
  });

  it('reports a non-numeric number value', () => {
    const schema = { port: { type: 'number' } } as const;
    deepStrictEqual(resolveArgs(schema, ['--port', 'abc']), {
      ok: false,
      errors: [
        { kind: 'invalid', name: 'port', message: 'Flag `--port` expects a number, got `abc`' },
      ],
      positionals: [],
    });
  });

  it('reports an invalid enum value with a suggestion', () => {
    const schema = { mode: { type: 'enum', options: ['dev', 'prod'] } } as const;
    deepStrictEqual(resolveArgs(schema, ['--mode', 'prdo']), {
      ok: false,
      errors: [
        {
          kind: 'invalid',
          name: 'mode',
          message: 'Flag `--mode` must be one of `dev`, `prod`. Did you mean `prod`?',
        },
      ],
      positionals: [],
    });
  });
});
