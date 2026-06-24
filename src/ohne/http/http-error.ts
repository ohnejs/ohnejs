/**
 * An error that carries an HTTP status.
 *
 * Thrown or returned from a handler, it maps to a response with its `status`.
 * The body is JSON `{ statusCode, message, data? }`.
 * Any other thrown value becomes a generic `500`, so a leaked internal error never reaches the client.
 *
 * Reach for the named constructors (`badRequest`, `notFound`, ...) rather than `new HTTPError`.
 */
export class HTTPError extends Error {
  /**
   * The HTTP status code the response is sent with.
   */
  readonly status: number;

  /**
   * Optional payload serialized under `data` in the response body.
   */
  readonly data: unknown;

  /**
   * Builds an error for `status`, with `message` as the body message and optional `data`.
   */
  constructor(status: number, message: string, data?: unknown) {
    super(message);
    this.name = 'HTTPError';
    this.status = status;
    this.data = data;
  }
}

/**
 * Builds a `400 Bad Request` error.
 *
 * @example
 * ```ts
 * throw badRequest('Missing `email`')
 * ```
 */
export function badRequest(message = 'Bad Request', data?: unknown): HTTPError {
  return new HTTPError(400, message, data);
}

/**
 * Builds a `401 Unauthorized` error.
 *
 * @example
 * ```ts
 * throw unauthorized()
 * ```
 */
export function unauthorized(message = 'Unauthorized', data?: unknown): HTTPError {
  return new HTTPError(401, message, data);
}

/**
 * Builds a `403 Forbidden` error.
 *
 * @example
 * ```ts
 * throw forbidden('Admins only')
 * ```
 */
export function forbidden(message = 'Forbidden', data?: unknown): HTTPError {
  return new HTTPError(403, message, data);
}

/**
 * Builds a `404 Not Found` error.
 *
 * @example
 * ```ts
 * throw notFound('No such user')
 * ```
 */
export function notFound(message = 'Not Found', data?: unknown): HTTPError {
  return new HTTPError(404, message, data);
}

/**
 * Builds a `413 Content Too Large` error.
 * The status the server returns when a request body exceeds `server.maxBodySize`.
 *
 * @example
 * ```ts
 * throw payloadTooLarge()
 * ```
 */
export function payloadTooLarge(message = 'Content Too Large', data?: unknown): HTTPError {
  return new HTTPError(413, message, data);
}

/**
 * Builds a `422 Unprocessable Content` error.
 * The status for a well-formed request that fails validation.
 *
 * @example
 * ```ts
 * throw unprocessable('Password too short', { field: 'password' })
 * ```
 */
export function unprocessable(message = 'Unprocessable Content', data?: unknown): HTTPError {
  return new HTTPError(422, message, data);
}

/**
 * Builds a `429 Too Many Requests` error.
 *
 * @example
 * ```ts
 * throw tooManyRequests()
 * ```
 */
export function tooManyRequests(message = 'Too Many Requests', data?: unknown): HTTPError {
  return new HTTPError(429, message, data);
}
