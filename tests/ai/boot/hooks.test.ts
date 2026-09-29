import { deepStrictEqual, strictEqual } from 'node:assert';
import { afterEach, beforeEach, describe, it } from 'node:test';

import type { DashboardMeta } from '../../../src/base/api/dashboard.get.ts';
import type { User } from '../../../src/base/auth/types.ts';
import type { Config } from '../../../src/ohne/layers/config.ts';

import '../../../src/ai/boot/hooks.ts';
import { useEnv } from '../../../src/ohne/env/use-env.ts';
import { applyHook } from '../../../src/ohne/hooks/apply-hook.ts';
import { useMessages } from '../../../src/ohne/messages/use-messages.ts';
import { useSkills } from '../../../src/ohne/skills/use-skills.ts';
import { userWith, withAI } from '../_fixture.ts';

const KEYS = ['AI_HOOKS_SMART_KEY', 'AI_HOOKS_GPT_KEY', 'AI_HOOKS_JEV_KEY'] as const;
for (const key of KEYS) useEnv().define(key as never, { default: undefined as never });

const ai: Config['ai'] = {
  model: 'smart',
  models: {
    smart: { provider: 'anthropic', model: 'claude-test', key: 'AI_HOOKS_SMART_KEY' },
    gpt: { provider: 'openai', model: 'gpt-test', key: 'AI_HOOKS_GPT_KEY' },
    local: { provider: 'openai-compatible', model: 'qwen', key: false },
    router: { provider: 'jev', model: 'jev-test', key: 'AI_HOOKS_JEV_KEY' },
  },
};

useMessages().register('en', { 'skills.translate.title': 'Translate items' });
useSkills().register('translate-items', {
  name: 'translate-items',
  skill: {
    title: 'skills.translate.title',
    description: 'Translate item names and tooltips.',
    prompt: 'Translate.',
    capability: 'collection.Items.update',
  },
});
useSkills().register('weekly-report', {
  name: 'weekly-report',
  skill: { description: 'Sum up the week.', prompt: 'Report.' },
});

const translate = {
  name: 'translate-items',
  title: 'Translate items',
  description: 'Translate item names and tooltips.',
};
const report = { name: 'weekly-report', title: 'Weekly report', description: 'Sum up the week.' };

/**
 * The `ai` key the `dashboard:meta` hook leaves for `user` under `config`.
 */
async function metaFor(user: User, config: Config['ai']): Promise<DashboardMeta['ai']> {
  const meta = {} as DashboardMeta;
  await withAI(config, () => applyHook('dashboard:meta', meta, { user }));
  return meta.ai;
}

describe('the dashboard:meta hook', () => {
  beforeEach(() => {
    useEnv().set('AI_HOOKS_SMART_KEY' as never, 'sk-smart' as never);
    useEnv().set('AI_HOOKS_JEV_KEY' as never, 'jev' as never);
  });
  afterEach(() => {
    for (const key of KEYS) useEnv().unset(key as never);
  });

  it('describes the assistant to a holder of `ai.use`, with the models they may pick', async () => {
    deepStrictEqual(await metaFor(userWith('asker'), ai), {
      model: 'smart',
      models: ['smart', 'local'],
      skills: [report],
    });
  });

  it('lists a model once its key is set', async () => {
    useEnv().set('AI_HOOKS_GPT_KEY' as never, 'sk-gpt' as never);
    deepStrictEqual((await metaFor(userWith('asker'), ai))?.models, ['smart', 'gpt', 'local']);
  });

  it('lists a skill behind a capability only for a holder of it', async () => {
    deepStrictEqual((await metaFor(userWith('editor'), ai))?.skills, [translate, report]);
  });

  it('lets `*` cover `ai.use`', async () => {
    deepStrictEqual((await metaFor(userWith('admin'), ai))?.skills, [translate, report]);
  });

  it('names a pinned transform model', async () => {
    const pinned = { ...ai, transform: { model: 'local' } };
    strictEqual((await metaFor(userWith('asker'), pinned))?.transformModel, 'local');
  });

  it('stays absent without `ai.use`', async () => {
    strictEqual(await metaFor(userWith('reader'), ai), undefined);
  });

  it('stays absent while the default model has no key', async () => {
    useEnv().unset('AI_HOOKS_SMART_KEY' as never);
    strictEqual(await metaFor(userWith('asker'), ai), undefined);
  });

  it('stays absent without `ai.model`', async () => {
    strictEqual(await metaFor(userWith('asker'), { models: ai?.models }), undefined);
  });

  it('stays absent without any `ai` config', async () => {
    strictEqual(await metaFor(userWith('admin'), undefined), undefined);
  });

  it('appears for a keyless local default model', async () => {
    const local = { ...ai, model: 'local' };
    strictEqual((await metaFor(userWith('asker'), local))?.model, 'local');
  });
});
