import type { FlowMeta, Prompt } from 'ohnejs';
import type { User } from 'ohnejs/auth';

import { badRequest, defineHandler, HTTPError, notFound, readJSONBody, useEvent } from 'ohnejs';
import { requireCapability } from 'ohnejs/auth';
import { hasKey, isNull, isPlainObject, isString, isUndefined, isUUID } from 'ohnejs/utils';

import type { ResolvedAIConfig } from '../../../config.ts';
import type { Turn } from '../../../turns/state.ts';

import { translate } from '../../../../ohne/http/translate.ts';
import { useAIConfig } from '../../../config.ts';
import { canUseModel, defaultModel, useProvider } from '../../../providers/use-provider.ts';
import {
  STREAMED,
  acquireStepPermit,
  enforceTurnsLimit,
  probeTokens,
} from '../../../turns/limits.ts';
import { userMessage } from '../../../turns/prompt.ts';
import { pruneTurns } from '../../../turns/prune.ts';
import { flowModels, startableFlows } from '../../../turns/run-flow.ts';
import { usableSkill } from '../../../turns/skills.ts';
import {
  closeTurn,
  activeModel,
  expireTurn,
  loadTurn,
  openTurn,
  turnGone,
} from '../../../turns/state.ts';
import { followUpTranscript, streamStep } from '../../../turns/step.ts';

/**
 * The longest message a person may type.
 */
const MAX_INPUT = 16_000;

/**
 * The longest page path accepted.
 */
const MAX_PAGE = 256;

/**
 * A dashboard path: a leading slash, then no whitespace or control character.
 * The page lands in the system prompt, so it never opens a line of its own there.
 */
const PAGE_RE = /^\/[^\s\p{Cc}]*$/u;

const BODY_KEYS = new Set(['input', 'page', 'model', 'skill', 'flow', 'after']);

/**
 * `POST /ai/turns`
 *
 * Opens a turn from `{ input, page, model?, skill?, flow?, after? }`.
 * Streams its first step as Server-Sent Events.
 * `turn` names the turn first; `text`, `batch`, `retry`, `done` and `error` follow as the step runs.
 * A flow turn streams `node` before each act node it enters.
 * It may step through several nodes in one stream.
 * The stream ends with the step; the browser answers a `batch` through `POST /ai/turns/[id]/results`.
 * A `batch` may name a dashboard path to `open`, which the browser opens once it answers.
 * Needs `ai.use`: no user `401`, a missing capability `403`.
 * Without `ai.model` the assistant is off, a `404`.
 * `model` picks another `ai.models` entry; one unknown, or a `jev` one, is a `400`.
 * A model whose key is unset, or that `ai:credentials` refuses the user, is a `503`.
 * `skill` starts the turn with a skill's instructions; one the person may not start is a `400`.
 * `flow` walks a flow from its start; one the person may not start is a `400`, as is a `skill` beside it.
 * A model the flow's nodes name that the user cannot call is a `503`.
 * `after` names a turn the new one follows up on, which then starts from that turn's transcript.
 * A follow-up is a plain turn, so a `flow` beside `after` is a `400`.
 * It must be the person's own turn, at any age retention keeps it, or it is a `409`.
 * An open turn is closed and followed: as `idle` or `lost` once it expired, else as `left`.
 * The new turn keeps the chat's first turn in `chat`, so `GET /ai/chats` lists them as one.
 * A transcript is bound to its model, so a follow-up on another model starts fresh.
 * A body that is not an object, an unknown key, an empty or over-long `input`, or a bad `page` is a `400`.
 * So is an `after` that is not a string.
 * A person past `ai.limits.turns` or `ai.limits.tokens`, or already streaming two steps, is a `429`.
 * A turn that starts also prunes the turns `ai.audit.retain` no longer keeps, in the background.
 */
