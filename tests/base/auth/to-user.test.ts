import { deepStrictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { toUser } from '../../../src/base/auth/to-user.ts';

describe('toUser', () => {
  it('projects a record that lacks the settings columns onto the defaults', () => {
    deepStrictEqual(
      toUser({ UUID: 'u', email: 'u@example.com', roles: ['admin'], password: 'x' }),
      {
        UUID: 'u',
        email: 'u@example.com',
        firstName: null,
        lastName: null,
        roles: ['admin'],
        dashboardLanguage: null,
        contentLanguage: null,
        timezone: null,
        dateFormat: 'LL',
        timeFormat: 'LTS',
        smartClipboard: false,
      },
    );
  });
});
