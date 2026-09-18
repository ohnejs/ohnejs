import { defineMiddleware, unauthorized } from 'ohnejs';
import { isNull } from 'ohnejs/utils';

import { useUser } from '../auth/use-user.ts';

/**
 * Requires a signed-in user, answering `401` when there is none, and sets `event.context.user`.
 * Opt a protected route into it with `middleware: ['require-auth']`, then read `event.context.user`.
 * It stands in for a per-handler `requireUser`, so the handler runs only for an authenticated request.
 */
export default defineMiddleware(async (event) => {
  const user = await useUser();
  if (isNull(user)) return unauthorized();
  event.context.user = user;
});
