import type { SearchParamValue, SSEMessage } from 'ohnejs/utils';

import {
  isArray,
  isNull,
  isNumber,
  isPlainObject,
  isString,
  isUndefined,
  type Ref,
  ref,
} from 'ohnejs/utils';

/**
 * A route's tier, which decides whether the browser asks before sending.
 */
export type AITier = 'read' | 'write' | 'destructive';

/**
 * One request the model proposed, as the `batch` event carries it.
 */
export interface Proposal {
  /**
   * The route id, its collection segment filled in: `PATCH /collections/items/[uuid]`.
   */
  route: string;

  /**
   * The route's tier.
   */
  tier: AITier;

  /**
   * The route's params, each checked by the server.
   */
  params?: Record<string, string>;

  /**
   * The URL params.
   */
  query?: Record<string, SearchParamValue>;

  /**
   * The JSON body.
   */
  body?: Record<string, unknown>;

  /**
   * The filter of a write by set, in place of `params`; the browser expands it into one request per record.
   */
  where?: Record<string, unknown>;

  /**
   * A rewrite of the update's text fields by a model, in place of `body`.
   * The browser runs it through `POST /ai/turns/[id]/transform` and sends each approved record as an update.
   */
  transform?: {
    /**
     * The fields to rewrite.
     */
    fields: string[];

    /**
     * What to do with each value.
     */
    instruction: string;
  };

  /**
   * Set by the server on a write the person's auto-accept covers, so it is sent without asking.
   */
  auto?: true;
}

/**
 * What the browser reports for one proposal: the answer it got, or the person's decline.
 */
export type BatchResult =
  | {
      /**
       * The answer's status; a write by set answers the status of its first failure, else `200`.
       * `0` when the connection dropped before the answer, so the request may have run.
       */
      status: number;

      /**
       * The answer's JSON body, cut to what the receipt reads.
       */
      body?: unknown;

      /**
       * Set when the request was sent without asking, as its proposal's `auto` allowed.
       */
      auto?: true;
    }
  | {
      /**
       * The person declined the proposal.
       */
      declined: true;

      /**
       * What the person said.
       */
      note?: string;
    };

/**
 * The proposals of one step and what the browser answered for them.
 */
export interface TurnBatch {
  /**
   * The id the results are posted under.
   */
  id: string;

  /**
   * The highest tier among the proposals; a `read` batch runs without asking.
   */
  kind: AITier;

  /**
   * The proposals, in the order they are sent.
   */
  proposals: Proposal[];

  /**
   * One result per proposal once the batch was sent, `null` while it waits.
   */
  results: BatchResult[] | null;

  /**
   * The model every transform of the batch runs on, when the flow node that proposed it names one.
   */
  pinned?: string;
}

/**
 * One model step: the text it streamed and the batch it ended in.
 */
export interface TurnStep {
  /**
   * The text streamed so far.
   */
  text: string;

  /**
   * The batch the step ended in, `null` while the step streams or when it ended in text.
   */
  batch: TurnBatch | null;
}

/**
 * Where a turn stands.
 *
 * - `streaming`: a step streams.
 * - `waiting`: the last step's batch awaits the person.
 * - `sending`: the browser sends the approved requests.
 * - `closed`: the turn ended; `reason` says how.
 * - `error`: the turn failed; `reason` names the code.
 */
export type TurnStatus = 'streaming' | 'waiting' | 'sending' | 'closed' | 'error';

/**
 * One turn as the palette shows it: the person's words and every step the model answered.
 * A turn is an immutable snapshot; every change replaces it in `turns`.
 */
export interface Turn {
  /**
   * What the person typed.
   */
  input: string;

  /**
   * The skill the turn started with, `null` for a plain question.
   */
  skill: string | null;

  /**
   * The flow the turn walks, `null` for a plain question.
   */
  flow: string | null;

  /**
   * The turn's id once the stream named it.
   */
  id: string | null;

  /**
   * Where the turn stands.
   */
  status: TurnStatus;

  /**
   * The steps so far, the last one live.
   */
  steps: TurnStep[];

  /**
   * How a closed turn ended, or the code of a failed one; `null` while it runs.
   */
  reason: string | null;

  /**
   * The milliseconds the provider waits before it reruns the step, `null` while it streams.
   */
  wait: number | null;
}

/**
 * How far the browser is through sending a batch.
 */
export interface SendProgress {
  /**
   * The requests sent so far.
   */
  sent: number;

  /**
   * The requests to send in all.
   */
  total: number;
}

/**
 * One read of a settled batch and the answer it got.
 */
export interface ReadOutcome {
  /**
   * The read as proposed.
   */
  proposal: Proposal;

  /**
   * What it answered.
   */
  result: { status: number; body?: unknown };
}

/**
 * How the writes of a settled batch went, counted per record a write by set reached.
 */
