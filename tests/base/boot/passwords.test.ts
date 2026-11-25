import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import '../../../src/base/boot/passwords.ts';
import UsersCollection from '../../../src/base/collections/Users.ts';
import datePatternField from '../../../src/base/fields/date-pattern.ts';
import languageField from '../../../src/base/fields/language.ts';
import localeField from '../../../src/base/fields/locale.ts';
import passwordField from '../../../src/base/fields/password.ts';
import rolesField from '../../../src/base/fields/roles.ts';
import timezoneField from '../../../src/base/fields/timezone.ts';
import { useCollections } from '../../../src/ohne/collections/use-collections.ts';
import { buildDesiredSchema } from '../../../src/ohne/database/schema/desired.ts';
import { syncDatabase } from '../../../src/ohne/database/schema/sync.ts';
import { registerDatabase, registerDialect } from '../../../src/ohne/database/use-database.ts';
import { useFields } from '../../../src/ohne/fields/use-fields.ts';
import { useLayers } from '../../../src/ohne/layers/use-layers.ts';
import { useMessages } from '../../../src/ohne/messages/use-messages.ts';
import { usePrinter } from '../../../src/ohne/printer/use-printer.ts';
import { queryUntyped } from '../../../src/ohne/query/query.ts';
import { connectTest, dialect } from '../../_dialect.ts';

usePrinter().configure({ stream: { write: () => true } });

const LAYER = '/base-passwords-boot-test';

function configure(auth: Record<string, unknown> = {}): void {
  useLayers().remove(LAYER);
  useLayers().add({ path: LAYER, input: { auth: { password: { cost: 1024 }, ...auth } } });
}

configure();
useMessages().register('en', {});
useFields().register('password', { name: 'password', fieldType: passwordField });
useFields().register('roles', { name: 'roles', fieldType: rolesField });
useFields().register('language', { name: 'language', fieldType: languageField });
useFields().register('locale', { name: 'locale', fieldType: localeField });
useFields().register('timezone', { name: 'timezone', fieldType: timezoneField });
useFields().register('datePattern', { name: 'datePattern', fieldType: datePatternField });
useCollections().register('Users', { name: 'Users', collection: UsersCollection });

const db = await connectTest();
registerDialect(dialect);
registerDatabase(db);
await syncDatabase(db, dialect, {
  desired: buildDesiredSchema(useCollections(), useFields() as never),
});

async function storedPassword(email: string): Promise<unknown> {
  const row = await queryUntyped('Users').select('password').where({ email }).findFirst();
  return row?.password;
}

describe('the passwords boot file', () => {
  it('requires a password while password sign-in is on', async () => {
    const created = await queryUntyped('Users').create({ email: 'none@example.com' });
    ok(!created.ok);
    deepStrictEqual({ ...created.errors }, { password: 'validation.required' });
    const nulled = await queryUntyped('Users').create({
      email: 'null@example.com',
      password: null,
    });
    ok(!nulled.ok);
    deepStrictEqual({ ...nulled.errors }, { password: 'validation.required' });
  });

  it('refuses to clear a password while password sign-in is on', async () => {
    await queryUntyped('Users').createOrThrow({
      email: 'keep@example.com',
      password: 'correct horse',
    });
    const cleared = await queryUntyped('Users')
      .where({ email: 'keep@example.com' })
      .update({ password: null });
    ok(!cleared.ok);
    deepStrictEqual({ ...cleared.errors }, { password: 'validation.required' });
    strictEqual(typeof (await storedPassword('keep@example.com')), 'string');
  });

  it('stores no password for a passkey-only user', async () => {
    configure({ password: false });
    try {
      await queryUntyped('Users').createOrThrow({ email: 'passkey@example.com' });
      strictEqual(await storedPassword('passkey@example.com'), null);
    } finally {
      configure();
    }
  });

  it('lets a user without a password change other fields once passwords are back on', async () => {
    configure({ password: false });
    try {
      await queryUntyped('Users').createOrThrow({ email: 'later@example.com' });
    } finally {
      configure();
    }
    await queryUntyped('Users')
      .where({ email: 'later@example.com' })
      .updateOrThrow({ firstName: 'Ada' });
    strictEqual(await storedPassword('later@example.com'), null);
  });
});
