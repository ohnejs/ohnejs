import { defineLayer } from 'ohnejs';

import { AUTH_DEFAULTS } from './auth/config.ts';

export default defineLayer({
  defaults: { auth: AUTH_DEFAULTS },
});