export interface WriteTally {
  /**
   * The write proposals of the batch.
   */
  proposals: number;

  /**
   * The records written.
   */
  sent: number;

  /**
   * The records a write failed on.
   */
  failed: number;

  /**
   * The records whose connection dropped before the answer, so they may have been written.
   */
  unknown: number;

  /**
   * The write proposals the person declined.
   */
  declined: number;
}

/**
 * What a settled batch did: the reads that ran, and the tally of its writes.
 */
export interface BatchOutcome {
  /**
   * The reads that ran, in order.
   */
  reads: ReadOutcome[];

  /**
   * The tally of the writes, `null` when the batch proposed none.
   */
  writes: WriteTally | null;
}

/**
 * The conversation, oldest turn first; the last turn is the live one.
 * Module state, so a shell remount or a page change loses nothing.
 * Reactive.
 */
export const turns: Ref<readonly Turn[]> = ref([]);

/**
 * Where the send of the current batch stands, `null` while nothing is sent.
 * Reactive.
 */
export const sending: Ref<SendProgress | null> = ref(null);

/**
 * What a turn starts with beside the person's words: a skill's instructions, or a flow to walk.
 */
export interface TurnStart {
  /**
   * The skill the turn starts with.
   */
  skill?: string;

  /**
   * The flow the turn walks.
   */
  flow?: string;
}

/**
 * Opens a turn for `input` and puts its first step up for streaming.
 */
export function openTurn(input: string, { skill, flow }: TurnStart = {}): void {
  turns.value = [
    ...turns.value,
    {
      input,
      skill: skill ?? null,
      flow: flow ?? null,
      id: null,
      status: 'streaming',
      steps: [emptyStep()],
      reason: null,
      wait: null,
    },
  ];
}

/**
 * The live turn, `undefined` before the first question.
 */
export function currentTurn(): Turn | undefined {
  return turns.value.at(-1);
}

/**
 * Whether the palette may ask again: no turn yet, or the live one closed or failed.
 */
export function turnSettled(): boolean {
  const status = currentTurn()?.status;
  return isUndefined(status) || status === 'closed' || status === 'error';
}

/**
 * The batch of the live turn that awaits the person, `undefined` while none does.
 */
export function pendingBatch(): TurnBatch | undefined {
  const turn = currentTurn();
  if (isUndefined(turn) || turn.status !== 'waiting') return undefined;
  const batch = turn.steps.at(-1)?.batch;
  return batch?.results === null ? batch : undefined;
}

/**
 * Whether `batch` runs without asking: every proposal a read, or a write the server tagged `auto`.
 *
 * @example
 * ```ts
 * runsUnasked({ id: 'b', kind: 'read', proposals: [read], results: null })
 * // -> true
 *
 * runsUnasked({ id: 'b', kind: 'write', proposals: [read, { ...rename, auto: true }], results: null })
 * // -> true
 *
 * runsUnasked({ id: 'b', kind: 'write', proposals: [read, rename], results: null })
 * // -> false
 * ```
 */
export function runsUnasked(batch: TurnBatch): boolean {
  return batch.proposals.every((proposal) => proposal.tier === 'read' || proposal.auto === true);
}

/**
 * Applies one event of a step's stream to the live turn.
 */
export function applyTurnEvent(message: SSEMessage): void {
  replaceCurrent((turn) => reduceTurn(turn, message));
}

/**
 * Puts a fresh step up for streaming on the live turn, once its batch was answered.
 */
export function nextStep(): void {
  replaceCurrent((turn) => ({
    ...turn,
    status: 'streaming',
    reason: null,
    wait: null,
    steps: [...turn.steps, emptyStep()],
  }));
}

/**
 * Records what the browser answered for the live turn's last batch.
 */
export function settleBatch(results: BatchResult[]): void {
  replaceCurrent((turn) =>
    withLastStep(turn, (step) =>
      step.batch === null ? step : { ...step, batch: { ...step.batch, results } },
    ),
  );
}

/**
 * Moves the live turn to `status`, with the `reason` a close or a failure carries.
 */
export function markTurn(status: TurnStatus, reason: string | null = null): void {
  replaceCurrent((turn) => ({ ...turn, status, reason, wait: null }));
}

/**
 * Forgets the conversation.
 */
export function clearTurns(): void {
  turns.value = [];
  sending.value = null;
}

/**
 * The turn after one event of its stream; an event the store does not read leaves it as it was.
 *
 * - `turn` names the id.
 * - `node` starts a step for a flow node, unless the last step is still empty.
 * - `text` appends to the last step and ends a retry wait.
 * - `retry` records the wait.
 * - `batch` puts the batch on the last step.
 * - `done` waits on a batch, else closes the turn with its reason.
 * - `error` fails the turn with its code.
 *
 * @example
 * ```ts
 * reduceTurn(turn, { event: 'text', data: '{"text":"Hello"}', id: '' }).steps[0].text
 * // -> 'Hello'
 * ```
 */
