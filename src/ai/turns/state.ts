import { conflict, type HTTPError, queryUntyped, useFlows } from 'ohnejs';
import { isEmpty, isNull, isUndefined, parseDuration } from 'ohnejs/utils';

import type { AITier } from '../config.ts';
import type { TranscriptItem, Usage } from '../providers/provider.ts';
import type { Proposal } from './proposals.ts';
import type { BatchResult, Receipt } from './receipts.ts';
import type { OfferedRoute } from './surface.ts';

import { translate } from '../../ohne/http/translate.ts';
import { useAIConfig } from '../config.ts';

/**
 * Every way a turn closes, as its row's `reason` keeps it.
 * - `end`, `length`, `refusal`: the model ended, was cut off at its output limit, or refused.
 * - `steps`: the turn reached `ai.limits.steps`.
 * - `limit`: the person's token budget ran out between the steps of one stream.
 * - `timeout`, `provider`, `internal`: a step failed, with the code the browser was sent.
 * - `left`: the browser left while a step ran.
 * - `idle`: its batch waited past `ai.limits.turnTimeout`.
 * - `lost`: its step stopped with the process running it, and never wrote back.
 */
export const CLOSE_REASONS = [
  'end',
  'length',
  'refusal',
  'steps',
  'limit',
  'timeout',
  'provider',
  'internal',
  'left',
  'idle',
  'lost',
] as const;

/**
 * One way a turn closes, a member of `CLOSE_REASONS`.
 */
export type CloseReason = (typeof CLOSE_REASONS)[number];

/**
 * One call the model made in a step, with what answers it.
 * A `request` call holds one receipt per proposal, `null` while the browser has not reported it.
 * Any other call holds its answer as `content`.
 */
export interface BatchCall {
  /**
   * The provider's id of the call.
   */
  id: string;

  /**
   * The tool the model named.
   */
  name: string;

  /**
   * The receipts of a `request` call, in proposal order; `null` awaits the browser.
   */
  receipts?: (Receipt | null)[];

  /**
   * The answer of a `describe` or `skill` call, or the error text of a call the server could not take.
   */
  content?: string;

  /**
   * Marks `content` as an error, on a provider that tells them apart.
   */
  error?: true;
}

/**
 * One accepted proposal as the batch keeps it: where its receipt goes, and what shaping it needs.
 */
export interface BatchProposal {
  /**
   * The index of its `request` call in the batch's `calls`.
   */
  call: number;

  /**
   * Its position among that call's receipts.
   */
  index: number;

  /**
   * The route it names, the parts a receipt is shaped by.
   */
  route: Pick<OfferedRoute, 'method' | 'pattern' | 'body' | 'collection'>;

  /**
   * The proposal as the browser received it.
   */
  proposal: Proposal;

  /**
   * Whether its filter passed the identity rule, so its receipt may list ids.
   */
  identity: boolean;
}

/**
 * The calls of one step and the proposals the browser answers for them.
 * A batch without `reported` is pending; only the last batch can be.
 */
export interface TurnBatch {
  /**
   * The id the browser reports results under.
   */
  id: string;

  /**
   * The step that produced it, one-based.
   */
  step: number;

  /**
   * The highest tier among its proposals, `read` when it has none.
   */
  kind: AITier;

  /**
   * The model's calls, in order.
   */
  calls: BatchCall[];

  /**
   * The accepted proposals, in the order the browser sends them.
   */
  proposals: BatchProposal[];

  /**
   * What the browser reported per proposal, bodies left out; it is the browser's claim, never checked.
   */
  reported?: BatchResult[];
}

/**
 * Where a flow turn stands in its walk.
 */
export interface FlowState {
  /**
   * The flow's name.
   */
  name: string;

  /**
   * What the person typed, which every decide node judges.
   */
  input: string;

  /**
   * The act node running, or `null` before the first one and once the walk is over.
   */
  node: string | null;

  /**
   * The `ai.models` entry the transcript is in: the turn's own until an act node runs on another.
   * It outlives the walk, so a follow-up knows which model the transcript belongs to.
   */
  model: string;

  /**
   * The nodes still to walk, in order; a decide node among them is answered on the way.
   */
  queue: string[];
}

