import type { Message } from '../messages/known-messages.ts';
import type { SkillName } from '../skills/known-skills.ts';
import type { Prompt } from '../skills/prompt.ts';
import type { AIModelName } from './known-ai-models.ts';

import { validateFlowDefinition } from './validate-flow.ts';

/**
 * A flow definition: a fixed path the assistant follows for one kind of question.
 * A decide node asks a model about the typed question and picks the next node.
 * An act node runs the assistant on a skill or a prompt.
 * The flow's name comes from its file under `dirs.flows`.
 * A node id misspelled in `start` or in any `next` is a type error.
 */
export interface FlowDefinition<N extends string = string> {
  /**
   * A short label for the flow, shown where the palette lists flows.
   * Pass a message key to translate it per the viewer's language.
   * A `{ key, params }` object supplies a parameterized message; a plain string is shown as-is.
   * Omitted, the flow name is sentence-cased: `raid-officer` becomes `Raid officer`.
   * Started without a question, the flow takes its title as the question.
   *
   * @example
   * ```ts
   * 'Raid officer'
   * 'app.flows.raidOfficer.title'
   * ```
   */
  title?: Message;

  /**
   * What the flow does, in a sentence.
   * Resolves like `title`.
   *
   * @example
   * ```ts
   * 'Routes a request to translation or the roster.'
   * 'app.flows.raidOfficer.description'
   * ```
   */
  description: Message;

  /**
   * The id of the node the flow begins at, a key of `nodes`.
   *
   * @example
   * ```ts
   * 'triage'
   * ```
   */
  start: NoInfer<N>;

  /**
   * The steps of the flow, by id.
   * Each holds either `decide`, to pick where to go, or `act`, to run the assistant.
   * Every node must be reachable from `start`.
   *
   * @example
   * ```ts
   * {
   *   triage: {
   *     decide: { questions: { members: { yesNo: 'Is it about guild members?' } } },
   *     next: { on: 'members', cases: { yes: 'roster', no: 'general' } },
   *   },
   *   roster: { act: { prompt: 'Answer from Characters.', tiers: ['read'] } },
   *   general: { act: {} },
   * }
   * ```
   */
  nodes: Record<N, FlowNode<NoInfer<N>>>;
}

/**
 * One node of a flow: `decide` picks where to go, `act` runs the assistant.
 */
export type FlowNode<N extends string = string> = FlowDecideNode<N> | FlowActNode<N>;

/**
 * A node that picks where the flow goes next.
 * A model answers one question about the message the person typed, and `next` routes on the answer.
 * It sees only that message, never record data or what earlier nodes did.
 * It shows the person nothing.
 */
export interface FlowDecideNode<N extends string = string> {
  /**
   * The question to ask, and the model that answers it.
   *
   * @example
   * ```ts
   * { model: 'router', questions: { urgent: { yesNo: 'Is it urgent?' } } }
   * ```
   */
  decide: FlowDecide;

  /**
   * Where the flow goes for each answer to the node's question.
   *
   * @example
   * ```ts
   * {
   *   on: 'intent',
   *   cases: { translate: 'translate', roster: 'roster' },
   *   below: { confidence: 0.6, to: 'general' },
   * }
   * ```
   */
  next: FlowBranch<N>;
}

/**
 * A node that does the work: it runs the assistant on a skill or a prompt.
 * The assistant answers in the palette and proposes requests the person approves, as in any chat.
 * The node is done when the assistant answers without proposing more.
 */
export interface FlowActNode<N extends string = string> {
  /**
   * What the assistant does in this node, and within which limits.
   *
   * @example
   * ```ts
   * { skill: 'translate-items', tiers: ['read', 'write'] }
   * ```
   */
  act: FlowAct;

  /**
   * The node or nodes to run once this one is done.
   * On the same model, they see what this node said and did.
   * Omitted, this path ends here, and the flow ends once no node is left to run.
   *
   * @example
   * ```ts
   * 'recap'
   * ['history', 'loot']
   * ```
   */
  next?: FlowTarget<N>;
}

/**
 * The question a decide node asks, and the model that answers it.
 */
export interface FlowDecide {
  /**
   * The model that answers, an `ai.models` entry.
   * A `jev` entry may answer here, though never in an act node.
   * Omitted, `ai.decide` answers, else the model the person picked, else `ai.model`.
   *
   * @example
   * ```ts
   * 'router'
   * ```
   */
  model?: AIModelName;

  /**
   * The question to ask, by the name `next` routes `on`.
   * A question `next` does not route on is refused, since it would be asked and charged for nothing.
   *
   * @example
   * ```ts
   * {
   *   intent: {
   *     choice: { translate: 'Translate records.', roster: 'Ask about members.' },
   *   },
   * }
   * ```
   */
  questions: Record<string, FlowQuestion>;
}

