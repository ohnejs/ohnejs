import { badRequest, defineHandler, HTTPError, readJSONBody } from 'ohnejs';
import { requireCapability } from 'ohnejs/auth';
import {
  isArray,
  isInteger,
  isNull,
  isPlainObject,
  isString,
  isUndefined,
  isUUID,
  parseBytes,
} from 'ohnejs/utils';

import type { BatchResult } from '../../../../turns/receipts.ts';
import type { OpenOutcome } from '../../../../turns/state.ts';

import { translate } from '../../../../../ohne/http/translate.ts';
import { useAIConfig } from '../../../../config.ts';
import { canUseModel, useProvider } from '../../../../providers/use-provider.ts';
import { STREAMED, acquireStepPermit, probeTokens } from '../../../../turns/limits.ts';
import {
  activeModel,
  batchReported,
  claimStep,
  expireTurn,
  loadTurn,
  turnGone,
  unknownBatch,
} from '../../../../turns/state.ts';
import { answerBatch, streamStep } from '../../../../turns/step.ts';

/**
 * The longest note a decline may carry.
 */
const MAX_NOTE = 1_000;

/**
 * The room a results body gets beyond its bodies: the envelope, statuses and notes.
 */
const ENVELOPE = 64 * 1024;

const BODY_KEYS = new Set(['batch', 'results', 'open']);
const OPEN_OUTCOMES = new Set<unknown>(['opened', 'stayed', 'declined'] satisfies OpenOutcome[]);
const RESULT_KEYS = new Set(['status', 'body', 'auto', 'declined', 'note']);

/**
 * `POST /ai/turns/[id]/results`
 *
 * Reports what the browser got for a batch's proposals and streams the next step, as `POST /ai/turns` does.
 * The body is `{ batch, results, open? }`, one result per proposal in order.
 * `open` reports what became of the batch's page: `opened`, `stayed` or `declined`.
 * A batch that opens a page needs it, and any other refuses it.
 * A result is `{ status, body?, auto? }`, or `{ declined, note? }` when the person declined the proposal.
 * `auto: true` says the browser sent it without asking, and only a proposal tagged `auto` may carry it.
 * Status `0` reports a request whose connection dropped before it answered, so it may have run.
 * The server shapes each into the receipt the model reads.
 * A body reaches it only as the redacted records of a collection `ai.data` opens.
 * On a `data: false` model no body reaches it at all.
 * Needs `ai.use`: no user `401`, a missing capability `403`.
 * A turn that is unknown, closed, idle past `ai.limits.turnTimeout`, lost, or someone else's is a `409`.
 * So is a batch that already has its results, or an id the turn never produced; `data.code` names which.
 * A body that is not an object, an unknown key, a bad result, or the wrong number of them is a `400`.
 * So is a missing, unknown or unwanted `open`.
 * A person past `ai.limits.tokens`, or already streaming two steps, is a `429`.
 * A model the user cannot call is a `503`; a flow turn runs on its node's model.
 * The body may hold every proposal's answer up to `ai.limits.resultSize`, so its cap is raised to fit them.
 */
export default defineHandler(
  async ({ params }): Promise<ReadableStream<Uint8Array>> => {
    const user = await requireCapability('ai.use');
    const body = await readJSONBody<unknown>();
    if (!isPlainObject(body)) throw badRequest();
    for (const key of Object.keys(body)) {
      if (!BODY_KEYS.has(key)) throw badRequest(translate('ai.api.unknownKey', { key }));
    }
    const { batch, results } = body;
    if (!isString(batch)) throw badRequest(translate('ai.api.invalidBody', { key: 'batch' }));
    if (!isArray(results) || !results.every(isResult)) {
      throw badRequest(translate('ai.api.invalidBody', { key: 'results' }));
    }
    const turn = isUUID(params.id) ? await loadTurn(params.id) : undefined;
    if (isUndefined(turn) || turn.user !== user.UUID || !isNull(turn.closedAt)) throw turnGone();
    if (await expireTurn(turn)) throw turnGone();
    const pending = turn.batches.at(-1);
    if (isUndefined(pending) || pending.id !== batch) {
      throw turn.batches.some((entry) => entry.id === batch)
        ? batchReported()
        : unknownBatch(batch);
    }
    if (!isUndefined(pending.reported)) throw batchReported();
    const open = isOpenOutcome(body.open) ? body.open : undefined;
    if (open !== body.open || isUndefined(open) !== isUndefined(pending.open)) {
      throw badRequest(translate('ai.api.invalidBody', { key: 'open' }));
    }
    if (results.length !== pending.proposals.length) {
      throw badRequest(translate('ai.api.resultsMismatch'));
    }
    if (
      results.some((result, index) => isAuto(result) && !pending.proposals[index].proposal.auto)
    ) {
      throw badRequest(translate('ai.api.invalidBody', { key: 'results' }));
    }
    const model = activeModel(turn);
    if (!(await canUseModel(model, user))) {
      throw new HTTPError(503, translate('ai.api.modelUnavailable', { model }));
    }
    await probeTokens(user);
    const provider = await useProvider(model, user);
    const release = await acquireStepPermit(user);
    try {
      const answers = await answerBatch(pending, results, open, provider, model);
      turn.transcript = [...turn.transcript, ...answers];
      if (!(await claimStep(turn))) throw batchReported();
    } catch (error) {
      release();
      throw error;
    }
    return streamStep({ turn, user, provider, release });
  },
  { ...STREAMED, maxBodySize: resultsBodySize() },
);

/**
 * Whether `value` is one result: an answer with an HTTP status or `0`, or a decline with an optional note.
 */
function isResult(value: unknown): value is BatchResult {
  if (!isPlainObject(value)) return false;
  for (const key of Object.keys(value)) {
    if (!RESULT_KEYS.has(key)) return false;
  }
  if (value.declined === true) {
    return (
      isUndefined(value.status) &&
      isUndefined(value.body) &&
      isUndefined(value.auto) &&
      isNote(value.note)
    );
  }
  return (
    isUndefined(value.declined) &&
    isUndefined(value.note) &&
    (isUndefined(value.auto) || value.auto === true) &&
    isInteger(value.status) &&
    (value.status === 0 || (value.status >= 100 && value.status <= 599))
  );
}

/**
 * Whether `value` says what became of a batch's page.
 */
function isOpenOutcome(value: unknown): value is OpenOutcome {
  return OPEN_OUTCOMES.has(value);
}

/**
 * Whether `result` reports a request the browser sent without asking.
 */
function isAuto(result: BatchResult): boolean {
  return 'auto' in result && result.auto === true;
}

/**
 * Whether `value` is a decline's note: absent, or a string up to `MAX_NOTE`.
 */
function isNote(value: unknown): boolean {
  return isUndefined(value) || (isString(value) && value.length <= MAX_NOTE);
}

/**
 * The largest results body: one `ai.limits.resultSize` per proposal a step may make, plus the envelope.
 */
function resultsBodySize(): number {
  const { limits } = useAIConfig();
  return parseBytes(limits.resultSize) * limits.requests + ENVELOPE;
}
