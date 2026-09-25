import { fileURLToPath } from 'node:url';
import { inspect } from 'node:util';

import type { Printer } from '../../utils/print/index.ts';

import { codeSpan } from '../../utils/ansi/index.ts';
import {
  errorMessage,
  isArray,
  isPathInside,
  isUndefined,
  relativePath,
} from '../../utils/index.ts';
import { resolveFieldErrors } from '../http/translate.ts';
import { SRC_ROOT } from '../meta/src-root.ts';
import { usePrinter } from '../printer/use-printer.ts';
import { isBusyError } from '../query/write/busy.ts';
import { isReferenceViolation, isValidationError } from '../query/write/errors.ts';
import { isOhneError } from './ohne-error.ts';

/**
 * Renders a thrown value through the printer - the one place an error reaches output.
 *
 * An `ohneError` with a title or path becomes an error block; a bare-message one becomes a line.
 * A validation error becomes a block with one translated row per failing field.
 * A busy error or a reference violation becomes a block titled by its message.
 * Any other throw becomes a block titled by its error name, with the message as the body.
 * An `ohneError` names its own corner; the others take the first stack frame outside the framework `src`.
 * The column is included when the stack carries one.
 * The full error, with its `cause` and own fields, shows only under `DEBUG`.
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
  } else if (isValidationError(error)) {
    printer.errorBlock({
      title: 'Validation failed',
      body: Object.entries(resolveFieldErrors(error.errors))
        .map(([path, message]) => `${codeSpan(path)}: ${message}`)
        .join('\n'),
      path: relativize(errorLocation(error)),
    });
  } else if (isBusyError(error) || isReferenceViolation(error)) {
    printer.errorBlock({ title: error.message, body: '', path: relativize(errorLocation(error)) });
  } else {
    printer.errorBlock({
      title: error instanceof Error ? error.name : 'Error',
      body: errorMessage(error),
      path: relativize(errorLocation(error)),
    });
  }

  if (error instanceof Error) printer.debug(inspect(error));
}

/**
 * Makes `path` relative to `process.cwd()`, passing `undefined` through.
 */
function relativize(path: string | undefined): string | undefined {
  return isUndefined(path) ? undefined : relativePath(process.cwd(), path);
}

/**
 * Pulls the first `file://` location outside the framework `src` from the stack as `file:line[:col]`.
 * A framework frame never stands in, so a factory like `notFound` points at the line that called it.
 */
function errorLocation(error: unknown): string | undefined {
  if (!(error instanceof Error) || isUndefined(error.stack)) return undefined;
  for (const [, url, line, column] of error.stack.matchAll(/(file:\/\/\/\S*?):(\d+)(?::(\d+))?/g)) {
    const file = fileURLToPath(url!);
    if (isPathInside(file, SRC_ROOT)) continue;
    return isUndefined(column) ? `${file}:${line}` : `${file}:${line}:${column}`;
  }
  return undefined;
}
