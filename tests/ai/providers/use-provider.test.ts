import { ok, strictEqual, throws } from 'node:assert';
import { after, afterEach, before, describe, it } from 'node:test';

import type { Config } from '../../../src/ohne/layers/config.ts';
import type { ProviderServer } from './_server.ts';

import { hasModelKey, useProvider } from '../../../src/ai/providers/use-provider.ts';
import { useEnv } from '../../../src/ohne/env/use-env.ts';
import { isOhneError } from '../../../src/ohne/error/ohne-error.ts';
import { useLayers } from '../../../src/ohne/layers/use-layers.ts';
import { sse, startProviderServer } from './_server.ts';

const APP = '/use-provider-test';
const KEY = 'AI_USE_PROVIDER_KEY';

useEnv().define(KEY as never, { default: undefined as never });

const answer = (): string =>
  sse([
    { data: { choices: [{ index: 0, delta: { content: 'Hi' }, finish_reason: null }] } },
    { data: { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] } },
    { data: { choices: [], usage: { prompt_tokens: 1, completion_tokens: 1 } } },
  ]) + 'data: [DONE]\n\n';

describe('useProvider', () => {
  let server: ProviderServer;

  /**
   * Stacks `models` as the app's, every entry pointed at the stand-in.
   */
  function withModels(models: NonNullable<NonNullable<Config['ai']>['models']>): void {
    for (const entry of Object.values(models)) entry.baseURL = server.url;
    useLayers().add({ path: APP, input: { ai: { models } } });
  }

  /**
   * Runs one step on the model `name` and returns the `authorization` header the stand-in saw.
   */
  async function authorization(name: string): Promise<string | undefined> {
    server.answer({ body: answer() });
    const request = { system: [], tools: [], transcript: [] };
    await Array.fromAsync(useProvider(name).step(request, new AbortController().signal));
    return server.requests.at(-1)?.headers.authorization;
  }

  before(async () => {
    server = await startProviderServer();
  });
  after(() => server.close());
  afterEach(() => {
    useLayers().remove(APP);
    useEnv().unset(KEY as never);
  });

  it('reads the key from the env at every call', async () => {
    withModels({ gpt: { provider: 'openai-compatible', model: 'gpt-test', key: KEY } });
    useEnv().set(KEY as never, 'sk-first' as never);
    strictEqual(await authorization('gpt'), 'Bearer sk-first');
    useEnv().set(KEY as never, 'sk-rotated' as never);
    strictEqual(await authorization('gpt'), 'Bearer sk-rotated');
  });

  it('sends no key for `key: false`', async () => {
    withModels({ local: { provider: 'openai-compatible', model: 'qwen', key: false } });
    strictEqual(await authorization('local'), undefined);
  });

  it('refuses a model whose key is unset or empty', () => {
    withModels({ gpt: { provider: 'openai-compatible', model: 'gpt-test', key: KEY } });
    for (const value of [undefined, '']) {
      if (value === '') useEnv().set(KEY as never, value as never);
      throws(
        () => useProvider('gpt'),
        (error: unknown) => isOhneError(error) && error.title === 'The `gpt` model has no key',
      );
    }
  });

  it('refuses an unknown or inherited name, and a `jev` model', () => {
    withModels({ router: { provider: 'jev', model: 'jev-test', key: false } });
    for (const name of ['smart', 'constructor', 'router']) {
      throws(() => useProvider(name), isOhneError, name);
    }
  });
});

describe('hasModelKey', () => {
  afterEach(() => {
    useLayers().remove(APP);
    useEnv().unset(KEY as never);
  });

  it('holds for a set key and for `key: false`, never for an unknown name', () => {
    useLayers().add({
      path: APP,
      input: {
        ai: {
          models: {
            gpt: { provider: 'openai', model: 'gpt-test', key: KEY },
            local: { provider: 'openai-compatible', model: 'qwen', key: false },
          },
        },
      },
    });
    strictEqual(hasModelKey('gpt'), false);
    useEnv().set(KEY as never, '' as never);
    strictEqual(hasModelKey('gpt'), false);
    useEnv().set(KEY as never, 'sk-test' as never);
    ok(hasModelKey('gpt'));
    ok(hasModelKey('local'));
    strictEqual(hasModelKey('smart'), false);
    strictEqual(hasModelKey('constructor'), false);
  });
});
