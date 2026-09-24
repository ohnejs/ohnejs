import { hook, usePrinter } from 'ohnejs';
import { isUndefined } from 'ohnejs/utils';

import { useUploadsConfig } from '../config.ts';
import { hasUploadSecret } from '../images/sign.ts';
import { validateImageVariants } from '../images/variants.ts';

hook('server:ready', () => {
  validateImageVariants();
  if (!isUndefined(useUploadsConfig().images.url) && !hasUploadSecret()) {
    usePrinter().warn(
      '`UPLOADS_SECRET` is not set; variant URLs are unsigned, and a signing service refuses them',
    );
  }
});
