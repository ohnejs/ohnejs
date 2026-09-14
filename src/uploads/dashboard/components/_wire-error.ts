import { first, isPlainObject, isString } from 'ohnejs/utils';

/**
 * What an error response says: its field errors and the one message worth showing.
 */
export interface WireError {
  /**
   * The per-field messages of a `422`, empty for any other answer.
   */
  errors: Readonly<Record<string, string>>;

  /**
   * The first field error, else the wire `message`, else the status text.
   */
  message: string;
}

/**
 * Reads an error response into its field errors and its headline message.
 * A body that is not JSON answers the status text alone.
 */
export async function readWireError(response: Response): Promise<WireError> {
  const body: unknown = await response.json().catch(() => null);
  const errors: Record<string, string> = {};
  if (!isPlainObject(body)) return { errors, message: response.statusText };
  const raw = isPlainObject(body.data) ? body.data.errors : null;
  if (isPlainObject(raw)) {
    for (const [key, message] of Object.entries(raw)) {
      if (isString(message)) errors[key] = message;
    }
  }
  const firstError = first(Object.values(errors));
  const message = firstError ?? (isString(body.message) ? body.message : response.statusText);
  return { errors, message };
}
