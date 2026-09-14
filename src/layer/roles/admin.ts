import { defineRole } from 'ohnejs';

/**
 * The `admin` role: the `*` capability covers everything.
 * Assign it to a user's `roles` to grant full access; there is no separate superuser flag.
 */
export default defineRole({
  capabilities: ['*'],
});
