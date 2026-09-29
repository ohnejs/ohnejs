import { conflict, type HTTPError, queryUntyped } from 'ohnejs';
import { isUndefined } from 'ohnejs/utils';

import type { AITier } from '../config.ts';
import type { TranscriptItem, Usage } from '../providers/provider.ts';
import type { Proposal } from './proposals.ts';
import type { BatchResult, Receipt } from './receipts.ts';
import type { OfferedRoute } from './surface.ts';

import { translate } from '../../ohne/http/translate.ts';

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
   * The conversation so far, in the provider's shape; it only ever grows.
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
   * The person's first message, in the provider's shape.
   */
  transcript: TranscriptItem[];
}

/**
 * Creates the row of a new turn, its first step claimed, and returns it.
 */
export async function openTurn(init: TurnInit): Promise<Turn> {
  const record = await queryUntyped('AITurns').createOrThrow({
    user: init.user,
    model: init.model,
    page: init.page,
    transcript: JSON.stringify(init.transcript),
    step: 1,
  });
  return fromRow(record);
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
  const record = await queryUntyped('AITurns').where({ UUID: id }).findFirst();
  return isUndefined(record) ? undefined : fromRow(record);
}

/**
 * Writes the turn's state back, only while the row still sits at `step`.
 * Returns `false` when another write got there first.
 */
export async function saveTurn(turn: Turn, step: number): Promise<boolean> {
  const records = await queryUntyped('AITurns')
    .where({ UUID: turn.UUID, step })
    .updateOrThrow({
      transcript: JSON.stringify(turn.transcript),
      batches: JSON.stringify(turn.batches),
      step: turn.step,
      usage: JSON.stringify(turn.usage),
      closedAt: turn.closedAt,
    });
  if (records.length === 0) return false;
  turn.updatedAt = records[0]._updatedAt as number;
  return true;
}

/**
 * Closes the turn now, whatever step its row sits at.
 */
export async function closeTurn(turn: Turn): Promise<void> {
  turn.closedAt = Date.now();
  await queryUntyped('AITurns')
    .where({ UUID: turn.UUID })
    .updateOrThrow({ closedAt: turn.closedAt });
}

/**
 * The `409` a results post gets for a turn that is closed, unknown, or someone else's.
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
    transcript: JSON.parse(record.transcript as string) as TranscriptItem[],
    batches: JSON.parse(record.batches as string) as TurnBatch[],
    step: record.step as number,
    usage: JSON.parse(record.usage as string) as Usage,
    closedAt: record.closedAt as number | null,
    updatedAt: record._updatedAt as number,
  };
}
