import { doesNotReject, ok, rejects, strictEqual } from 'node:assert';
import { afterEach, describe, it } from 'node:test';

import type { FlowDefinition } from '../../../src/ohne/flows/define-flow.ts';
import type { Config } from '../../../src/ohne/layers/config.ts';

import '../../../src/ai/boot/flows.ts';
import { isOhneError } from '../../../src/ohne/error/ohne-error.ts';
import { useFlows } from '../../../src/ohne/flows/use-flows.ts';
import { applyHook } from '../../../src/ohne/hooks/apply-hook.ts';
import { useSkills } from '../../../src/ohne/skills/use-skills.ts';
import { withAI } from '../_fixture.ts';

const ai: Config['ai'] = {
  model: 'smart',
  models: {
    smart: { provider: 'anthropic', model: 'claude-test', key: 'AI_FLOWS_BOOT_KEY' },
    router: { provider: 'jev', model: 'jev-test', key: false },
  },
};

useSkills().register('translate-items', {
  name: 'translate-items',
  skill: { description: 'Translate.', prompt: 'Translate.' },
});

const ready = () => applyHook('server:ready', { host: '127.0.0.1', port: 0 });

/**
 * A flow of one decide node and one act node, each patched.
 */
function flow(decide: object = {}, act: object = {}): FlowDefinition {
  return {
    description: 'Routes.',
    start: 'triage',
    nodes: {
      triage: {
        decide: { questions: { go: { yesNo: 'Go?' } }, ...decide },
        next: { on: 'go', cases: { yes: 'translate' } },
      },
      translate: { act: { skill: 'translate-items', ...act } },
    },
  };
}

/**
 * The title and body of the block the `server:ready` hook throws for `flow` under `ai`.
 */
async function refusal(definition: FlowDefinition): Promise<{ title?: string; body?: unknown }> {
  useFlows().register('checked', { name: 'checked', flow: definition });
  let thrown: unknown;
  await withAI(ai, () =>
    rejects(ready(), (error: unknown) => {
      thrown = error;
      return true;
    }),
  );
  ok(isOhneError(thrown), String(thrown));
  return { title: thrown.title, body: thrown.body };
}

describe('the server:ready flow check', () => {
  afterEach(() => {
    useFlows().delete('checked');
  });

  it('passes a flow whose models and skills exist, a `jev` model on its decide node', async () => {
    useFlows().register('checked', { name: 'checked', flow: flow({ model: 'router' }) });
    await withAI(ai, () => doesNotReject(ready()));
  });

  it('refuses a decide model `ai.models` lacks, with a hint', async () => {
    const { title, body } = await refusal(flow({ model: 'routr' }));
    strictEqual(title, '`flows/checked: nodes.triage.decide.model` names unknown model `routr`');
    ok(String(body).includes('Did you mean `router`?'));
  });

  it('refuses an act model `ai.models` lacks', async () => {
    const { title } = await refusal(flow({}, { model: 'gpt' }));
    strictEqual(title, '`flows/checked: nodes.translate.act.model` names unknown model `gpt`');
  });

  it('refuses a `jev` model on an act node', async () => {
    const { title } = await refusal(flow({}, { model: 'router' }));
    strictEqual(title, '`flows/checked: nodes.translate.act.model` names the `jev` model `router`');
  });

  it('refuses a skill no layer ships, with a hint', async () => {
    const { title, body } = await refusal(flow({}, { skill: 'translate-item' }));
    strictEqual(
      title,
      '`flows/checked: nodes.translate.act.skill` names unknown skill `translate-item`',
    );
    ok(String(body).includes('Did you mean `translate-items`?'));
  });
});
