/**
 * How a `login` attempt ended.
 */
export type LoginOutcome =
  | {
      /**
       * The server opened the session, and `sessionUser` already holds the user.
       */
      kind: 'signed-in';
    }
  | {
      /**
       * The server refused the email and password with a `401`, never saying which was wrong.
       */
      kind: 'invalid';
    }
  | {
      /**
       * The request never completed: a network failure.
       */
      kind: 'unreachable';
    }
  | {
      /**
       * The server refused to check the password now, with a `429` or a `503`.
       */
      kind: 'throttled';

      /**
       * Seconds to wait before trying again, `0` when the server named none.
       */
      retryAfter: number;
    }
  | {
      /**
       * The server answered a status the login has no reading for, like a `500`.
       */
      kind: 'failed';

      /**
       * The answered HTTP status.
       */
      status: number;
    };

/**
 * The outcome a refused `POST /auth/login` answer reads as.
 */
export function loginRefusal(
  response: Response,
): Extract<LoginOutcome, { kind: 'invalid' | 'throttled' | 'failed' }> {
  const { status } = response;
  if (status === 401) return { kind: 'invalid' };
  if (status === 429 || status === 503) {
    return { kind: 'throttled', retryAfter: Number(response.headers.get('Retry-After')) || 0 };
  }
  return { kind: 'failed', status };
}
