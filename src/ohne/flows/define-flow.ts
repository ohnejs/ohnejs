import type { Message } from '../messages/known-messages.ts';
import type { SkillName } from '../skills/known-skills.ts';

import { validateFlowDefinition } from './validate-flow.ts';

/**
 * A flow definition: a graph of nodes the assistant walks from `start`, deciding and acting on the way.
 * The flow name is not declared here; it comes from the file under `dirs.flows`.
 * `N` is the union of node ids, inferred from the keys of `nodes`, so every edge typechecks.
 */
export interface FlowDefinition<N extends string = string> {
  /**
   * A short label for the flow, shown where the dashboard lists flows.
   * Pass a message key to translate it per the viewer's language.
   * A `{ key, params }` object supplies a parameterized message; a plain string is shown as-is.
   * Omitted, the flow name is sentence-cased: `raid-officer` becomes `Raid officer`.
   *
   * @example
   * ```ts
   * title: 'Raid officer'
   * title: 'app.flows.raidOfficer.title'
   * ```
   */
  title?: Message;

  /**
   * What the flow does, in a sentence.
   * The dashboard shows it beside the title.
   * Resolves like `title`.
   *
   * @example
   * ```ts
   * description: 'Routes a request to translation or the roster.'
   * description: 'app.flows.raidOfficer.description'
   * ```
   */
  description: Message;

  /**
   * The id of the node the walk starts at.
   */
  start: NoInfer<N>;

  /**
   * The nodes by id.
   * Every node is reachable from `start`.
   */
  nodes: Record<N, FlowNode<NoInfer<N>>>;
}

/**
 * One node of a flow: it either decides where to go or acts.
 */
export type FlowNode<N extends string = string> = FlowDecideNode<N> | FlowActNode<N>;

/**
 * A node that asks a model its questions, then routes on the answers.
 */
export interface FlowDecideNode<N extends string = string> {
  /**
   * The questions to answer, and the model that answers them.
   */
  decide: FlowDecide;

  /**
   * Where the walk goes once the questions are answered.
   */
  next: FlowNext<N>;
}

/**
 * A node that runs the assistant on a skill or a prompt.
 */
export interface FlowActNode<N extends string = string> {
  /**
   * What the assistant runs, and within which limits.
   */
  act: FlowAct;

  /**
   * The node or nodes the walk continues at once the node is done.
   * Omitted, the flow ends here.
   */
  next?: FlowTarget<N>;
}

/**
 * The questions a decide node asks.
 */
export interface FlowDecide {
  /**
   * The model that answers.
   * Omitted, the assistant's own decide model answers.
   */
  model?: string;

  /**
   * The questions by name; `next` routes `on` one of them.
   */
  questions: Record<string, FlowQuestion>;
}

/**
 * One question of a decide node.
 * Its options are what a branch's `cases` key on.
 *
 * - `choice` picks one option, each described in a sentence the model reads.
 * - `score` picks one of its ordered levels, lowest first, between two and ten of them.
 * - `yesNo` answers the question it asks with `yes` or `no`.
 *
 * @example
 * ```ts
 * { choice: { translate: 'Translate text.', roster: 'Ask about members.' } }
 * { score: ['low', 'medium', 'high'] }
 * { yesNo: 'Does the request name a locale?' }
 * ```
 */
export type FlowQuestion =
  | { choice: Record<string, string> }
  | { score: string[] }
  | { yesNo: string };

/**
 * What an act node runs.
 * A `prompt` beside a `skill` adds to its instructions; neither runs the assistant as it is.
 */
export interface FlowAct {
  /**
   * The skill the assistant runs.
   */
  skill?: SkillName;

  /**
   * The instructions the assistant follows, as plain text.
   */
  prompt?: string;

  /**
   * The model the node runs on.
   * Omitted, the turn's model runs it.
   */
  model?: string;

  /**
   * The request tiers the node may propose.
   * Omitted, every tier the assistant reaches is open.
   */
  tiers?: FlowTier[];
}

/**
 * How far a proposed request reaches: reading, writing, or destroying.
 */
export type FlowTier = 'read' | 'write' | 'destructive';

/**
 * The node or nodes an edge leads to.
 * One node id continues there; a list of ids runs them in parallel.
 */
export type FlowTarget<N extends string = string> = N | N[];

/**
 * Where a decide node's walk goes next: a `FlowTarget` whatever the answers, or a `FlowBranch` on one.
 */
export type FlowNext<N extends string = string> = FlowTarget<N> | FlowBranch<N>;

/**
 * Routes on the answer to one question of the decide node.
 * An answer without a case ends the flow.
 *
 * @example
 * ```ts
 * next: {
 *   on: 'intent',
 *   cases: { translate: 'translate', roster: 'roster' },
 *   below: { confidence: 0.6, to: 'ask' },
 * }
 * ```
 */
export interface FlowBranch<N extends string = string> {
  /**
   * The name of the question to route on.
   */
  on: string;

  /**
   * The node or nodes to continue at, by the question's options.
   * A `yesNo` question's options are `yes` and `no`.
   */
  cases: Record<string, FlowTarget<N>>;

  /**
   * Where the walk goes when the answer's confidence falls below the threshold, whatever the answer.
   * Omitted, every answer routes by `cases`.
   */
  below?: {
    /**
     * The threshold, between `0` and `1`.
     */
    confidence: number;

    /**
     * The node or nodes to continue at.
     */
    to: FlowTarget<N>;
  };
}

/**
 * Defines a flow.
 *
 * Default-export the result from a file under a layer's `dirs.flows`.
 * The file names the flow in kebab-case: `flows/raid-officer.ts` becomes `raid-officer`.
 * An edge naming no node, a case for an option its question lacks, or an unreachable node throws.
 *
 * @example
 * ```ts
 * // flows/raid-officer.ts
 * import { defineFlow } from 'ohnejs'
 *
 * export default defineFlow({
 *   description: 'Routes a request to translation or the roster.',
 *   start: 'triage',
 *   nodes: {
 *     triage: {
 *       decide: {
 *         questions: {
 *           intent: { choice: { translate: 'Translate text.', roster: 'Ask about members.' } },
 *         },
 *       },
 *       next: { on: 'intent', cases: { translate: 'translate', roster: 'roster' } },
 *     },
 *     translate: { act: { skill: 'translate-items' } },
 *     roster: { act: { prompt: 'Answer from the roster.', tiers: ['read'] } },
 *   },
 * })
 * ```
 */
export function defineFlow<const N extends string>(
  definition: FlowDefinition<N>,
): FlowDefinition<N> {
  validateFlowDefinition(definition);
  return definition;
}
