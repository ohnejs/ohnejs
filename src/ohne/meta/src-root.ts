import { fileURLToPath } from 'node:url';

import { dirname, resolvePath } from '../../utils/index.ts';

/**
 * The framework `src` directory, the root every framework module lives under.
 */
export const SRC_ROOT: string = resolvePath('../..', dirname(fileURLToPath(import.meta.url)));
