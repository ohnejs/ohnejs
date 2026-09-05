import { hook, usePrinter } from 'ohne';

import { useUploadsConfig } from '../config.ts';
import { imageSecrets } from '../images/sign.ts';

hook('server:ready', () => {
  if (useUploadsConfig().images && imageSecrets().length === 0) {
    usePrinter().warn(
      '`uploads.images.url` is set but `IMAGES_SECRET` is not; image URLs point at the originals',
    );
  }
});
