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
  parseDuration,
} from 'ohnejs/utils';

import type { BatchResult } from '../../../../turns/receipts.ts';

import { translate } from '../../../../../ohne/http/translate.ts';
import { useAIConfig } from '../../../../config.ts';
import { hasModelKey, useProvider } from '../../../../providers/use-provider.ts';
import { acquireStepPermit, probeTokens } from '../../../../turns/limits.ts';
import {
  batchReported,
  claimStep,
  closeTurn,
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

const BODY_KEYS = new Set(['batch', 'results']);
const RESULT_KEYS = new Set(['status', 'body', 'declined', 'note']);

/**
 * `POST /ai/turns/[id]/results`
 *
 * Reports what the browser got for a batch's proposals and streams the next step, as `POST /ai/turns` does.
 * The body is `{ batch, results }`, one result per proposal in order.
 * A result is `{ status, body? }`, or `{ declined, note? }` when the person declined the proposal.
 * The server shapes each into the receipt the model reads.
 * A body reaches it only as the redacted records of a collection `ai.data` opens.
 * On a `data: false` model no body reaches it at all.
 * Needs `ai.use`: no user `401`, a missing capability `403`.
 * A turn that is unknown, closed, idle past `ai.limits.turnTimeout`, or someone else's is a `409`.
 * So is a batch that already has its results, or an id the turn never produced; `data.code` names which.
 * A body that is not an object, an unknown key, a bad result, or the wrong number of them is a `400`.
 * A person past `ai.limits.tokens`, or already streaming two steps, is a `429`.
 * A model whose key is unset is a `503`.
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
    const { limits } = useAIConfig();
    if (Date.now() - turn.updatedAt > parseDuration(limits.turnTimeout)) {
      await closeTurn(turn);
      throw turnGone();
    }
    const pending = turn.batches.at(-1);
    if (isUndefined(pending) || pending.id !== batch) {
      throw turn.batches.some((entry) => entry.id === batch)
        ? batchReported()
        : unknownBatch(batch);
    }
    if (!isUndefined(pending.reported)) throw batchReported();
    if (results.length !== pending.proposals.length) {
      throw badRequest(translate('ai.api.resultsMismatch'));
    }
    if (!hasModelKey(turn.model)) {
      throw new HTTPError(503, translate('ai.api.modelUnavailable', { model: turn.model }));
    }
    await probeTokens(user);
    const provider = useProvider(turn.model);
    const release = acquireStepPermit(user);
    try {
      const answers = await answerBatch(pending, results, provider, turn.model);
      turn.transcript = [...turn.transcript, ...answers];
      if (!(await claimStep(turn))) throw batchReported();
    } catch (error) {
      release();
      throw error;
    }
    return streamStep({ turn, user, provider, release });
  },
  { maxBodySize: resultsBodySize() },
);

/**
 * Whether `value` is one result: an answer with a whole-number status, or a decline with an optional note.
 */
function isResult(value: unknown): value is BatchResult {
  if (!isPlainObject(value)) return false;
  for (const key of Object.keys(value)) {
    if (!RESULT_KEYS.has(key)) return false;
  }
  if (value.declined === true) {
    return isUndefined(value.status) && isUndefined(value.body) && isNote(value.note);
  }
  return (
    isUndefined(value.declined) &&
    isUndefined(value.note) &&
    isInteger(value.status) &&
    value.status >= 100 &&
    value.status <= 599
  );
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
