import { truncateWithHash } from '../../../utils/crypto/index.ts';
import { ohneError } from '../../error/ohne-error.ts';

/**
 * Finalizes a composed logical name into its physical form: one truncation at the physical boundary.
 * A `$` in the input means an already-truncated name leaked back into composition, which is a bug.
 */
export function physicalName(name: string): string {
  if (name.includes('$')) {
    throw ohneError(
      `Cannot compose a database name from \`${name}\`: \`$\` marks an already-truncated name`,
    );
  }
  return truncateWithHash(name);
}
