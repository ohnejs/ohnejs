import { defineLayer } from 'ohne';

import { UPLOADS_DEFAULTS } from './config.ts';

export default defineLayer({
  defaults: { uploads: UPLOADS_DEFAULTS },
  strategies: { 'uploads.storage': 'own', 'uploads.url': 'own', 'uploads.cache': 'replace' },
});
