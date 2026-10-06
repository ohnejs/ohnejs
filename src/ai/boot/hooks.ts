import type { User } from 'ohnejs/auth';

import { hook, useSkills } from 'ohnejs';
import { userCan } from 'ohnejs/auth';
import { isUndefined, parseBytes, parseDuration, toSentenceCase } from 'ohnejs/utils';

import { resolveMessage } from '../../ohne/http/translate.ts';
import { useAIConfig } from '../config.ts';
import { canUseModel, defaultModel } from '../providers/use-provider.ts';
import { flowModels, startableFlows } from '../turns/run-flow.ts';
import { usableSkill } from '../turns/skills.ts';

declare module '../../base/api/dashboard.get.ts' {
  interface DashboardMeta {
    /**
     * The assistant, set only for a holder of `ai.use` who can call the default model.
     * Absent, the palette is search only.
     */
    ai?: {
      /**
       * The `ai.models` entry a turn plans with unless the person picks another.
       */
      model: string;

      /**
       * The `ai.models` entries the user may pick for a turn, each able to plan and callable by them.
       */
      models: string[];

      /**
       * The `ai.models` entries a transform may run on: those of `models` that may see record values.
       */
      transformModels: string[];

      /**
       * The `ai.models` entry every transform runs on, when `ai.transform.model` pins one the user can call.
       */
      transformModel?: string;

      /**
       * The skills the person may start, in the viewer's language.
       */
      skills: DashboardSkill[];

      /**
       * The flows the person may start, in the viewer's language.
       */
      flows: DashboardFlow[];

      /**
       * The most bytes one answer may carry into a results post, `ai.limits.resultSize` in bytes.
       */
      resultSize: number;

      /**
       * How long a batch waits for the person before its turn closes, in milliseconds.
       */
      turnTimeout: number;
    };
  }
}

/**
 * A flow as the palette lists it.
 */
interface DashboardFlow {
  /**
   * The flow's name, typed after `/` to start it.
   */
  name: string;

  /**
   * The flow's title, or its name in sentence case when it declares none.
   */
  title: string;

  /**
   * What the flow does.
   */
  description: string;
}

/**
 * A skill as the palette lists it.
 */
interface DashboardSkill {
  /**
   * The skill's name, typed after `/` to start it.
   */
  name: string;

  /**
   * The skill's title, or its name in sentence case when it declares none.
   */
  title: string;

  /**
   * What the skill does.
   */
  description: string;
}

hook('dashboard:meta', async (meta, { user }) => {
  if (!userCan(user, 'ai.use')) return;
  const model = await defaultModel(user);
  if (isUndefined(model)) return;
  const { models, transform, limits } = useAIConfig();
  const usable: string[] = [];
  for (const name of Object.keys(models)) {
    if (models[name].provider !== 'jev' && (await canUseModel(name, user))) usable.push(name);
  }
  meta.ai = {
    model,
    models: usable,
    transformModels: usable.filter((name) => models[name].data !== false),
    skills: skillsFor(user),
    flows: await flowsFor(user, model),
    resultSize: parseBytes(limits.resultSize),
    turnTimeout: parseDuration(limits.turnTimeout),
  };
  if (!isUndefined(transform.model) && (await canUseModel(transform.model, user))) {
    meta.ai.transformModel = transform.model;
  }
});

/**
 * The skills `user` may start: those without a capability, and those whose capability the user holds.
 */
function skillsFor(user: User): DashboardSkill[] {
  return Object.entries(useSkills().all())
    .filter(([name]) => !isUndefined(usableSkill(user, name)))
    .map(([name, { skill }]) => ({
      name,
      title: isUndefined(skill.title) ? toSentenceCase(name) : resolveMessage(skill.title),
      description: resolveMessage(skill.description),
    }));
}

/**
 * The flows `user` may start, as `startableFlows` picks them, every model they run on callable.
 * A node without a model runs on `model`.
 */
async function flowsFor(user: User, model: string): Promise<DashboardFlow[]> {
  const flows: DashboardFlow[] = [];
  for (const { name, flow } of startableFlows(user)) {
    let callable = true;
    for (const entry of flowModels(flow, model)) callable &&= await canUseModel(entry, user);
    if (!callable) continue;
    flows.push({
      name,
      title: isUndefined(flow.title) ? toSentenceCase(name) : resolveMessage(flow.title),
      description: resolveMessage(flow.description),
    });
  }
  return flows;
}
