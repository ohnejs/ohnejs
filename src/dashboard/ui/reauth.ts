import { isNull } from '../../utils/is/is-null.ts';
import { isPlainObject } from '../../utils/is/is-plain-object.ts';
import { isString } from '../../utils/is/is-string.ts';
import { effectScope } from '../../utils/reactive/effect-scope.ts';
import { ref } from '../../utils/reactive/ref.ts';
import { css } from '../render/css.ts';
import { h } from '../render/h.ts';
import { readAPIError } from '../runtime/api-error.ts';
import { api } from '../runtime/api.ts';
import { getPasskey, passkeysSupported } from '../runtime/passkey.ts';
import { useT } from '../runtime/use-t.ts';
import { button } from './button.ts';
import { formField } from './form-field.ts';
import { popup } from './popup-overlay.ts';
import { textInput } from './text-input.ts';
import { toast } from './toaster.ts';

css`
  .ohne-reauth-buttons {
    justify-content: flex-end;
    margin-top: 0.75rem;
  }
`;

/**
 * Sends `request`, and once more after the user confirms who they are, when the server asks for that.
 * The server asks with the `403` of `requireFreshSession` from `ohnejs/auth`.
 * A user with a passkey confirms with it, one without types their password; a refusal toasts.
 * Resolves the last answer, or `null` when the user dismissed a prompt, as `request` may for its own.
 *
 * @example
 * ```ts
 * const response = await withReauth(() => api('DELETE /billing'))
 * ```
 */
export async function withReauth(
  request: () => Promise<Response | null>,
): Promise<Response | null> {
  const response = await request();
  if (isNull(response) || response.status !== 403) return response;
  const asked = await asksReauth(response.clone());
  if (isNull(asked)) return response;
  const confirmed =
    asked.passkey && passkeysSupported() ? confirmWithPasskey() : confirmWithPassword();
  return (await confirmed) ? request() : null;
}

/**
 * What a `403` asking the user to confirm says, or `null` for any other `403`.
 */
async function asksReauth(response: Response): Promise<{ passkey: boolean } | null> {
  const body: unknown = await response.json().catch(() => undefined);
  const data = isPlainObject(body) ? body.data : undefined;
  return isPlainObject(data) && data.reauth === true ? { passkey: data.passkey === true } : null;
}

/**
 * Confirms with one of the user's passkeys.
 */
async function confirmWithPasskey(): Promise<boolean> {
  const options = await api('POST /auth/passkey/options');
  if (!options.ok) return refused(options);
  const credential = await getPasskey(
    (await options.json()) as PublicKeyCredentialRequestOptionsJSON,
  );
  if (isNull(credential)) return false;
  const response = await api('POST /auth/reauth', {
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ credential }),
  });
  return response.ok || refused(response);
}

/**
 * Confirms with the user's password in a popup, which keeps a wrong one under its input.
 */
function confirmWithPassword(): Promise<boolean> {
  const t = useT();
  const scope = effectScope(true);
  const password = ref('');
  const error = ref('');
  const busy = ref(false);
  return new Promise((resolve) => {
    scope.run(() => {
      const finish = (confirmed: boolean): void =>
        void handle.close().then(() => {
          scope.dispose();
          resolve(confirmed);
        });
      const submit = async (): Promise<void> => {
        if (busy.value || password.value === '') return;
        busy.value = true;
        error.value = '';
        const response = await api('POST /auth/reauth', {
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ password: password.value }),
        });
        busy.value = false;
        if (response.ok) return finish(true);
        if (response.status !== 422) return finish(await refused(response));
        const { data } = await readAPIError(response, '');
        const errors = isPlainObject(data) && isPlainObject(data.errors) ? data.errors : {};
        error.value = isString(errors.password) ? errors.password : t('dashboard.writeFailed');
      };
      const handle = popup(
        h(
          'form',
          {
            onSubmit: (event: SubmitEvent) => {
              event.preventDefault();
              void submit();
            },
          },
          formField(
            textInput(password, {
              id: 'ohne-reauth-password',
              name: 'password',
              type: 'password',
              autocomplete: 'current-password',
              autofocus: true,
            }),
            {
              label: 'dashboard.account.currentPassword',
              error: () => error.value,
              required: true,
            },
          ),
          h(
            'div',
            { class: 'ohne-reauth-buttons ohne-row' },
            button(() => t('dashboard.cancel'), {
              variant: 'outline',
              onClick: () => finish(false),
            }),
            button(() => t('dashboard.account.confirm'), {
              disabled: () => busy.value || password.value === '',
              onClick: () => void submit(),
            }),
          ),
        ),
        {
          size: -1,
          width: '26rem',
          title: 'dashboard.account.confirmIdentity',
          onClose: () => finish(false),
        },
      );
    });
  });
}

/**
 * Toasts the server's message for a refused confirmation, and reads `false`.
 */
async function refused(response: Response): Promise<false> {
  const error = await readAPIError(response, useT()('dashboard.writeFailed'));
  toast(error.message, { type: 'error' });
  return false;
}
