import { hook } from 'ohnejs';
import { hasKey, isNull } from 'ohnejs/utils';

import { useAuthConfig } from '../auth/config.ts';

// `Users.password` admits `null` for passkey-only users, so an explicit `null` is refused here.
hook('record:validate', (errors, { values }, { collection }) => {
  if (collection !== 'Users' || !useAuthConfig().passwordSignIn) return errors;
  if (!hasKey(values, 'password') || !isNull(values.password)) return errors;
  return { ...errors, password: 'validation.required' };
});
