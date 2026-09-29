import type { SearchParamValue, SSEMessage } from 'ohnejs/utils';

import {
  isArray,
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
}

/**
 * What the browser reports for one proposal: the answer it got, or the person's decline.
 */
export type BatchResult =
  | {
      /**
       * The answer's status; a write by set answers the status of its first failure, else `200`.
       */
      status: number;

      /**
       * The answer's JSON body, cut to what the receipt reads.
       */
      body?: unknown;
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
 * Opens a turn for `input` and puts its first step up for streaming.
 */
export function openTurn(input: string, skill: string | null = null): void {
  turns.value = [
    ...turns.value,
    { input, skill, id: null, status: 'streaming', steps: [emptyStep()], reason: null, wait: null },
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
  const data = payload(message.data);
  switch (message.event) {
    case 'turn':
      return isString(data.id) ? { ...turn, id: data.id } : turn;
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
 * The event's JSON payload as an object, empty when it is not one.
 */
function payload(data: string): Record<string, unknown> {
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
