import { isNull, relativePath } from '../../utils/index.ts';
import { ohneError } from '../error/ohne-error.ts';

const UNIMPORTABLE = /[%#?]/;

/**
 * Throws when a `kind` file's path holds `%`, `#`, or `?`.
 * Each reparses as URL syntax in the generated ESM import, so the file would not resolve.
 *
 * `rel` is checked and named in the message; `file` is the absolute path shown in the error.
 */
export function assertImportablePath(kind: string, rel: string, file: string): void {
  const match = rel.match(UNIMPORTABLE);
  if (isNull(match)) return;
  throw ohneError({
    title: `Unsupported character \`${match[0]}\` in a ${kind} path`,
    body: [`A ${kind} path cannot contain \`%\`, \`#\`, or \`?\`.`, 'Rename the file.'],
    path: relativePath(process.cwd(), file),
  });
}
