import {
  api,
  button,
  card,
  type Child,
  css,
  formField,
  h,
  openDialog,
  popup,
  passkeysSupported,
  readAPIError,
  registerPasskey,
  relativeTime,
  textInput,
  toast,
  useResource,
  useT,
  withReauth,
} from 'ohnejs/dashboard';
import { effectScope, isEmpty, isNull, isUndefined, ref } from 'ohnejs/utils';

import type { Passkey } from '../../ohne.contract.ts';

css`
  .o-passkey {
    padding: 0.5rem 0;
  }

  .o-passkey + .o-passkey {
    border-top-width: 1px;
  }

  .o-passkey-name-buttons {
    justify-content: flex-end;
    margin-top: 0.75rem;
  }
`;

/**
 * The account page's passkeys card: the user's passkeys, each with rename and remove, and an add button.
 * Adding, renaming and removing ask the user to confirm who they are first when the server wants it.
 * A dismissed prompt changes nothing and says nothing.
 */
export function passkeysCard(): Child {
  const t = useT();
  const list = useResource<Passkey[]>('GET /auth/passkey');
  const busy = ref(false);

  const run = async (
    request: () => Promise<Response | null>,
    done: 'dashboard.passkeys.added' | 'dashboard.passkeys.renamed' | 'dashboard.passkeys.removed',
  ): Promise<void> => {
    if (busy.value) return;
    busy.value = true;
    try {
      const response = await withReauth(request);
      if (isNull(response)) return;
      if (!response.ok) {
        const error = await readAPIError(response, t('dashboard.writeFailed'));
        toast(error.message, { type: 'error' });
        return;
      }
      toast(t(done), { type: 'success' });
      await list.reload();
    } catch {
      toast(t('dashboard.passkeys.failed'), { type: 'error' });
    } finally {
      busy.value = false;
    }
  };

  const add = (): Promise<void> => run(registerPasskey, 'dashboard.passkeys.added');

  const rename = async (passkey: Passkey): Promise<void> => {
    const name = await askName(passkey.name);
    if (isUndefined(name)) return;
    await run(
      () =>
        api(`PATCH /auth/passkey/${passkey.UUID}`, {
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name }),
        }),
      'dashboard.passkeys.renamed',
    );
  };

  const remove = async (passkey: Passkey): Promise<void> => {
    const action = await openDialog({
      content: t('dashboard.passkeys.confirmRemove', { name: passkey.name }),
      actions: [
        { name: 'cancel', label: t('dashboard.cancel') },
        { name: 'remove', label: t('dashboard.delete'), variant: 'destructive' },
      ],
    });
    if (action !== 'remove') return;
    await run(() => api(`DELETE /auth/passkey/${passkey.UUID}`), 'dashboard.passkeys.removed');
  };

  const row = (passkey: Passkey): HTMLElement =>
    h(
      'div',
      { class: 'o-passkey ohne-row' },
      h(
        'div',
        { class: 'ohne-flex-1 ohne-truncate' },
        h('div', { class: 'ohne-truncate' }, passkey.name),
        h(
          'div',
          { class: 'ohne-muted ohne-truncate' },
          () => t(passkey.synced ? 'dashboard.passkeys.synced' : 'dashboard.passkeys.device'),
          ' · ',
          isNull(passkey.lastUsedAt)
            ? () => t('dashboard.passkeys.neverUsed')
            : [() => t('dashboard.passkeys.lastUsed'), ' ', relativeTime(passkey.lastUsedAt)],
        ),
      ),
      button(() => t('dashboard.passkeys.rename'), {
        icon: 'pencil',
        iconOnly: true,
        variant: 'ghost',
        disabled: () => busy.value,
        onClick: () => void rename(passkey),
      }),
      button(() => t('dashboard.delete'), {
        icon: 'trash',
        iconOnly: true,
        variant: 'ghost',
        disabled: () => busy.value,
        onClick: () => void remove(passkey),
      }),
    );

  return card(
    () => {
      const passkeys = list();
      if (isUndefined(passkeys)) return null;
      if (!passkeysSupported()) {
        return [
          ...passkeys.map(row),
          h('p', { class: 'ohne-muted' }, () => t('dashboard.passkeys.unsupported')),
        ];
      }
      if (isEmpty(passkeys)) {
        return h('p', { class: 'ohne-muted' }, () => t('dashboard.passkeys.empty'));
      }
      return passkeys.map(row);
    },
    {
      title: 'dashboard.passkeys.title',
      icon: 'fingerprint',
      actions: passkeysSupported()
        ? button(() => t('dashboard.passkeys.add'), {
            icon: 'plus',
            variant: 'outline',
            loading: () => busy.value,
            onClick: () => void add(),
          })
        : undefined,
    },
  );
}

/**
 * Asks for a passkey's new name in a popup; resolves it trimmed, or `undefined` on cancel.
 * The rename button stays disabled while the name is blank or unchanged.
 */
function askName(current: string): Promise<string | undefined> {
  const t = useT();
  const scope = effectScope(true);
  const name = ref(current);
  const unchanged = (): boolean => isEmpty(name.value.trim()) || name.value.trim() === current;
  return new Promise((resolve) => {
    scope.run(() => {
      const finish = (value?: string): void =>
        void handle.close().then(() => {
          scope.dispose();
          resolve(value);
        });
      const submit = (): void => {
        if (!unchanged()) finish(name.value.trim());
      };
      const handle = popup(
        h(
          'form',
          {
            onSubmit: (event: SubmitEvent) => {
              event.preventDefault();
              submit();
            },
          },
          formField(textInput(name, { id: 'o-passkey-name', name: 'name', autofocus: true }), {
            label: 'dashboard.passkeys.name',
          }),
          h(
            'div',
            { class: 'o-passkey-name-buttons ohne-row' },
            button(() => t('dashboard.cancel'), { variant: 'outline', onClick: () => finish() }),
            button(() => t('dashboard.passkeys.rename'), { type: 'submit', disabled: unchanged }),
          ),
        ),
        {
          size: -1,
          width: '26rem',
          title: 'dashboard.passkeys.rename',
          onClose: () => finish(),
        },
      );
    });
  });
}