export function reduceTurn(turn: Turn, message: SSEMessage): Turn {
  const data = eventPayload(message.data);
  switch (message.event) {
    case 'turn':
      return isString(data.id) ? { ...turn, id: data.id } : turn;
    case 'node': {
      const last = turn.steps.at(-1);
      if (!isUndefined(last) && last.text === '' && isNull(last.batch)) return turn;
      return { ...turn, steps: [...turn.steps, emptyStep()] };
    }
    case 'text': {
      if (!isString(data.text)) return turn;
      const text = data.text;
      return withLastStep({ ...turn, wait: null }, (step) => ({ ...step, text: step.text + text }));
    }
    case 'retry':
      return isNumber(data.wait) ? { ...turn, wait: data.wait } : turn;
    case 'batch': {
      if (!isString(data.id) || !isTier(data.kind) || !isArray(data.proposals)) return turn;
      const batch: TurnBatch = {
        id: data.id,
        kind: data.kind,
        proposals: data.proposals as Proposal[],
        results: null,
        ...(isString(data.pinned) ? { pinned: data.pinned } : {}),
      };
      return withLastStep(turn, (step) => ({ ...step, batch }));
    }
    case 'done': {
      const reason = isString(data.reason) ? data.reason : 'end';
      if (reason === 'batch') return { ...turn, status: 'waiting', wait: null };
      return { ...turn, status: 'closed', reason, wait: null };
    }
    case 'error':
      return {
        ...turn,
        status: 'error',
        reason: isString(data.code) ? data.code : 'internal',
        wait: null,
      };
    default:
      return turn;
  }
}

/**
 * What a settled batch did: every read that ran with its answer, and the writes counted by outcome.
 * A write by set or a transform counts the records its folded answer names; any other write counts as one.
 * A status `0` counts as unknown, since the request may have run.
 *
 * @example
 * ```ts
 * const results = [{ status: 200 }, { status: 0 }]
 * const outcome = batchOutcome({ id: 'b', kind: 'write', proposals: [read, rename], results })
 * outcome.reads.length // -> 1
 * outcome.writes       // -> { proposals: 1, sent: 0, failed: 0, unknown: 1, declined: 0 }
 * ```
 */
export function batchOutcome(batch: TurnBatch): BatchOutcome {
  const results = batch.results ?? [];
  const reads: ReadOutcome[] = [];
  let writes: WriteTally | null = null;
  for (const [index, proposal] of batch.proposals.entries()) {
    const result = results[index];
    if (isUndefined(result)) continue;
    if (proposal.tier === 'read') {
      if (!('declined' in result)) reads.push({ proposal, result });
      continue;
    }
    writes ??= { proposals: 0, sent: 0, failed: 0, unknown: 0, declined: 0 };
    writes.proposals += 1;
    if ('declined' in result) {
      writes.declined += 1;
    } else if (!isUndefined(proposal.where) || !isUndefined(proposal.transform)) {
      const body = isPlainObject(result.body) ? result.body : {};
      writes.sent += countOf(isUndefined(proposal.transform) ? body.total : body.transformed);
      writes.failed += countOf(body.failed);
      writes.unknown += countOf(body.unknown);
    } else if (result.status >= 200 && result.status < 300) {
      writes.sent += 1;
    } else if (result.status === 0) {
      writes.unknown += 1;
    } else {
      writes.failed += 1;
    }
  }
  return { reads, writes };
}

/**
 * A count a folded answer reports, `0` when it names none.
 */
function countOf(value: unknown): number {
  return isNumber(value) ? value : 0;
}

/**
 * An event's JSON payload as an object, empty when it is not one.
 *
 * @example
 * ```ts
 * eventPayload('{"text":"Hello"}') // -> { text: 'Hello' }
 * eventPayload('[1]')              // -> {}
 * eventPayload('nope')             // -> {}
 * ```
 */
export function eventPayload(data: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(data);
    return isPlainObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Whether `value` names a tier.
 */
function isTier(value: unknown): value is AITier {
  return value === 'read' || value === 'write' || value === 'destructive';
}

/**
 * A step with nothing streamed yet.
 */
function emptyStep(): TurnStep {
  return { text: '', batch: null };
}

/**
 * The turn with its last step replaced by what `update` makes of it.
 */
function withLastStep(turn: Turn, update: (step: TurnStep) => TurnStep): Turn {
  const last = turn.steps.at(-1);
  if (isUndefined(last)) return turn;
  return { ...turn, steps: [...turn.steps.slice(0, -1), update(last)] };
}

/**
 * Replaces the live turn with what `update` makes of it; nothing happens before the first question.
 */
function replaceCurrent(update: (turn: Turn) => Turn): void {
  const current = currentTurn();
  if (isUndefined(current)) return;
  turns.value = [...turns.value.slice(0, -1), update(current)];
}
