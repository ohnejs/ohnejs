import { badRequest, defineHandler, HTTPError, readJSONBody } from 'ohnejs';
import { requireCapability } from 'ohnejs/auth';
import {
  hasKey,
  isInteger,
  isNull,
  isPlainObject,
  isString,
  isUndefined,
  isUUID,
  toKebabCase,
} from 'ohnejs/utils';

import type { ResolvedAIConfig } from '../../../../config.ts';
import type { Turn } from '../../../../turns/state.ts';

import { gateCollection } from '../../../../../base/collections-api/gate.ts';
import { translate } from '../../../../../ohne/http/translate.ts';
import { useAIConfig } from '../../../../config.ts';
import { hasModelKey, useProvider } from '../../../../providers/use-provider.ts';
import { acquireStepPermit, probeTokens } from '../../../../turns/limits.ts';
import {
  batchReported,
  expireTurn,
  loadTurn,
  nodeModel,
  touchTurn,
  turnGone,
  unknownBatch,
} from '../../../../turns/state.ts';
import { readTransformRecords, streamTransform } from '../../../../turns/transform.ts';

const BODY_KEYS = new Set(['batch', 'proposal', 'model']);

/**
 * `POST /ai/turns/[id]/transform`
 *
 * Runs one transform proposal of the pending batch and streams what the model rewrote, as Server-Sent Events.
 * The body is `{ batch, proposal, model? }`: the batch id, the proposal's index in it, and the model.
 * The records are read as the person, through the collection's read gate, so a hidden row never leaves.
 * `start` names how many records the proposal matched and how many the transform reaches.
 * `records` carries each rewritten record with the values read and the values answered.
 * `skipped` names the records the transform reached and left, each with its reason.
 * `done` counts the rewritten and the skipped; `error` names why the run stopped.
 * The browser sends each approved record as an ordinary update, then reports the batch through `results`.
 * A run that starts touches the turn, so the person's idle time counts from it, not from the batch.
 * Needs `ai.use`: no user `401`, a missing capability `403`.
 * A turn that is unknown, closed, idle past `ai.limits.turnTimeout`, lost, or someone else's is a `409`.
 * So is a batch that already has its results, or an id the turn never produced; `data.code` names which.
 * A body that is not an object, an unknown key, or a `proposal` that is no transform of the batch is a `400`.
 * `model` picks another `ai.models` entry; one unknown, a `jev` one, or one with `data: false` is a `400`.
 * So is any `model` while `ai.transform.model` pins one, since every transform then runs on it.
 * A flow node's own `model` pins the same way, and a blind one there is the same `400`.
 * Without `model` the turn's model runs, unless it is blind, which is the same `400`.
 * A model whose key is unset is a `503`.
 * A person past `ai.limits.tokens`, or already streaming two steps, is a `429`.
 */
export default defineHandler(async ({ params }): Promise<unknown> => {
  const user = await requireCapability('ai.use');
  const body = await readJSONBody<unknown>();
  if (!isPlainObject(body)) throw badRequest();
  for (const key of Object.keys(body)) {
    if (!BODY_KEYS.has(key)) throw badRequest(translate('ai.api.unknownKey', { key }));
  }
  const { batch, proposal: index } = body;
  if (!isString(batch)) throw invalid('batch');
  if (!isInteger(index) || index < 0) throw invalid('proposal');
  if (!isUndefined(body.model) && !isString(body.model)) throw invalid('model');
  const turn = isUUID(params.id) ? await loadTurn(params.id) : undefined;
  if (isUndefined(turn) || turn.user !== user.UUID || !isNull(turn.closedAt)) throw turnGone();
  if (await expireTurn(turn)) throw turnGone();
  const config = useAIConfig();
  const pending = turn.batches.at(-1);
  if (isUndefined(pending) || pending.id !== batch) {
    throw turn.batches.some((entry) => entry.id === batch) ? batchReported() : unknownBatch(batch);
  }
  if (!isUndefined(pending.reported)) throw batchReported();
  const entry = pending.proposals[index];
  const collection = entry?.route.collection;
  if (isUndefined(entry) || isUndefined(entry.proposal.transform) || isUndefined(collection)) {
    throw invalid('proposal');
  }
  const model = transformModel(body.model, turn, config);
  if (!hasModelKey(model)) {
    throw new HTTPError(503, translate('ai.api.modelUnavailable', { model }));
  }
  await probeTokens(user);
  const gate = await gateCollection(toKebabCase(collection), 'read');
  if (!gate.ok) return gate.response;
  const read = await readTransformRecords(entry.proposal, gate.collection, gate.scope);
  await touchTurn(turn);
  const provider = useProvider(model);
  const release = acquireStepPermit(user);
  return streamTransform({ user, proposal: entry.proposal, collection, read, provider, release });
});

/**
 * The `ai.models` entry the transform runs on: the pinned one, else the one picked, else the turn's.
 * The pin is the flow node's own model when it names one, else `ai.transform.model`.
 * A pin takes no pick; whichever runs must exist, be able to plan, and see values.
 */
function transformModel(
  picked: unknown,
  turn: Turn,
  { models, transform }: ResolvedAIConfig,
): string {
  const pinned = nodeModel(turn) ?? transform.model;
  if (!isUndefined(pinned) && !isUndefined(picked)) {
    throw badRequest(translate('ai.api.modelPinned', { model: pinned }));
  }
  const name = pinned ?? (isUndefined(picked) ? turn.model : picked);
  if (!isString(name) || !hasKey(models, name) || models[name].provider === 'jev') {
    throw badRequest(translate('ai.api.unknownModel', { model: String(name) }));
  }
  if (models[name].data === false) {
    throw badRequest(translate('ai.api.blindModel', { model: name }), { code: 'blindModel' });
  }
  return name;
}

/**
 * The `400` a bad body field answers.
 */
function invalid(key: string): HTTPError {
  return badRequest(translate('ai.api.invalidBody', { key }));
}
