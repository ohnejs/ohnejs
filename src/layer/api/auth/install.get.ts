import { defineHandler, queryUntyped } from 'ohne';

/**
 * `GET /auth/install`
 *
 * Answers `{ required: boolean }`: whether the first-user setup is still pending.
 * `required` is `true` while the `Users` collection has no rows, and `false` from the first user on.
 * The route is public; it reveals only that an account exists, never which one.
 */
export default defineHandler(
  async (): Promise<{ required: boolean }> => ({
    required: !(await queryUntyped('Users').exists()),
  }),
);
