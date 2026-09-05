import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import UsersCollection from '../../../src/layer/collections/Users.ts';
import passwordField from '../../../src/layer/fields/password.ts';
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
import UploadsCollection from '../../../src/uploads/collections/Uploads.ts';
import fileField from '../../../src/uploads/fields/file.ts';

usePrinter().configure({ stream: { write: () => true } });

useFields().register('password', { name: 'password', fieldType: passwordField });
useFields().register('roles', { name: 'roles', fieldType: rolesField });
useFields().register('file', { name: 'file', fieldType: fileField });
useCollections().register('Users', { name: 'Users', collection: UsersCollection });
useCollections().register('Uploads', { name: 'Uploads', collection: UploadsCollection });
useCollections().register('FileNotes', {
  name: 'FileNotes',
  collection: {
    fields: {
      title: field('text'),
      attachment: field('file'),
      source: field('file', { onDelete: 'cascade' }),
      paper: field('file', { types: ['document'], minSize: 1024, maxSize: '1mb' }),
    },
  },
});

const dialect = new SQLiteDialect();
const db = await dialect.connect(':memory:');
registerDialect(dialect);
registerDatabase(db);
await syncDatabase(db, dialect, {
  desired: buildDesiredSchema(useCollections(), useFields() as never),
});

async function upload(input: Record<string, unknown>): Promise<string> {
  const record = await queryUntyped('Uploads').createOrThrow({
    kind: 'file',
    directory: 'docs',
    ...input,
  });
  return record.UUID as string;
}

function pdf(input: Record<string, unknown>): Promise<string> {
  return upload({ type: 'application/pdf', size: 90000, ...input });
}

const brief = await pdf({ name: 'brief.pdf' });
const sunset = await upload({
  name: 'sunset.png',
  type: 'image/png',
  size: 48213,
  width: 1200,
  height: 800,
});
const archive = await upload({ kind: 'folder', directory: '', name: 'archive' });

async function failing(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const result = await queryUntyped('FileNotes').create({ title: 'Note', ...input });
  strictEqual(result.ok, false);
  ok(!result.ok);
  return { ...result.errors };
}

describe('file reference', () => {
  it('stores the UUID of any uploaded file', async () => {
    const note = await queryUntyped('FileNotes').createOrThrow({
      title: 'Any',
      attachment: sunset,
    });
    strictEqual(note.attachment, sunset);
    const other = await queryUntyped('FileNotes').createOrThrow({
      title: 'Any',
      attachment: brief,
    });
    strictEqual(other.attachment, brief);
  });

  it('rejects a folder', async () => {
    const errors = await failing({ attachment: archive });
    strictEqual(errors.attachment, 'uploads.errors.notAFile');
  });

  it('rejects a file outside `types`, naming its type', async () => {
    const errors = await failing({ paper: sunset });
    deepStrictEqual(errors.paper, {
      key: 'uploads.errors.typeNotAllowed',
      params: { type: 'image/png' },
    });
  });

  it('leaves a missing row to the reference check', async () => {
    const errors = await failing({ attachment: 'no-such-upload' });
    strictEqual(errors.attachment, 'validation.invalidReference');
  });
});

describe('file size bounds', () => {
  it('rejects a file below `minSize`, formatting the bound', async () => {
    const tiny = await pdf({ name: 'tiny.pdf', size: 100 });
    deepStrictEqual((await failing({ paper: tiny })).paper, {
      key: 'uploads.errors.fileTooSmall',
      params: { min: '1kb' },
    });
  });

  it('rejects a file above `maxSize`, formatting the bound', async () => {
    const huge = await pdf({ name: 'huge.pdf', size: 2 * 1024 * 1024 });
    deepStrictEqual((await failing({ paper: huge })).paper, {
      key: 'uploads.errors.fileTooLarge',
      params: { max: '1mb' },
    });
  });

  it('accepts a file within the bounds', async () => {
    const note = await queryUntyped('FileNotes').createOrThrow({ title: 'Paper', paper: brief });
    strictEqual(note.paper, brief);
  });
});

describe('file onDelete', () => {
  it('clears the reference when the upload is deleted', async () => {
    const gone = await pdf({ name: 'gone.pdf' });
    const note = await queryUntyped('FileNotes').createOrThrow({
      title: 'Cleared',
      attachment: gone,
    });
    await queryUntyped('Uploads').where({ UUID: gone }).delete();
    const read = await queryUntyped('FileNotes').where({ UUID: note.UUID }).findFirst();
    ok(read);
    strictEqual(read.attachment, null);
  });

  it('deletes the referencing row under `cascade`', async () => {
    const gone = await pdf({ name: 'gone-cascade.pdf' });
    const note = await queryUntyped('FileNotes').createOrThrow({ title: 'Doomed', source: gone });
    await queryUntyped('Uploads').where({ UUID: gone }).delete();
    const read = await queryUntyped('FileNotes').where({ UUID: note.UUID }).findFirst();
    strictEqual(read, undefined);
  });
});
