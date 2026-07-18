import { defineLayer } from 'ohne';

import { AUTH_DEFAULTS } from './src/layer/auth/config.ts';

export default defineLayer({
  defaults: { auth: AUTH_DEFAULTS },
});