/**
 * One turn as its `AITurns` row keeps it, its JSON columns parsed.
 */
export interface Turn {
  /**
   * The row's id, which the browser continues the turn by.
   */
  UUID: string;

  /**
   * The `UUID` of the person who asked.
   */
  user: string;

  /**
   * The `ai.models` entry the turn plans with.
   */
  model: string;

  /**
   * The dashboard route pattern the person asked from.
   */
  page: string;

  /**
   * The flow the turn walks, or `null` for a plain turn.
   */
  flow: FlowState | null;

  /**
   * The conversation so far, in the provider's shape; it only ever grows.
   * A flow node on another model starts it over, since a transcript is bound to its model.
   */
  transcript: TranscriptItem[];

  /**
   * The batches of every step so far.
   */
  batches: TurnBatch[];

  /**
   * How many steps have run.
   */
  step: number;

  /**
   * The tokens the turn has spent.
   */
  usage: Usage;

  /**
   * When the turn closed, or `null` while it is open.
   */
  closedAt: number | null;

  /**
   * Why the turn closed, or `null` while it is open.
   */
  reason: CloseReason | null;

  /**
   * When the row was last written, in epoch milliseconds.
   */
  updatedAt: number;
}

/**
 * What `openTurn` takes.
 */
export interface TurnInit {
  /**
   * The `UUID` of the person who asked.
   */
  user: string;

  /**
   * The `ai.models` entry the turn plans with.
   */
  model: string;

  /**
   * The dashboard route pattern the person asked from.
   */
  page: string;

  /**
   * The person's first message, in the provider's shape; empty for a flow, whose first node writes it.
   */
  transcript: TranscriptItem[];

  /**
   * The flow the turn walks, its queue holding the start node.
   */
  flow?: FlowState;
}

/**
 * Creates the row of a new turn, its first step claimed, and returns it.
 */
export async function openTurn(init: TurnInit): Promise<Turn> {
  const record = await queryUntyped('AITurns')
    .unscoped()
    .createOrThrow({
      user: init.user,
      model: init.model,
      page: init.page,
      flow: isUndefined(init.flow) ? null : JSON.stringify(init.flow),
      transcript: JSON.stringify(init.transcript),
      step: 1,
    });
  return fromRow(record);
}

/**
 * The `ai.models` entry the turn's transcript is in: the last act node's model in a flow, else its own.
 *
 * @example
 * ```ts
 * activeModel(turn) // -> 'fast' once the node `roster` with `model: 'fast'` ran
 * ```
 */
export function activeModel(turn: Turn): string {
  return turn.flow?.model ?? turn.model;
}

/**
 * The `model` the turn's running act node names, or `undefined` when no node runs or it names none.
 *
 * @example
 * ```ts
 * nodeModel(turn) // -> 'fast' while the node `roster` with `model: 'fast'` runs
 * nodeModel(turn) // -> undefined while the node `general` with `act: {}` runs
 * ```
 */
export function nodeModel(turn: Turn): string | undefined {
  const { flow } = turn;
  if (isNull(flow) || isNull(flow.node)) return undefined;
  const node = useFlows().get(flow.name)?.flow.nodes[flow.node];
  return isUndefined(node) || !('act' in node) ? undefined : node.act.model;
}

/**
 * Claims the turn's next step: counts it and writes the turn back, while the row sits at the step before.
 * Returns `false` when another results post claimed it first, so two never both run.
 */
export async function claimStep(turn: Turn): Promise<boolean> {
  turn.step += 1;
  if (await saveTurn(turn, turn.step - 1)) return true;
  turn.step -= 1;
  return false;
}

/**
 * Reads the turn `id`, or `undefined` when no row has it.
 */
export async function loadTurn(id: string): Promise<Turn | undefined> {
  const record = await queryUntyped('AITurns').unscoped().where({ UUID: id }).findFirst();
  return isUndefined(record) ? undefined : fromRow(record);
}

/**
 * Writes the turn's state back, only while the row is open and still sits at `step`.
 * Returns `false` when another write got there first.
 */
