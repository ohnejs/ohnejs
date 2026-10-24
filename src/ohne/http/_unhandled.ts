import type { Route } from '../routes/route.ts';

import { codeSpan } from '../../utils/ansi/index.ts';
import { errorMessage, isUndefined } from '../../utils/index.ts';
import { usePrinter } from '../printer/use-printer.ts';
import { isBusyError } from '../query/write/busy.ts';
import { isReferenceViolation, isValidationError } from '../query/write/errors.ts';
import { HTTPError } from './http-error.ts';

/**
 * Whether the pipeline answers `error` with its own status, so it is no bug of the server.
 */
export function isAnswered(error: unknown): boolean {
  return (
    error instanceof HTTPError ||
    isValidationError(error) ||
    isBusyError(error) ||
    isReferenceViolation(error)
  );
}

/**
 * Prints an unhandled error as a block titled by its request, such as `GET /posts`.
 * The stack shows only under `DEBUG`.
 */
export function logUnhandled(target: string, error: unknown): void {
  const printer = usePrinter();
  printer.errorBlock({
    title: `Unhandled error in ${codeSpan(target)}`,
    body: errorMessage(error),
  });
  if (error instanceof Error && !isUndefined(error.stack)) printer.debug(error.stack);
}

/**
 * Names `route` by its method and pattern, such as `GET /posts/[id]`.
 */
export function routeTarget(route: Route): string {
  return `${route.method ?? 'ANY'} ${route.pattern}`;
}
