import { deepStrictEqual, rejects, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { Env } from '../../../src/ohne/env/env.ts';

import { useEnv } from '../../../src/ohne/env/use-env.ts';
import { isOhneError } from '../../../src/ohne/error/ohne-error.ts';
import { withAI } from '../_fixture.ts';

const BOOT = new URL('../../../src/ai/boot/config.ts', import.meta.url).href;

const name = (key: string) => key as keyof Env;

describe('the config boot file', () => {
  it('stops the boot on a bad assistant setting, before any turn', async () => {
    await withAI({ model: 'smart' }, () =>
      rejects(
        import(`${BOOT}?bad`),
        (error: unknown) =>
          isOhneError(error) && error.title === '`ai.model` names unknown model `smart`',
      ),
    );
  });

  it('defines the env var each model names, unset by default', async () => {
    const models = {
      smart: { provider: 'anthropic', model: 'claude-test', key: 'AI_BOOT_TEST_KEY' },
      local: { provider: 'openai-compatible', model: 'qwen', key: false },
    } as const;
    await withAI({ models }, () => import(`${BOOT}?keys`));
    strictEqual(useEnv().get(name('AI_BOOT_TEST_KEY')), undefined);
    process.env.AI_BOOT_TEST_KEY = 'sk-test';
    try {
      strictEqual(useEnv().get(name('AI_BOOT_TEST_KEY')), 'sk-test');
    } finally {
      delete process.env.AI_BOOT_TEST_KEY;
    }
  });

  it('keeps the spec of a var another layer already defines', async () => {
    useEnv().define(name('AI_BOOT_SHARED_KEY'), { default: 'from-the-layer' as never });
    const models = {
      smart: { provider: 'openai', model: 'gpt-test', key: 'AI_BOOT_SHARED_KEY' },
    } as const;
    await withAI({ models }, () => import(`${BOOT}?shared`));
    deepStrictEqual(useEnv().get(name('AI_BOOT_SHARED_KEY')), 'from-the-layer');
  });
});