/**
 * One question of a decide node.
 * Its options are the answers a branch's `cases` key on.
 *
 * - `choice` maps each option to a sentence the model judges the message against.
 * - `score` lists ordered levels, lowest first, from two to ten distinct names.
 * - `yesNo` is the question itself, answered `yes` or `no`.
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
 * A `skill` gives the assistant its instructions, and a `prompt` beside it adds to them.
 * With neither, the node runs the plain assistant on the person's message.
 */
export interface FlowAct {
  /**
   * The skill whose instructions the assistant follows in this node.
   * A person who may not run it does not see the flow at all.
   *
   * @example
   * ```ts
   * 'translate-items'
   * ```
   */
  skill?: SkillName;

  /**
   * The instructions the assistant follows in this node: one text, or a list of lines.
   *
   * @example
   * ```ts
   * 'Answer from Characters.'
   * ['Answer from Characters.', 'Name each character with their level.']
   * ```
   */
  prompt?: Prompt;

  /**
   * The model the node runs on, an `ai.models` entry other than `jev`.
   * Omitted, the node runs on the model the person picked, else `ai.model`.
   * On another model than the node before, it starts over from the typed message, without earlier work.
   *
   * @example
   * ```ts
   * 'fast'
   * ```
   */
  model?: AIModelName;

  /**
   * The tiers of the requests the node may propose, as `ai.routes` gives each route one.
   * Only routes of these tiers are offered, so `['read']` can never write and `[]` proposes nothing.
   * Omitted, every tier is open.
   *
   * @example
   * ```ts
   * ['read']
   * ['read', 'write']
   * ```
   */
  tiers?: FlowTier[];
}

/**
 * The tier `ai.routes` gives a route.
 * `read` runs at once, `write` asks unless auto-accept covers it, and `destructive` asks with a second click.
 */
export type FlowTier = 'read' | 'write' | 'destructive';

/**
 * The node or nodes an edge leads to.
 * A list runs its nodes in order, each finishing its own `next` chain before the next one starts.
 *
 * @example
 * ```ts
 * 'recap'
 * ['history', 'loot']
 * ```
 */
export type FlowTarget<N extends string = string> = N | N[];

/**
 * Where a decide node goes, by the answer to its question.
 * An answer without a case ends this path, and the flow goes on with any node still waiting to run.
 *
 * @example
 * ```ts
 * {
 *   on: 'intent',
 *   cases: { translate: 'translate', roster: 'roster' },
 *   below: { confidence: 0.6, to: 'general' },
 * }
 * ```
 */
export interface FlowBranch<N extends string = string> {
  /**
   * The name of the node's question, its key in `questions`.
   *
   * @example
   * ```ts
   * 'intent'
   * ```
   */
  on: string;

  /**
   * The node or nodes to go to for each answer.
   * Each key is an option of the question: a `choice` key, a `score` level, or `yes` and `no`.
   *
   * @example
   * ```ts
   * { translate: 'translate', roster: 'roster' }
   * { yes: 'translate', no: 'general' }
   * ```
   */
  cases: Record<string, FlowTarget<N>>;

  /**
   * Where to go when the model is unsure, whatever it answered.
   * An answer with a confidence under `confidence` goes to `to`, and `cases` is skipped.
   * Omitted, every answer routes by `cases`.
   *
   * @example
   * ```ts
   * { confidence: 0.6, to: 'general' }
   * ```
   */
  below?: {
    /**
     * The threshold, from `0` to `1`.
     * For `yesNo`, `0.6` catches every answer with a `yes` probability between 0.2 and 0.8.
     *
     * @example
     * ```ts
     * 0.6
     * ```
     */
    confidence: number;

    /**
     * The node or nodes to go to.
     *
     * @example
     * ```ts
     * 'general'
     * ```
     */
    to: FlowTarget<N>;
  };
}

/**
 * Defines a flow: a fixed path the assistant follows for one kind of question.
 * Default-export the result from a file under a layer's `dirs.flows`.
 * The file names the flow in kebab-case: `flows/raid-officer.ts` becomes `raid-officer`.
 * A person starts it from the palette: `/raid-officer Who is level 60?`.
 *
 * - `title` names the flow in the palette, and `description` says what it does.
 * - `nodes` holds the steps by id, and `start` names the first.
 * - A `decide` node asks a model one question about the typed message, and shows the person nothing.
 * - Its `next` routes `on` the answer through `cases`, or to `below.to` when the model is unsure.
 * - An `act` node runs the assistant on a `skill` or a `prompt`, on its `model`, within its `tiers`.
 * - Its `next` runs once it is done, and a list of ids runs one after another.
 * - The flow ends when no node is left to run.
 *
 * An edge naming no node, a question `next` does not route on, or an unreachable node throws.
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
 *       next: {
 *         on: 'intent',
 *         cases: { translate: 'translate', roster: 'roster' },
 *         below: { confidence: 0.6, to: 'general' },
 *       },
 *     },
 *     translate: { act: { skill: 'translate-items' } },
 *     roster: { act: { prompt: 'Answer from the roster.', tiers: ['read'] } },
 *     general: { act: {} },
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
