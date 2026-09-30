import { defineHandler, notFound } from 'ohnejs';
import { requireCapability } from 'ohnejs/auth';
import { isUndefined, isUUID } from 'ohnejs/utils';

import type { ChatTurn } from '../../../turns/chats.ts';

import { translate } from '../../../../ohne/http/translate.ts';
import { useAIConfig } from '../../../config.ts';
import { loadChat } from '../../../turns/chats.ts';

/**
 * `GET /ai/chats/[id]`
 *
 * Opens the person's chat `id` as `{ turns }`, oldest first, for the palette to replay and continue.
 * Each turn carries what the person typed, each step's text, and each batch with counts and record ids.
 * No transcript, usage, model or record value leaves the server.
 * Needs `ai.use`: no user `401`, a missing capability `403`.
 * Without `ai.model` the assistant is off, a `404`.
 * An unknown id and someone else's chat are the same `404`.
 */
export default defineHandler(async ({ params }): Promise<{ turns: ChatTurn[] }> => {
  const user = await requireCapability('ai.use');
  if (isUndefined(useAIConfig().model)) throw notFound(translate('ai.api.assistantOff'));
  const turns = isUUID(params.id) ? await loadChat(user, params.id) : undefined;
  if (isUndefined(turns)) throw notFound(translate('ai.api.unknownChat'));
  return { turns };
});
