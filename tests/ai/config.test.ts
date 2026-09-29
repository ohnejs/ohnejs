import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { afterEach, describe, it } from 'node:test';

import type { Config } from '../../src/ohne/layers/config.ts';

import { AI_DEFAULTS, useAIConfig, validateAIConfig } from '../../src/ai/config.ts';
import aiLayer from '../../src/ai/ohne.layer.ts';
import { isOhneError } from '../../src/ohne/error/ohne-error.ts';
import { useLayers } from '../../src/ohne/layers/use-layers.ts';

const DEPENDENCY = '/ai-config-test/dependency';
const APP = '/ai-config-test/app';

for (const [path, strategy] of Object.entries(aiLayer.strategies ?? {})) {
  useLayers().setStrategy(path, strategy);
}

const smart = { provider: 'anthropic', model: 'claude-test', key: 'ANTHROPIC_API_KEY' } as const;
const router = { provider: 'jev', model: 'jev-test', key: 'JEV_API_KEY' } as const;
const local = { provider: 'openai-compatible', model: 'qwen', key: false, data: false } as const;

/**
 * Stacks the app's `ai` settings, and a dependency layer's beneath when given.
 */
function stack(app: Config['ai'], dependency?: Config['ai']): void {
  if (dependency) useLayers().add({ path: DEPENDENCY, input: { ai: dependency } });
  useLayers().add({ path: APP, input: { ai: app } });
}

/**
 * The title and body of the block `validateAIConfig` throws for `ai`, or `undefined` when it passes.
 */
function refusal(ai: Config['ai']): { title?: string; body?: unknown } | undefined {
  stack(ai);
  try {
    validateAIConfig();
    return undefined;
  } catch (error) {
    ok(isOhneError(error), String(error));
    return { title: error.title, body: error.body };
  }
}

afterEach(() => {
  useLayers().remove(APP);
  useLayers().remove(DEPENDENCY);
});

describe('useAIConfig', () => {
  it('falls back to the layer defaults', () => {
    deepStrictEqual(useAIConfig(), AI_DEFAULTS);
  });

  it('defaults a key the app omits beside one it sets', () => {
    stack({ limits: { steps: 4 }, prompts: { guard: 'Be careful.' } });
    const { limits, prompts } = useAIConfig();
    deepStrictEqual(limits, { ...AI_DEFAULTS.limits, steps: 4 });
    deepStrictEqual(prompts, { ...AI_DEFAULTS.prompts, guard: 'Be careful.' });
  });

  it('replaces a default list the app sets', () => {
    stack({ deny: { collections: ['Invoices'] }, autoAccept: { ask: ['destructive'] } });
    const { deny, autoAccept } = useAIConfig();
    deepStrictEqual(deny.collections, ['Invoices']);
    deepStrictEqual(autoAccept.ask, ['destructive']);
  });

  it('replaces the routes table whole', () => {
    stack({ routes: { 'POST /collections/items/query': 'read' } });
    deepStrictEqual(useAIConfig().routes, { 'POST /collections/items/query': 'read' });
  });

  it('turns a limit off with `false`', () => {
    stack({ limits: { tokens: false } });
    strictEqual(useAIConfig().limits.tokens, false);
  });
});

describe('the merge across layers', () => {
  it('ignores what a dependency layer sets', () => {
    stack(
      {},
      {
        model: 'smart',
        models: { smart },
        data: { Items: true },
        autoAccept: { max: 500 },
        routes: { 'POST /**': 'read' },
      },
    );
    const config = useAIConfig();
    strictEqual(config.model, undefined);
    deepStrictEqual(config.models, {});
    deepStrictEqual(config.data, {});
    strictEqual(config.autoAccept.max, 0);
    deepStrictEqual(config.routes, AI_DEFAULTS.routes);
  });

  it('keeps the app its own block whole, without the dependency beneath', () => {
    stack({ autoAccept: { fields: { Items: ['name'] } } }, { autoAccept: { max: 500 } });
    deepStrictEqual(useAIConfig().autoAccept, {
      ...AI_DEFAULTS.autoAccept,
      fields: { Items: ['name'] },
    });
  });

  it('gathers instructions from every layer, closest first', () => {
    stack({ instructions: ['From the app.'] }, { instructions: ['From the dependency.'] });
    deepStrictEqual(useAIConfig().instructions, ['From the app.', 'From the dependency.']);
  });

  it("keeps a dependency's instructions when the app sets none", () => {
    stack({}, { instructions: ['From the dependency.'] });
    deepStrictEqual(useAIConfig().instructions, ['From the dependency.']);
  });
});

