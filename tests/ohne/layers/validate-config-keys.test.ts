import { doesNotThrow, throws } from 'node:assert';
import { describe, it } from 'node:test';

import type { Config, ResolvedLayer } from '../../../src/ohne/index.ts';
import type { LayerStrategies } from '../../../src/utils/index.ts';

import { isOhneError, validateConfigKeys } from '../../../src/ohne/index.ts';

function layer(
  input: unknown,
  extra: { name?: string; dir?: string; defaults?: Config; strategies?: LayerStrategies } = {},
): ResolvedLayer {
  const { name = 'app', dir = '/app', defaults = {}, strategies = {} } = extra;
  return { name, dir, input: input as Config, defaults, strategies, codegen: [] };
}

function refused(title: RegExp, body: RegExp, path = '/app/ohne.config.ts') {
  return (error: unknown) => {
    if (!isOhneError(error)) return false;
    const text = Array.isArray(error.body) ? error.body.join('\n') : (error.body ?? '');
    return title.test(error.title ?? '') && body.test(text) && error.path === path;
  };
}

describe('validateConfigKeys', () => {
  it('accepts every framework root and its nested keys', () => {
    doesNotThrow(() =>
      validateConfigKeys([
        layer({
          database: { dialect: 'postgres', sync: { force: true }, helpers: { x: 'y' } },
          dashboard: { menu: { foo: { order: 1 } } },
          query: { guards: { maxLimit: 1 } },
          printer: { silent: true },
        }),
      ]),
    );
  });

  it('refuses an unknown root key with a near key', () => {
    throws(
      () => validateConfigKeys([layer({ databse: {} })]),
      refused(/Unknown config key `databse`/, /Did you mean `database`\?/),
    );
  });

  it('refuses an unknown nested key', () => {
    throws(
      () => validateConfigKeys([layer({ database: { dialet: 'sqlite' } })]),
      refused(/`database\.dialet`/, /Did you mean `database\.dialect`\?/),
    );
  });

  it('refuses an unknown deep key', () => {
    throws(
      () => validateConfigKeys([layer({ database: { sync: { forse: true } } })]),
      refused(/`database\.sync\.forse`/, /Did you mean `database\.sync\.force`\?/),
    );
  });

  it('accepts a key a lower layer declares in `defaults`, leaving its section unchecked', () => {
    doesNotThrow(() =>
      validateConfigKeys([
        layer({}, { name: 'blog', dir: '/blog', defaults: { blog: { pageSize: 20 } } as Config }),
        layer({ blog: { pageSize: 5, anything: 1 } }),
      ]),
    );
  });

  it('accepts a key a lower layer declares only in `strategies`', () => {
    doesNotThrow(() =>
      validateConfigKeys([
        layer({}, { name: 'ai', dir: '/ai', strategies: { 'ai.providers': 'assign-entries' } }),
        layer({ ai: { providers: {} } }),
      ]),
    );
  });

  it('refuses a layer key no stacked layer declares, telling you to list the layer', () => {
    throws(
      () => validateConfigKeys([layer({ uploads: {} })]),
      refused(/Unknown config key `uploads`/, /list the layer in `layers`/),
    );
  });

  it('names the config of the layer that sets the key', () => {
    throws(
      () => validateConfigKeys([layer({ printr: {} }, { name: 'lib', dir: '/lib' }), layer({})]),
      refused(/`printr`/, /Did you mean `printer`\?/, '/lib/ohne.config.ts'),
    );
  });
});
