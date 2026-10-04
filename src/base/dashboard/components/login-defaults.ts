import { isNull, ref } from 'ohnejs/utils';

/**
 * Values a sign-in form starts with, such as a public demo account.
 */
export interface LoginDefaults {
  /**
   * The email the form starts with.
   */
  email?: string;

  /**
   * The password the form starts with.
   */
  password?: string;
}

const defaults = ref<LoginDefaults | null>(null);

/**
 * Sets the values every sign-in form fills in, on the sign-in page and in the re-login popup alike.
 * `null` clears them.
 * A form already on screen takes new values at once, replacing what was typed.
 * Clearing leaves a form on screen as it is.
 *
 * @example
 * ```ts
 * setLoginDefaults({ email: 'demo@example.com', password: 'demo' })
 * ```
 */
export function setLoginDefaults(values: LoginDefaults | null): void {
  defaults.value = isNull(values) ? null : { ...values };
}

/**
 * The values set by `setLoginDefaults`, or `null`.
 * Reading it inside an effect subscribes to later changes.
 */
export function loginDefaults(): LoginDefaults | null {
  return defaults.value;
}
