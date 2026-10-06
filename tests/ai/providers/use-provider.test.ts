import { deepStrictEqual, ok, rejects, strictEqual } from 'node:assert';
import { after, afterEach, before, describe, it } from 'node:test';

import type { Event } from '../../../src/ohne/http/event.ts';
import type { Config } from '../../../src/ohne/layers/config.ts';
import type { ProviderServer } from './_server.ts';

import {
  canUseModel,
  defaultModel,
  modelCredentials,
  useProvider,
} from '../../../src/ai/providers/use-provider.ts';
import { useEnv } from '../../../src/ohne/env/use-env.ts';
import { isOhneError } from '../../../src/ohne/error/ohne-error.ts';
import { hook } from '../../../src/ohne/hooks/hook.ts';
import { useHooks } from '../../../src/ohne/hooks/use-hooks.ts';
import { runWithEvent } from '../../../src/ohne/http/use-event.ts';
import { useLayers } from '../../../src/ohne/layers/use-layers.ts';
import { userWith } from '../_fixture.ts';
import { sse, startProviderServer } from './_server.ts';

const APP = '/use-provider-test';
const KEY = 'AI_USE_PROVIDER_KEY';
const user = userWith('asker');

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
    const provider = await useProvider(name, user);
    await Array.fromAsync(provider.step(request, new AbortController().signal));
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

  it("carries an entry's maxOutput to the wire", async () => {
    withModels({
      big: { provider: 'openai-compatible', model: 'm', key: false, maxOutput: 32000 },
    });
    server.answer({ body: answer() });
    const request = { system: [], tools: [], transcript: [] };
    const provider = await useProvider('big', user);
    await Array.fromAsync(provider.step(request, new AbortController().signal));
    strictEqual(server.requests.at(-1)?.body.max_tokens, 32000);
  });

  it('refuses a model whose key is unset or empty', async () => {
    withModels({ gpt: { provider: 'openai-compatible', model: 'gpt-test', key: KEY } });
    for (const value of [undefined, '']) {
      if (value === '') useEnv().set(KEY as never, value as never);
      await rejects(
        useProvider('gpt', user),
        (error: unknown) =>
          isOhneError(error) && error.title === 'The `gpt` model cannot be called',
      );
    }
  });

  it('refuses an unknown or inherited name, and a `jev` model', async () => {
    withModels({ router: { provider: 'jev', model: 'jev-test', key: false } });
    for (const name of ['smart', 'constructor', 'router']) {
      await rejects(useProvider(name, user), isOhneError, name);
    }
  });

  it('calls with the key, origin and headers `ai:credentials` answers', async () => {
    withModels({
      local: { provider: 'openai-compatible', model: 'qwen', key: false, headers: { 'x-a': '1' } },
    });
    const origin = server.url;
    useLayers().remove(APP);
    useLayers().add({
      path: APP,
      input: {
        ai: {
          models: {
            local: {
              provider: 'openai-compatible',
              model: 'qwen',
              key: false,
              baseURL: 'http://127.0.0.1:9/never',
              headers: { 'x-a': '1' },
            },
          },
        },
      },
    });
    hook('ai:credentials', (_, { name }) =>
      name === 'local' ? { key: 'sk-hooked', baseURL: origin, headers: { 'x-b': '2' } } : undefined,
    );
    try {
      strictEqual(await authorization('local'), 'Bearer sk-hooked');
      const headers = server.requests.at(-1)?.headers;
      strictEqual(headers?.['x-a'], '1');
      strictEqual(headers?.['x-b'], '2');
    } finally {
      useHooks().delete('ai:credentials');
    }
  });

  it('refuses an entry `ai:credentials` answers `false` for', async () => {
    withModels({ local: { provider: 'openai-compatible', model: 'qwen', key: false } });
    hook('ai:credentials', () => false);
    try {
      strictEqual(await canUseModel('local', user), false);
      await rejects(useProvider('local', user), isOhneError);
    } finally {
      useHooks().delete('ai:credentials');
    }
  });

  it('asks `ai:credentials` per user, once per request and entry', async () => {
    withModels({ local: { provider: 'openai-compatible', model: 'qwen', key: false } });
    const asked: string[] = [];
    hook('ai:credentials', (_, { user: { UUID } }) => {
      asked.push(UUID);
      return { key: `sk-${UUID}` };
    });
    const other = { ...user, UUID: 'u-other' };
    try {
      const [mine, theirs] = await runWithEvent(event(), () =>
        Promise.all([
          modelCredentials('local', user),
          modelCredentials('local', other),
          modelCredentials('local', user),
        ]),
      );
      deepStrictEqual(mine, { key: `sk-${user.UUID}` });
      deepStrictEqual(theirs, { key: 'sk-u-other' });
      deepStrictEqual(asked, [user.UUID, 'u-other']);
    } finally {
      useHooks().delete('ai:credentials');
    }
  });
});

describe('canUseModel and defaultModel', () => {
  afterEach(() => {
    useLayers().remove(APP);
    useEnv().unset(KEY as never);
  });

  it('holds for a set key and for `key: false`, never for an unknown name', async () => {
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
    strictEqual(await canUseModel('gpt', user), false);
    useEnv().set(KEY as never, '' as never);
    strictEqual(await canUseModel('gpt', user), false);
    useEnv().set(KEY as never, 'sk-test' as never);
    ok(await canUseModel('gpt', user));
    ok(await canUseModel('local', user));
    strictEqual(await canUseModel('smart', user), false);
    strictEqual(await canUseModel('constructor', user), false);
  });

  it('defaults to `ai.model` while it can be called, as `ai:model` picks among the callable', async () => {
    useLayers().add({
      path: APP,
      input: {
        ai: {
          model: 'gpt',
          models: {
            gpt: { provider: 'openai', model: 'gpt-test', key: KEY },
            local: { provider: 'openai-compatible', model: 'qwen', key: false },
          },
        },
      },
    });
    strictEqual(await defaultModel(user), undefined);
    useEnv().set(KEY as never, 'sk-test' as never);
    strictEqual(await defaultModel(user), 'gpt');
    hook('ai:model', (_, { available }) => available.at(-1));
    try {
      strictEqual(await defaultModel(user), 'local');
      useHooks().delete('ai:model');
      hook('ai:model', () => 'smart');
      strictEqual(await defaultModel(user), 'gpt');
    } finally {
      useHooks().delete('ai:model');
    }
  });
});

/**
 * A bare request event, so answers are kept for the request.
 */
function event(): Event {
  return {
    request: new Request('http://x.test/ai/turns', { method: 'POST' }),
    url: new URL('http://x.test/ai/turns'),
    params: {},
    ip: '127.0.0.1',
    response: { status: 200, headers: new Headers() },
    context: {},
    appliedMiddleware: [],
    waitUntil() {},
  };
}
