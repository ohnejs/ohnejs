import { slugify } from '../../utils/index.ts';

/**
 * The session cookie name a new project writes into its config, built from its package name.
 * Two apps on one host share cookies whatever their ports, so each names its own.
 */
export function sessionCookie(name: string): string {
  return `${slugify(name)}-session`;
}
