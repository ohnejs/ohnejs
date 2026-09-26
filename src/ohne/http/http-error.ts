import { translate } from './translate.ts';

/**
 * An error that carries an HTTP status.
 *
 * Thrown or returned from a handler, it maps to a response with its `status`.
 * The body is JSON `{ statusCode, message, data? }`.
 * A write that fails validation, hits a busy database, or is blocked by a reference maps to its own status.
 * Any other throw becomes a generic, detail-free `500`.
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
export function badRequest(message = translate('api.http.badRequest'), data?: unknown): HTTPError {
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
export function unauthorized(
  message = translate('api.http.unauthorized'),
  data?: unknown,
): HTTPError {
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
export function forbidden(message = translate('api.http.forbidden'), data?: unknown): HTTPError {
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
export function notFound(message = translate('api.http.notFound'), data?: unknown): HTTPError {
  return new HTTPError(404, message, data);
}

/**
 * Builds a `409 Conflict` error.
 * The status when a write conflicts with a record's current state, such as a blocked delete.
 *
 * @example
 * ```ts
 * throw conflict()
 * ```
 */
export function conflict(message = translate('api.http.conflict'), data?: unknown): HTTPError {
  return new HTTPError(409, message, data);
}

/**
 * Builds a `413 Content Too Large` error.
 * The status the server returns when a request body exceeds `api.maxBodySize`.
 *
 * @example
 * ```ts
 * throw payloadTooLarge()
 * ```
 */
export function payloadTooLarge(
  message = translate('api.http.contentTooLarge'),
  data?: unknown,
): HTTPError {
  return new HTTPError(413, message, data);
}

/**
 * Builds a `415 Unsupported Media Type` error.
 * The status when a body reader does not accept the request's `Content-Type`.
 *
 * @example
 * ```ts
 * throw unsupportedMediaType()
 * ```
 */
export function unsupportedMediaType(
  message = translate('api.http.unsupportedMediaType'),
  data?: unknown,
): HTTPError {
  return new HTTPError(415, message, data);
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
export function unprocessable(
  message = translate('api.http.unprocessableContent'),
  data?: unknown,
): HTTPError {
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
export function tooManyRequests(
  message = translate('api.http.tooManyRequests'),
  data?: unknown,
): HTTPError {
  return new HTTPError(429, message, data);
}

/**
 * Builds a `501 Not Implemented` error.
 * The status when the server lacks a capability a request needs.
 *
 * @example
 * ```ts
 * throw notImplemented()
 * ```
 */
export function notImplemented(
  message = translate('api.http.notImplemented'),
  data?: unknown,
): HTTPError {
  return new HTTPError(501, message, data);
}
