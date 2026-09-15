import { fileURLToPath } from 'node:url';

import type { Printer } from '../../utils/print/index.ts';

import { errorMessage, isArray, isNull, isUndefined, relativePath } from '../../utils/index.ts';
import { usePrinter } from '../printer/use-printer.ts';
import { isOhneError } from './ohne-error.ts';

/**
 * Renders a thrown value through the printer - the one place an error reaches output.
 *
 * An `ohneError` with a title or path becomes an error block; a bare-message one becomes a line.
 * Any other throw becomes a block titled by its error name, with the message as the body.
 * A source location is pulled from the stack into the corner when present.
 * The column is included when the stack carries one.
 * The stack itself shows only under `DEBUG`.
 */
export function reportError(error: unknown, printer: Printer = usePrinter()): void {
  if (isOhneError(error)) {
    if (isUndefined(error.title) && isUndefined(error.path)) {
      printer.error(error.message);
    } else {
      printer.errorBlock({
        title: error.title ?? error.message,
        body: isArray(error.body) ? error.body.join('\n') : (error.body ?? ''),
        path: relativize(error.path),
      });
    }
  } else {
    printer.errorBlock({
      title: error instanceof Error ? error.name : 'Error',
      body: errorMessage(error),
      path: relativize(errorLocation(error)),
    });
  }

  if (error instanceof Error && !isUndefined(error.stack)) printer.debug(error.stack);
}

/**
 * Makes `path` relative to `process.cwd()`, passing `undefined` through.
 */
function relativize(path: string | undefined): string | undefined {
  return isUndefined(path) ? undefined : relativePath(process.cwd(), path);
}

/**
 * Pulls the first `file://` location from the stack as `file:line`, plus `:col` when present.
 */
function errorLocation(error: unknown): string | undefined {
  if (!(error instanceof Error) || isUndefined(error.stack)) return undefined;
  const match = error.stack.match(/(file:\/\/\/\S*?):(\d+)(?::(\d+))?/);
  if (isNull(match)) return undefined;
  const location = `${fileURLToPath(match[1]!)}:${match[2]}`;
  return isUndefined(match[3]) ? location : `${location}:${match[3]}`;
}
