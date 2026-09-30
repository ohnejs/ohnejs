import { hook, ohneError, useFlows, useSkills } from 'ohnejs';
import { didYouMean, hasKey, isUndefined } from 'ohnejs/utils';

import { useAIConfig } from '../config.ts';

// Once every flow and skill is registered, so a name the app lacks is known to be wrong.
hook('server:ready', assertFlows);

/**
 * Refuses a flow node naming a model `ai.models` lacks, or a skill no layer ships.
 * An act node's model must be able to plan, so a `jev` one is refused there; a decide node may name it.
 * A node found wrong at boot would otherwise fail the first turn that reaches it.
 */
function assertFlows(): void {
  const { models } = useAIConfig();
  for (const { name, flow } of Object.values(useFlows().all())) {
    for (const [id, node] of Object.entries(flow.nodes)) {
      const path = `flows/${name}: nodes.${id}`;
      if ('decide' in node) {
        assertModel(`${path}.decide.model`, node.decide.model, models);
        continue;
      }
      assertModel(`${path}.act.model`, node.act.model, models);
      const { model, skill } = node.act;
      if (!isUndefined(model) && models[model].provider === 'jev') {
        throw ohneError({
          title: `\`${path}.act.model\` names the \`jev\` model \`${model}\``,
          body: [
            'A `jev` model answers decide nodes only; an act node runs the assistant.',
            '',
            'Name an `anthropic`, `openai` or `openai-compatible` model, or drop `model`.',
          ],
        });
      }
      if (isUndefined(skill) || !isUndefined(useSkills().get(skill))) continue;
      const near = didYouMean(skill, useSkills().keys());
      throw ohneError({
        title: `\`${path}.act.skill\` names unknown skill \`${skill}\``,
        body: [
          `No skill \`${skill}\` is registered.`,
          ...(isUndefined(near) ? [] : [`Did you mean \`${near}\`?`]),
        ],
      });
    }
  }
}

/**
 * Refuses the model `name` at `path` when it is set and `ai.models` has no such entry.
 */
function assertModel(
  path: string,
  name: string | undefined,
  models: Record<string, unknown>,
): void {
  if (isUndefined(name) || hasKey(models, name)) return;
  const near = didYouMean(name, Object.keys(models));
  throw ohneError({
    title: `\`${path}\` names unknown model \`${name}\``,
    body: [
      `No entry \`${name}\` is declared under \`ai.models\`.`,
      ...(isUndefined(near) ? [] : [`Did you mean \`${near}\`?`]),
    ],
  });
}
