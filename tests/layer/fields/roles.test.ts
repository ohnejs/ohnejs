import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import rolesField from '../../../src/layer/fields/roles.ts';
import { useCollections } from '../../../src/ohne/collections/use-collections.ts';
import { SQLiteDialect } from '../../../src/ohne/database/dialects/sqlite/dialect.ts';
import { buildDesiredSchema } from '../../../src/ohne/database/schema/desired.ts';
import { syncDatabase } from '../../../src/ohne/database/schema/sync.ts';
import { registerDatabase, registerDialect } from '../../../src/ohne/database/use-database.ts';
import { field } from '../../../src/ohne/fields/field.ts';
import { useFields } from '../../../src/ohne/fields/use-fields.ts';
import { usePrinter } from '../../../src/ohne/printer/use-printer.ts';
import { queryUntyped } from '../../../src/ohne/query/query.ts';
import { useRoles } from '../../../src/ohne/roles/use-roles.ts';

usePrinter().configure({ stream: { write: () => true } });

useFields().register('roles', { name: 'roles', fieldType: rolesField });
useRoles().register('editor', { name: 'editor', role: { capabilities: ['collection.Posts.*'] } });
useRoles().register('viewer', {
  name: 'viewer',
  role: { capabilities: ['collection.Posts.read'] },
});

useCollections().register('RolesAccounts', {
  name: 'RolesAccounts',
  collection: { fields: { name: field('text'), roles: field('roles') } },
});

const dialect = new SQLiteDialect();
const db = await dialect.connect(':memory:');
registerDialect(dialect);
registerDatabase(db);
await syncDatabase(db, dialect, {
  desired: buildDesiredSchema(useCollections(), useFields() as never),
});

describe('roles field', () => {
  it('stores role names and defaults to an empty list', async () => {
    const named = await queryUntyped('RolesAccounts').createOrThrow({
      name: 'Ada',
      roles: ['editor', 'viewer'],
    });
    deepStrictEqual(named.roles, ['editor', 'viewer']);

    const bare = await queryUntyped('RolesAccounts').createOrThrow({ name: 'Bare' });
    deepStrictEqual(bare.roles, []);
  });

  it('collapses duplicate entries, keeping the first occurrence', async () => {
    const record = await queryUntyped('RolesAccounts').createOrThrow({
      name: 'Dup',
      roles: ['editor', 'editor', 'viewer', 'editor'],
    });
    deepStrictEqual(record.roles, ['editor', 'viewer']);
  });

  it('rejects an unknown role name, naming it', async () => {
    const result = await queryUntyped('RolesAccounts').create({
      name: 'Ghost',
      roles: ['editor', 'ghost'],
    });
    strictEqual(result.ok, false);
    ok(!result.ok);
    deepStrictEqual(result.errors.roles, ['auth.unknownRole', { role: 'ghost' }]);
  });

  it('rejects a non-list and a non-string entry', async () => {
    const scalar = await queryUntyped('RolesAccounts').create({ name: 'S', roles: 'editor' });
    strictEqual(scalar.ok, false);
    ok(!scalar.ok);
    strictEqual(scalar.errors.roles, 'auth.invalidRoles');

    const mixed = await queryUntyped('RolesAccounts').create({ name: 'M', roles: ['editor', 1] });
    strictEqual(mixed.ok, false);
    ok(!mixed.ok);
    strictEqual(mixed.errors.roles, 'auth.invalidRoles');
  });

  it('filters by role membership through `includes`', async () => {
    await queryUntyped('RolesAccounts').createOrThrow({ name: 'Only', roles: ['viewer'] });
    const editors = (await queryUntyped('RolesAccounts')
      .where({ roles: { includes: 'editor' } })
      .findMany()) as { name: string }[];
    ok(editors.length >= 1);
    ok(editors.every((record) => record.name !== 'Only'));
  });
});