describe('validateAIConfig', () => {
  it('passes the defaults and a full config', () => {
    strictEqual(refusal(undefined), undefined);
    useLayers().remove(APP);
    const full = refusal({
      model: 'smart',
      decide: 'router',
      transform: { model: 'smart' },
      models: { smart, router, local },
      data: { Items: true },
      autoAccept: { max: 20, fields: { Items: ['name'] } },
      limits: { turns: false, resultSize: 1024, step: 60_000 },
      audit: { retain: false },
    });
    strictEqual(full, undefined);
  });

  it('refuses a model name `ai.models` lacks, with a hint', () => {
    deepStrictEqual(refusal({ model: 'smrt', models: { smart } }), {
      title: '`ai.model` names unknown model `smrt`',
      body: ['No entry `smrt` is declared under `ai.models`.', 'Did you mean `smart`?'],
    });
  });

  for (const [key, ai] of [
    ['decide', { decide: 'router', models: { smart } }],
    ['transform.model', { transform: { model: 'router' }, models: { smart } }],
  ] as const) {
    it(`refuses an unknown \`ai.${key}\``, () => {
      strictEqual(refusal(ai)?.title, `\`ai.${key}\` names unknown model \`router\``);
    });
  }

  it('refuses a `jev` model where the assistant plans or transforms', () => {
    strictEqual(
      refusal({ model: 'router', models: { router } })?.title,
      '`ai.model` names the `jev` model `router`',
    );
    useLayers().remove(APP);
    strictEqual(
      refusal({ transform: { model: 'router' }, models: { router } })?.title,
      '`ai.transform.model` names the `jev` model `router`',
    );
  });

  it('refuses a blind model pinned for transforms', () => {
    strictEqual(
      refusal({ transform: { model: 'local' }, models: { local } })?.title,
      '`ai.transform.model` names the blind model `local`',
    );
  });

  it('refuses a key that is no env var name', () => {
    deepStrictEqual(refusal({ models: { smart: { ...smart, key: 'anthropic-key' } } }), {
      title: 'Invalid `ai.models.smart.key` value `anthropic-key`',
      body: [
        'It is the name of the env var holding the API key, such as `ANTHROPIC_API_KEY`, or `false`.',
        'Fix it under `ai.models.smart.key`.',
      ],
    });
  });

  it('refuses a tier outside the set', () => {
    const routes = { 'GET /collections/**': 'admin' } as unknown as Record<string, 'read'>;
    strictEqual(
      refusal({ routes })?.title,
      'Invalid `ai.routes` tier `admin` for `GET /collections/**`',
    );
  });

  it('refuses a prompt that is not a string', () => {
    const prompts = { guard: 42 } as unknown as { guard: string };
    strictEqual(refusal({ prompts })?.title, 'Invalid `ai.prompts.guard`');
  });

  it('refuses opening a denied collection', () => {
    deepStrictEqual(refusal({ data: { Users: ['email'] } }), {
      title: '`ai.data` names the denied collection `Users`',
      body: [
        '`ai.deny.collections` lists it, so the assistant never reaches it.',
        '',
        'Remove `Users` from `ai.data`, or from `ai.deny.collections`.',
      ],
    });
    useLayers().remove(APP);
    strictEqual(
      refusal({ autoAccept: { fields: { AITurns: true } } })?.title,
      '`ai.autoAccept.fields` names the denied collection `AITurns`',
    );
  });

  it('lets the app open a collection it takes off the deny list', () => {
    strictEqual(refusal({ deny: { collections: [] }, data: { Users: ['email'] } }), undefined);
  });

  it('refuses a rate that does not parse', () => {
    deepStrictEqual(refusal({ limits: { turns: { limit: 0, window: '1h' } } }), {
      title: 'Invalid `ai.limits.turns`',
      body: ['Invalid limit: 0', '', 'Set a positive whole `limit` and `window`, or `false`.'],
    });
  });

  for (const [ai, title] of [
    [{ limits: { steps: 0 } }, 'Invalid `ai.limits.steps` value `0`'],
    [{ limits: { requests: 2.5 } }, 'Invalid `ai.limits.requests` value `2.5`'],
    [{ limits: { transform: -1 } }, 'Invalid `ai.limits.transform` value `-1`'],
    [{ autoAccept: { max: -1 } }, 'Invalid `ai.autoAccept.max` value `-1`'],
    [{ limits: { resultSize: 'lots' } }, 'Invalid `ai.limits.resultSize` value `lots`'],
    [{ limits: { step: 'soon' } }, 'Invalid `ai.limits.step` value `soon`'],
    [{ limits: { turnTimeout: 0 } }, 'Invalid `ai.limits.turnTimeout` value `0`'],
    [{ audit: { retain: 'forever' } }, 'Invalid `ai.audit.retain` value `forever`'],
  ] as const) {
    it(`refuses ${title.slice('Invalid '.length)}`, () => {
      strictEqual(refusal(ai)?.title, title);
    });
  }
});
