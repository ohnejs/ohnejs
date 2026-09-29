import type { User } from 'ohnejs/auth';

import { badRequest, defineHandler, HTTPError, notFound, readJSONBody, useSkills } from 'ohnejs';
import { requireCapability, userCan } from 'ohnejs/auth';
import { hasKey, isPlainObject, isString, isUndefined } from 'ohnejs/utils';

import type { ResolvedAIConfig } from '../../../config.ts';
import type { Turn } from '../../../turns/state.ts';

import { translate } from '../../../../ohne/http/translate.ts';
import { useAIConfig } from '../../../config.ts';
import { hasModelKey, useProvider } from '../../../providers/use-provider.ts';
import { acquireStepPermit, enforceTurnsLimit, probeTokens } from '../../../turns/limits.ts';
import { userMessage } from '../../../turns/prompt.ts';
import { openTurn } from '../../../turns/state.ts';
import { streamStep } from '../../../turns/step.ts';

/**
 * The longest message a person may type.
 */
const MAX_INPUT = 16_000;

/**
 * The longest page pattern accepted.
 */
const MAX_PAGE = 256;

/**
 * A dashboard route pattern: a leading slash, then no whitespace or control character.
 * The page lands in the system prompt, so it never opens a line of its own there.
 */
const PAGE_RE = /^\/[^\s\p{Cc}]*$/u;

const BODY_KEYS = new Set(['input', 'page', 'model', 'skill']);

/**
 * `POST /ai/turns`
 *
 * Opens a turn from `{ input, page, model?, skill? }` and streams its first step as Server-Sent Events.
 * `turn` names the turn first; `text`, `batch`, `retry`, `done` and `error` follow as the step runs.
 * The stream ends with the step; the browser answers a `batch` through `POST /ai/turns/[id]/results`.
 * Needs `ai.use`: no user `401`, a missing capability `403`.
 * Without `ai.model` the assistant is off, a `404`.
 * `model` picks another `ai.models` entry; one unknown, or a `jev` one, is a `400`.
 * A model whose key is unset is a `503`.
 * `skill` starts the turn with a skill's instructions; one the person may not start is a `400`.
 * A body that is not an object, an unknown key, an empty or over-long `input`, or a bad `page` is a `400`.
 * A person past `ai.limits.turns` or `ai.limits.tokens`, or already streaming two steps, is a `429`.
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
  const model = isUndefined(body.model) ? config.model : pickedModel(body.model, config);
  if (!hasModelKey(model)) {
    throw new HTTPError(503, translate('ai.api.modelUnavailable', { model }));
  }
  const skill = isUndefined(body.skill) ? undefined : startingSkill(body.skill, user);
  await probeTokens(user);
  await enforceTurnsLimit(user);
  const provider = useProvider(model);
  const release = acquireStepPermit(user);
  let turn: Turn;
  try {
    turn = await openTurn({
      user: user.UUID,
      model,
      page,
      transcript: provider.transcript.user(userMessage(input, skill)),
    });
  } catch (error) {
    release();
    throw error;
  }
  return streamStep({ turn, user, provider, release }, { event: 'turn', data: { id: turn.UUID } });
});

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
function startingSkill(name: unknown, user: User): { name: string; prompt: string } {
  const skill = isString(name) ? useSkills().get(name)?.skill : undefined;
  if (isUndefined(skill) || (!isUndefined(skill.capability) && !userCan(user, skill.capability))) {
    throw badRequest(translate('ai.api.unknownSkill', { skill: String(name) }));
  }
  return { name: name as string, prompt: skill.prompt };
}

/**
 * The `400` a bad body field answers.
 */
function invalid(key: string): HTTPError {
  return badRequest(translate('ai.api.invalidBody', { key }));
}
