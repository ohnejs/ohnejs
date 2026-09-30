import type { FlowAct, FlowBranch, FlowDefinition, FlowMeta, FlowTarget } from 'ohnejs';
import type { User } from 'ohnejs/auth';

import { ohneError, useFlows } from 'ohnejs';
import { hasKey, isArray, isEmpty, isString, isUndefined, uniqueArray } from 'ohnejs/utils';

import type { DecideAnswer, Decision, Provider } from '../providers/provider.ts';
import type { FlowState, Turn } from '../turns/state.ts';

import { addUsage, estimatedUsage } from '../providers/provider.ts';
import { useProvider } from '../providers/use-provider.ts';
import { chargeTokens, tokenWait } from '../turns/limits.ts';
import { nodeMessage } from '../turns/prompt.ts';
import { usableSkill } from '../turns/skills.ts';
import { saveTurn } from '../turns/state.ts';
import { decideModel, useDecider } from './decide.ts';

/**
 * The model a turn's transcript is in, with the provider that speaks it.
 */
export interface Running {
  /**
   * The `ai.models` entry.
   */
  model: string;

  /**
   * Its provider.
   */
  provider: Provider;
}

/**
 * Where a flow turn's walk got to.
 *
 * - `node`: an act node runs next, entered with its message on the transcript and what it runs on.
 * - `ended`: the walk is over; no node is left to run.
 * - `limit`: the person's token budget ran out before a decide node could answer.
 */
export type Entered =
  | ({ status: 'node'; id: string; act: FlowAct } & Running)
  | { status: 'ended' }
  | { status: 'limit' };

/**
 * The flows `user` may start: those whose every act node's skill is theirs to run.
 * A flow is one unit, so one node's skill out of reach keeps the whole flow out of the palette.
 *
 * @example
 * ```ts
 * startableFlows(officer).map(({ name }) => name) // -> ['raid-officer']
 * ```
 */
export function startableFlows(user: User): FlowMeta[] {
  return Object.values(useFlows().all()).filter(({ flow }) =>
    Object.values(flow.nodes).every(
      (node) =>
        !('act' in node) ||
        isUndefined(node.act.skill) ||
        !isUndefined(usableSkill(user, node.act.skill)),
    ),
  );
}

/**
 * The `ai.models` entries `flow` runs on: each node's own, and the defaults for the nodes naming none.
 * An act node without a model runs on `model`; a decide node on `decide`, else `model`.
 *
 * @example
 * ```ts
 * flowModels(raidOfficer, 'smart') // -> ['router', 'smart', 'fast']
 * ```
 */
export function flowModels(flow: FlowDefinition, model: string): string[] {
  const names = Object.values(flow.nodes).map((node) =>
    'act' in node ? (node.act.model ?? model) : decideModel(node.decide, model),
  );
  return uniqueArray(names);
}

/**
 * The nodes a decide node's branch leads to for `answers`, in order; none ends that path.
 * It takes `below.to` when the answer's confidence falls under the threshold, else the answer's case.
 *
 * @example
 * ```ts
 * routeAnswers(
 *   { on: 'intent', cases: { translate: 'translate' }, below: { confidence: 0.6, to: 'general' } },
 *   { intent: { answer: 'translate', confidence: 0.4 } },
 * )
 * // -> ['general']
 * ```
 */
export function routeAnswers(next: FlowBranch, answers: Record<string, DecideAnswer>): string[] {
  const answer = answers[next.on];
  if (!isUndefined(next.below) && answer.confidence < next.below.confidence) {
    return targetsOf(next.below.to);
  }
  return hasKey(next.cases, answer.answer) ? targetsOf(next.cases[answer.answer]) : [];
}

/**
 * Queues the nodes the act node `id` leads to once it is done, so the next `enterNode` walks them first.
 * Its `next` comes before whatever the queue holds, so a chain of nodes completes before a sibling runs.
 */
export function leaveNode(flow: FlowState, id: string): void {
  const node = flowDefinition(flow.name).nodes[id];
  const next = 'act' in node ? node.next : undefined;
  flow.node = null;
  flow.queue = [...(isUndefined(next) ? [] : targetsOf(next)), ...flow.queue];
}

/**
 * Enters the act node of the flow turn that runs next, deciding its way there through the queue.
 * Each decide node on the way is answered by its model about the typed message alone, charged, and routed.
 * The decisions of one walk share `deadline`; one that fails is charged its estimated input all the same.
 * The walk state is written back after each decision, so a crash loses at most one.
 * The node's message joins the transcript: its fence, and the typed message when the transcript is empty.
 * `running` is the provider the stream holds, reused when the node runs on its model.
 * A node on another model than the transcript's starts the transcript over on that model's provider.
 * Valid only within a request.
 */
export async function enterNode(
  turn: Turn,
  user: User,
  running: Running,
  deadline: AbortSignal,
): Promise<Entered> {
  const flow = turn.flow as FlowState;
  const definition = flowDefinition(flow.name);
  for (;;) {
    const id = flow.queue.shift();
    if (isUndefined(id)) {
      flow.node = null;
      return { status: 'ended' };
    }
    const node = definition.nodes[id];
    if ('act' in node) {
      const model = node.act.model ?? turn.model;
      const provider = model === running.model ? running.provider : useProvider(model);
      if (model !== flow.model) turn.transcript = [];
      flow.node = id;
      flow.model = model;
      const message = nodeMessage(
        flow.name,
        id,
        node.act,
        isEmpty(turn.transcript) ? flow.input : undefined,
      );
      turn.transcript = [...turn.transcript, ...provider.transcript.user(message)];
      return { status: 'node', id, act: node.act, model, provider };
    }
    if ((await tokenWait(user)) > 0) {
      flow.queue.unshift(id);
      return { status: 'limit' };
    }
    const request = { input: flow.input, questions: node.decide.questions };
    let decision: Decision;
    try {
      decision = await useDecider(decideModel(node.decide, turn.model)).decide(request, deadline);
    } catch (error) {
      await chargeTokens(user, estimatedUsage(request));
      throw error;
    }
    await chargeTokens(user, decision.usage);
    turn.usage = addUsage(turn.usage, decision.usage);
    flow.queue.unshift(...routeAnswers(node.next, decision.answers));
    if (!(await saveTurn(turn, turn.step))) {
      throw ohneError(`Turn \`${turn.UUID}\` moved past step ${turn.step}`);
    }
  }
}

/**
 * The registered definition of the flow `name`; one no longer registered throws.
 */
function flowDefinition(name: string): FlowDefinition {
  const meta = useFlows().get(name);
  if (isUndefined(meta)) throw ohneError(`Unknown flow \`${name}\``);
  return meta.flow;
}

/**
 * A target as the list of node ids it names.
 */
function targetsOf(target: FlowTarget): string[] {
  return isArray(target) ? [...target] : isString(target) ? [target] : [];
}
