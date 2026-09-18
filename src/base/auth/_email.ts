/**
 * Normalizes an email to its canonical stored form: trimmed and lowercased.
 * The `Users` collection sanitizes with this, so login normalizes the same way before it looks a user up.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
