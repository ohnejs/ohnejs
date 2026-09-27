import { hook, type Transaction } from 'ohnejs';
import { isUndefined } from 'ohnejs/utils';

import { endOtherSessions } from '../auth/_sessions.ts';

// `record:after-update` cannot see the input, so `record:before-change` marks a password write on its `tx`.
const passwordWrites = new WeakSet<Transaction>();

hook('record:before-change', (input, { collection, operation, tx }) => {
  if (collection !== 'Users' || operation !== 'update') return;
  if (isUndefined(input.password)) passwordWrites.delete(tx);
  else passwordWrites.add(tx);
});

hook('record:after-update', async (record, { collection, tx }) => {
  if (collection === 'Users' && passwordWrites.has(tx)) {
    await endOtherSessions(record.UUID as string, tx);
  }
});
