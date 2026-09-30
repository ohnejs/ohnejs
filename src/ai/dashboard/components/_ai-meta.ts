import { type DashboardCollection, dashboardMeta } from 'ohnejs/dashboard';
import { isUndefined, parseRouteID } from 'ohnejs/utils';

declare module 'ohnejs/dashboard' {
  interface DashboardMeta {
    /**
     * The assistant, set only for a holder of `ai.use` while the default model has its key.
     * Absent, the palette is search only.
     */
    ai?: AIMeta;
  }
}

/**
 * The assistant as the discovery read describes it.
 */
export interface AIMeta {
  /**
   * The `ai.models` entry a turn plans with unless the person picks another.
   */
  model: string;

  /**
   * The `ai.models` entries the person may pick for a turn.
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
  skills: AISkillMeta[];

  /**
   * The flows the person may start, in the viewer's language.
   */
  flows: AIFlowMeta[];

  /**
   * The most bytes one answer may carry into a results post, `ai.limits.resultSize` resolved.
   */
  resultSize: number;
}

/**
 * A skill as the palette lists it.
 */
export interface AISkillMeta {
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

/**
 * A flow as the palette lists it.
 */
export interface AIFlowMeta {
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

const COLLECTION_ROUTE = /^\/collections\/([^/]+)/;

/**
 * The assistant off the discovery read, `undefined` while it loads or when the person has no assistant.
 * Reactive, so a palette row can appear when the read lands.
 */
export function aiMeta(): AIMeta | undefined {
  return dashboardMeta()?.ai;
}

/**
 * The described collection a proposal's route addresses, `undefined` for an app route.
 * Reactive.
 */
export function collectionOfRoute(route: string): DashboardCollection | undefined {
  const segment = COLLECTION_ROUTE.exec(parseRouteID(route).path)?.[1];
  if (isUndefined(segment)) return undefined;
  return dashboardMeta()?.collections.find((collection) => collection.segment === segment);
}
