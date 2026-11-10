import { conflict, hook, queryUntyped, type Transaction, useRoles } from 'ohnejs';
import { isEmpty } from 'ohnejs/utils';

import { translate } from '../../ohne/http/translate.ts';
import { validationError } from '../../ohne/query/write/errors.ts';

// Only ever added to, so a nested `Users` write on the same `tx` cannot clear what an outer one saw.
const startedWithAdmin = new WeakSet<Transaction>();

hook('record:before-update', async ({ collection, tx }) => {
  if (collection === 'Users' && !isEmpty(await adminUUIDs(tx))) startedWithAdmin.add(tx);
});

hook('record:after-update', async (_record, { collection, tx }) => {
  if (collection === 'Users' && startedWithAdmin.has(tx) && isEmpty(await adminUUIDs(tx))) {
    throw validationError({ roles: 'auth.lastAdmin' });
  }
});

hook('record:before-delete', async ({ collection, matched, tx }) => {
  if (collection !== 'Users') return;
  const admins = await adminUUIDs(tx);
  if (!isEmpty(admins) && admins.every((uuid) => matched.includes(uuid))) {
    throw conflict(translate('auth.lastAdmin'));
  }
});

async function adminUUIDs(tx: Transaction): Promise<string[]> {
  const roles = Object.values(useRoles().all())
    .filter(({ role }) => role.capabilities.includes('*'))
    .map(({ name }) => name);
  if (isEmpty(roles)) return [];
  return (await queryUntyped('Users')
    .use(tx)
    .unscoped()
    .where({ roles: { includesAny: roles } })
    .pluck('UUID')) as string[];
}
