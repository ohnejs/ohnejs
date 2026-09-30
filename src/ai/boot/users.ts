import { hook, layoutFieldNames, ohneError, useCollections } from 'ohnejs';
import { userCan } from 'ohnejs/auth';
import { hasKey, isUndefined } from 'ohnejs/utils';

import { autoAcceptOffered } from '../turns/auto-accept.ts';

// Once every collection is registered, so an app's own `Users` is the one judged.
hook('server:ready', assertUsers);

hook('auth:account-layout', (layout, { user }) => {
  if (!userCan(user, 'ai.use') || !autoAcceptOffered()) return;
  const password = layout.findIndex((node) => layoutFieldNames([node]).includes('password'));
  layout.splice(password === -1 ? layout.length : password, 0, { card: ['autoAccept'] });
});

/**
 * Refuses a registered `Users` without `autoAccept`, with an error block.
 * An app's own `collections/Users.ts` replaces the layer's, and the account setting lives there.
 */
function assertUsers(): void {
  const users = useCollections().get('Users');
  if (isUndefined(users) || hasKey(users.collection.fields, 'autoAccept')) return;
  throw ohneError({
    title: 'The assistant layer needs `autoAccept` on `Users`',
    body: [
      "Your `collections/Users.ts` replaces the layer's, and it declares no `autoAccept` field.",
      '',
      'Spread `aiUsersDefinition` from `ohnejs/ai` in place of `usersDefinition`.',
    ],
  });
}
