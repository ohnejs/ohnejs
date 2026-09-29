import { deepStrictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { toUser } from '../../../src/base/auth/to-user.ts';
import UsersCollection from '../../../src/base/collections/Users.ts';
import datePatternField from '../../../src/base/fields/date-pattern.ts';
import languageField from '../../../src/base/fields/language.ts';
import localeField from '../../../src/base/fields/locale.ts';
import passwordField from '../../../src/base/fields/password.ts';
import rolesField from '../../../src/base/fields/roles.ts';
import timezoneField from '../../../src/base/fields/timezone.ts';
import { useCollections } from '../../../src/ohne/collections/use-collections.ts';
import { field } from '../../../src/ohne/fields/field.ts';
import { useFields } from '../../../src/ohne/fields/use-fields.ts';

useFields().register('password', { name: 'password', fieldType: passwordField });
useFields().register('roles', { name: 'roles', fieldType: rolesField });
useFields().register('language', { name: 'language', fieldType: languageField });
useFields().register('locale', { name: 'locale', fieldType: localeField });
useFields().register('timezone', { name: 'timezone', fieldType: timezoneField });
useFields().register('datePattern', { name: 'datePattern', fieldType: datePatternField });
useCollections().register('Users', {
  name: 'Users',
  collection: {
    ...UsersCollection,
    fields: { ...UsersCollection.fields, phone: field('text', { nullable: true }) },
  },
});

const defaults = {
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
};

describe('toUser', () => {
  it('projects a record that lacks the settings columns onto the defaults', () => {
    deepStrictEqual(
      toUser({ UUID: 'u', email: 'u@example.com', roles: ['admin'], password: 'x' }),
      defaults,
    );
  });

  it('carries a readable field the layout places beyond the members, never a write-only one', () => {
    const record = {
      UUID: 'u',
      email: 'u@example.com',
      roles: ['admin'],
      password: 'x',
      phone: '+1',
    };
    const layout = [{ card: ['firstName', 'phone', 'password'] }, { card: ['ghost'] }];
    deepStrictEqual(toUser(record, layout), { ...defaults, phone: '+1' });
    deepStrictEqual(toUser(record, [{ card: ['firstName'] }]), defaults);
  });

  it('reads a placed field the record lacks as null', () => {
    const record = { UUID: 'u', email: 'u@example.com', roles: ['admin'] };
    deepStrictEqual(toUser(record, [{ card: ['phone'] }]), { ...defaults, phone: null });
  });
});
