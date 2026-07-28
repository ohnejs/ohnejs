import { defineHandler } from 'ohne';

import type { User } from '../../auth/types.ts';

import { requireUser } from '../../auth/require-user.ts';

/**
 * `GET /auth/me`
 *
 * Returns the signed-in user as `{ UUID, email, roles }`, or `401` when there is no live session.
 */
export default defineHandler((): Promise<User> => requireUser());