export default defineHandler(async (): Promise<ReadableStream<Uint8Array>> => {
  const user = await requireCapability('ai.use');
  const body = await readJSONBody<unknown>();
  if (!isPlainObject(body)) throw badRequest();
  for (const key of Object.keys(body)) {
    if (!BODY_KEYS.has(key)) throw badRequest(translate('ai.api.unknownKey', { key }));
  }
  const { input, page } = body;
  if (!isString(input) || input.trim() === '' || input.length > MAX_INPUT) throw invalid('input');
  if (!isString(page) || !PAGE_RE.test(page) || page.length > MAX_PAGE) throw invalid('page');
  const config = useAIConfig();
  if (isUndefined(config.model)) throw notFound(translate('ai.api.assistantOff'));
  const model = isUndefined(body.model)
    ? ((await defaultModel(user)) ?? config.model)
    : pickedModel(body.model, config);
  if (!(await canUseModel(model, user))) {
    throw new HTTPError(503, translate('ai.api.modelUnavailable', { model }));
  }
  const skill = isUndefined(body.skill) ? undefined : startingSkill(body.skill, user);
  const flow = isUndefined(body.flow) ? undefined : await startingFlow(body.flow, user, model);
  if (!isUndefined(flow) && (!isUndefined(skill) || !isUndefined(body.after))) {
    throw invalid('flow');
  }
  const after = isUndefined(body.after) ? undefined : await followedTurn(body.after, user);
  await probeTokens(user);
  await enforceTurnsLimit(user);
  useEvent().waitUntil(pruneTurns());
  const provider = await useProvider(model, user);
  const release = await acquireStepPermit(user);
  let turn: Turn;
  try {
    turn = await openTurn({
      user: user.UUID,
      model,
      page,
      input,
      skill: skill?.name,
      chat: isUndefined(after) ? undefined : (after.chat ?? after.UUID),
      transcript: isUndefined(flow)
        ? [
            ...(!isUndefined(after) && activeModel(after) === model
              ? followUpTranscript(after, provider)
              : []),
            ...provider.transcript.user(userMessage(input, skill)),
          ]
        : [],
      ...(isUndefined(flow)
        ? {}
        : { flow: { name: flow.name, input, node: null, model, queue: [flow.flow.start] } }),
    });
  } catch (error) {
    release();
    throw error;
  }
  return streamStep({ turn, user, provider, release }, { event: 'turn', data: { id: turn.UUID } });
}, STREAMED);

/**
 * The `ai.models` entry the person picked, which must exist and be able to plan.
 */
function pickedModel(picked: unknown, { models }: ResolvedAIConfig): string {
  if (!isString(picked) || !hasKey(models, picked) || models[picked].provider === 'jev') {
    throw badRequest(translate('ai.api.unknownModel', { model: String(picked) }));
  }
  return picked;
}

/**
 * The skill the person starts the turn with, which must exist and be theirs to start.
 */
function startingSkill(name: unknown, user: User): { name: string; prompt: Prompt } {
  const skill = usableSkill(user, name);
  if (isUndefined(skill)) {
    throw badRequest(translate('ai.api.unknownSkill', { skill: String(name) }));
  }
  return { name: name as string, prompt: skill.prompt };
}

/**
 * The flow the person starts, which must exist and be theirs to start, every model it runs on keyed.
 */
async function startingFlow(name: unknown, user: User, model: string): Promise<FlowMeta> {
  const flow = startableFlows(user).find((meta) => meta.name === name);
  if (isUndefined(flow)) throw badRequest(translate('ai.api.unknownFlow', { flow: String(name) }));
  for (const entry of flowModels(flow.flow, model)) {
    if (!(await canUseModel(entry, user))) {
      throw new HTTPError(503, translate('ai.api.modelUnavailable', { model: entry }));
    }
  }
  return flow;
}

/**
 * The turn a follow-up continues: the person's own, closed now if still open, as `left` unless it expired.
 * It reads the row again after the close, so a step that answered meanwhile is continued with its answer.
 */
async function followedTurn(id: unknown, user: User): Promise<Turn> {
  if (!isString(id)) throw invalid('after');
  const turn = isUUID(id) ? await loadTurn(id) : undefined;
  if (isUndefined(turn) || turn.user !== user.UUID) throw turnGone();
  if (!isNull(turn.closedAt)) return turn;
  if (!(await expireTurn(turn))) await closeTurn(turn, 'left');
  return (await loadTurn(id)) ?? turn;
}

/**
 * The `400` a bad body field answers.
 */
function invalid(key: string): HTTPError {
  return badRequest(translate('ai.api.invalidBody', { key }));
}
