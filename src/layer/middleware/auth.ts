import { defineMiddleware } from 'ohnejs';

import { useUser } from '../auth/use-user.ts';

/**
 * Loads the signed-in user into `event.context.user`, leaving it unset for an anonymous request.
 * Opt a route into it with `middleware: ['auth']` when the route serves both signed-in users and guests.
 * It never rejects; reach for `require-auth` to also turn an anonymous request into a `401`.
 */
export default defineMiddleware(async (event) => {
  const user = await useUser();
  if (user) event.context.user = user;
});
