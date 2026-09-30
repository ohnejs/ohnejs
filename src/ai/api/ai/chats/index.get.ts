import { defineHandler, notFound } from 'ohnejs';
import { requireCapability } from 'ohnejs/auth';
import { isUndefined } from 'ohnejs/utils';

import type { ChatSummary } from '../../../turns/chats.ts';

import { translate } from '../../../../ohne/http/translate.ts';
import { useAIConfig } from '../../../config.ts';
import { listChats } from '../../../turns/chats.ts';

/**
 * `GET /ai/chats`
 *
 * Lists the person's latest chats as `{ chats }`, newest activity first.
 * Each names the chat's first turn as `id`, what the person first asked as `title`, and `updatedAt`.
 * Only the person's own turns are read, and nothing of a transcript leaves the server.
 * Needs `ai.use`: no user `401`, a missing capability `403`.
 * Without `ai.model` the assistant is off, a `404`.
 */
export default defineHandler(async (): Promise<{ chats: ChatSummary[] }> => {
  const user = await requireCapability('ai.use');
  if (isUndefined(useAIConfig().model)) throw notFound(translate('ai.api.assistantOff'));
  return { chats: await listChats(user) };
});
