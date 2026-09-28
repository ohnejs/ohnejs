import { parseDuration } from 'ohnejs/utils';
import { codeSpan } from 'ohnejs/utils/ansi';

import { ohneError } from '../../ohne/error/ohne-error.ts';
import { useUploadsConfig } from '../config.ts';

/**
 * The longest any private link may last, in milliseconds: `uploads.linkMaxAge`.
 */
export function linkMaxAge(): number {
  return parseDuration(useUploadsConfig().linkMaxAge);
}

/**
 * Throws when a link to `path` would expire further ahead than `uploads.linkMaxAge`, since no route opens it.
 */
export function checkLinkExpiry(path: string, expires: number): void {
  if (expires <= Date.now() + linkMaxAge()) return;
  const max = useUploadsConfig().linkMaxAge;
  throw ohneError(`A private link to ${codeSpan(path)} cannot expire past \`${max}\` from now`);
}
