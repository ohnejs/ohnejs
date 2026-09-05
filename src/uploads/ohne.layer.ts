import { defineLayer } from 'ohne';
import { mapKeys } from 'ohne/utils';

import { imageVariantsCodegen } from './codegen/image-variants.ts';
import { UPLOADS_DEFAULTS, UPLOADS_STRATEGIES } from './config.ts';

export default defineLayer({
  defaults: { uploads: UPLOADS_DEFAULTS },
  strategies: {
    'uploads.storage': 'own',
    'uploads.url': 'own',
    ...mapKeys(UPLOADS_STRATEGIES, (key) => `uploads.${key}`),
  },
  codegen: [imageVariantsCodegen],
});
