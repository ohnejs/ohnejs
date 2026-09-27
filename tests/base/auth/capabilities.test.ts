import { deepStrictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { User } from '../../../src/base/auth/types.ts';

import { ungrantableRoles } from '../../../src/base/auth/capabilities.ts';
import { useRoles } from '../../../src/ohne/roles/use-roles.ts';

const roles = {
  admin: ['*'],
  collections: ['collection.*'],
  posts: ['collection.Posts.*'],
  reader: ['collection.Posts.read'],
  empty: [],
};
for (const [name, capabilities] of Object.entries(roles)) {
  useRoles().register(name, { name, role: { capabilities } });
}

function holding(...names: string[]): User {
  return { roles: names } as unknown as User;
}

describe('ungrantableRoles', () => {
  it('grants every role to a `*` holder', () => {
    deepStrictEqual(ungrantableRoles(holding('admin')), []);
  });

  it('withholds `*` from a `collection.*` holder and covers patterns under it', () => {
    deepStrictEqual(ungrantableRoles(holding('collections')), ['admin']);
  });

  it('does not let a single capability cover its wildcard', () => {
    deepStrictEqual(ungrantableRoles(holding('reader')), ['admin', 'collections', 'posts']);
  });

  it('grants a role that lists no capability', () => {
    deepStrictEqual(ungrantableRoles(holding()), ['admin', 'collections', 'posts', 'reader']);
  });

  it('grants nothing through an unknown role name', () => {
    deepStrictEqual(ungrantableRoles(holding('ghost')), [
      'admin',
      'collections',
      'posts',
      'reader',
    ]);
  });
});