export async function saveTurn(turn: Turn, step: number): Promise<boolean> {
  const records = await queryUntyped('AITurns')
    .unscoped()
    .where({ UUID: turn.UUID, step, closedAt: { isNull: true } })
    .updateOrThrow({
      flow: isNull(turn.flow) ? null : JSON.stringify(turn.flow),
      transcript: JSON.stringify(turn.transcript),
      batches: JSON.stringify(turn.batches),
      step: turn.step,
      usage: JSON.stringify(turn.usage),
      closedAt: turn.closedAt,
      reason: turn.reason,
    });
  if (records.length === 0) return false;
  turn.updatedAt = records[0]._updatedAt as number;
  return true;
}

/**
 * Marks the open `turn` as written now, so its idle time starts over; a closed one is left as it is.
 * A transform touches the turn, since the person is not idle while it runs.
 */
export async function touchTurn(turn: Turn): Promise<void> {
  const records = await queryUntyped('AITurns')
    .unscoped()
    .where({ UUID: turn.UUID, closedAt: { isNull: true } })
    .updateOrThrow({});
  if (isEmpty(records)) return;
  turn.updatedAt = records[0]._updatedAt as number;
}

/**
 * Closes the turn now for `reason`, whatever step its row sits at.
 * A row already closed keeps its first close; the turn then takes that one.
 */
export async function closeTurn(turn: Turn, reason: CloseReason): Promise<void> {
  const records = await queryUntyped('AITurns')
    .unscoped()
    .where({ UUID: turn.UUID, closedAt: { isNull: true } })
    .updateOrThrow({ closedAt: Date.now(), reason });
  const row =
    records[0] ?? (await queryUntyped('AITurns').unscoped().where({ UUID: turn.UUID }).findFirst());
  if (isUndefined(row)) return;
  turn.closedAt = row.closedAt as number;
  turn.reason = row.reason as CloseReason;
  turn.updatedAt = row._updatedAt as number;
}

/**
 * Closes the open `turn` when it can no longer continue, and returns whether it did.
 * One whose batch waited past `ai.limits.turnTimeout` closes as `idle`.
 * One with no batch waiting is running a step.
 * Unwritten for twice `ai.limits.step`, that step died with its process, so the turn closes as `lost`.
 * The deadline bounds only the provider call; the second one is room for the work around it.
 */
export async function expireTurn(turn: Turn): Promise<boolean> {
  const { limits } = useAIConfig();
  const last = turn.batches.at(-1);
  const stepping = isUndefined(last) || !isUndefined(last.reported);
  const quiet = stepping ? parseDuration(limits.step) * 2 : parseDuration(limits.turnTimeout);
  if (Date.now() - turn.updatedAt <= quiet) return false;
  await closeTurn(turn, stepping ? 'lost' : 'idle');
  return true;
}

/**
 * The `409` for a turn a results post or a follow-up cannot continue.
 * The turn is unknown, someone else's, idle or lost.
 * A results post also answers it for a closed turn, a follow-up for an open one.
 */
export function turnGone(): HTTPError {
  return conflict(translate('ai.api.turnGone'), { code: 'turnGone' });
}

/**
 * The `409` a results post gets for a batch that already has its results.
 */
export function batchReported(): HTTPError {
  return conflict(translate('ai.api.batchReported'), { code: 'batchReported' });
}

/**
 * The `409` a results post gets for a batch id the turn never produced.
 */
export function unknownBatch(batch: string): HTTPError {
  return conflict(translate('ai.api.unknownBatch', { batch }), { code: 'unknownBatch' });
}

/**
 * A turn from its row, the JSON columns parsed.
 */
function fromRow(record: Record<string, unknown>): Turn {
  return {
    UUID: record.UUID as string,
    user: record.user as string,
    model: record.model as string,
    page: record.page as string,
    flow: isNull(record.flow) ? null : (JSON.parse(record.flow as string) as FlowState),
    transcript: JSON.parse(record.transcript as string) as TranscriptItem[],
    batches: JSON.parse(record.batches as string) as TurnBatch[],
    step: record.step as number,
    usage: JSON.parse(record.usage as string) as Usage,
    closedAt: record.closedAt as number | null,
    reason: record.reason as CloseReason | null,
    updatedAt: record._updatedAt as number,
  };
}
