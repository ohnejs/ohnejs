import type { User } from 'ohnejs/auth';

import { hook, useSkills } from 'ohnejs';
import { userCan } from 'ohnejs/auth';
import { isUndefined, parseBytes, toSentenceCase } from 'ohnejs/utils';

import { resolveMessage } from '../../ohne/http/translate.ts';
import { useAIConfig } from '../config.ts';
import { hasModelKey } from '../providers/use-provider.ts';
import { startableFlows } from '../turns/run-flow.ts';
import { usableSkill } from '../turns/skills.ts';

declare module '../../base/api/dashboard.get.ts' {
  interface DashboardMeta {
    /**
     * The assistant, set only for a holder of `ai.use` while the default model has its key.
     * Absent, the palette is search only.
     */
    ai?: {
      /**
       * The `ai.models` entry a turn plans with unless the person picks another.
       */
      model: string;

      /**
       * The `ai.models` entries the person may pick for a turn, each able to plan and holding its key.
       */
      models: string[];

      /**
       * The `ai.models` entries a transform may run on: those of `models` that may see record values.
       */
      transformModels: string[];

      /**
       * The `ai.models` entry every transform runs on, when `ai.transform.model` pins one.
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

hook('dashboard:meta', (meta, { user }) => {
  const { model, models, transform, limits } = useAIConfig();
  if (isUndefined(model) || !userCan(user, 'ai.use') || !hasModelKey(model)) return;
  const usable = Object.keys(models).filter(
    (name) => models[name].provider !== 'jev' && hasModelKey(name),
  );
  meta.ai = {
    model,
    models: usable,
    transformModels: usable.filter((name) => models[name].data !== false),
    skills: skillsFor(user),
    flows: flowsFor(user),
    resultSize: parseBytes(limits.resultSize),
  };
  if (!isUndefined(transform.model)) meta.ai.transformModel = transform.model;
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
 * The flows `user` may start, as `startableFlows` picks them.
 */
function flowsFor(user: User): DashboardFlow[] {
  return startableFlows(user).map(({ name, flow }) => ({
    name,
    title: isUndefined(flow.title) ? toSentenceCase(name) : resolveMessage(flow.title),
    description: resolveMessage(flow.description),
  }));
}
