import { hook, usePrinter } from 'ohne';
import { isUndefined } from 'ohne/utils';

import { useUploadsConfig } from '../config.ts';
import { imageSecrets } from '../images/sign.ts';
import { validateImageVariants } from '../images/variants.ts';

hook('server:ready', () => {
  validateImageVariants();
  if (!isUndefined(useUploadsConfig().images.url) && imageSecrets().length === 0) {
    usePrinter().warn(
      '`uploads.images.url` is set but `IMAGES_SECRET` is not; image URLs point at the originals',
    );
  }
});
