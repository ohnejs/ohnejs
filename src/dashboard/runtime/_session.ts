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
       * The server answered a status the login has no reading for, like a `429` or a `500`.
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
  status: number,
): Extract<LoginOutcome, { kind: 'invalid' | 'failed' }> {
  return status === 401 ? { kind: 'invalid' } : { kind: 'failed', status };
}
