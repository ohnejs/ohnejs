import { defineLayer } from 'ohnejs';
import { mapKeys } from 'ohnejs/utils';

import { imageVariantsCodegen } from './codegen/image-variants.ts';
import { uploadRecordCodegen } from './codegen/upload-record.ts';
import { UPLOADS_DEFAULTS, UPLOADS_STRATEGIES } from './config.ts';

export default defineLayer({
  defaults: { uploads: UPLOADS_DEFAULTS },
  strategies: {
    'uploads.storage': 'own',
    'uploads.url': 'own',
    ...mapKeys(UPLOADS_STRATEGIES, (key) => `uploads.${key}`),
  },
  codegen: [imageVariantsCodegen, uploadRecordCodegen],
});
