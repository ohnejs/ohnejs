import { hook, usePrinter } from 'ohnejs';
import { isEmpty, isUndefined } from 'ohnejs/utils';

import { useUploadsConfig } from '../config.ts';
import { imageSecrets } from '../images/sign.ts';
import { validateImageVariants } from '../images/variants.ts';

hook('server:ready', () => {
  validateImageVariants();
  if (!isUndefined(useUploadsConfig().images.url) && isEmpty(imageSecrets())) {
    usePrinter().warn(
      '`IMAGES_SECRET` is not set; variant URLs are unsigned, and a signing service refuses them',
    );
  }
});
