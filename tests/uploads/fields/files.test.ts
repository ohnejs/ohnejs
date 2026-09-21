import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import UsersCollection from '../../../src/base/collections/Users.ts';
import datePatternField from '../../../src/base/fields/date-pattern.ts';
import languageField from '../../../src/base/fields/language.ts';
import localeField from '../../../src/base/fields/locale.ts';
import passwordField from '../../../src/base/fields/password.ts';
import rolesField from '../../../src/base/fields/roles.ts';
import timezoneField from '../../../src/base/fields/timezone.ts';
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
import filesField from '../../../src/uploads/fields/files.ts';

usePrinter().configure({ stream: { write: () => true } });

useFields().register('password', { name: 'password', fieldType: passwordField });
useFields().register('roles', { name: 'roles', fieldType: rolesField });
useFields().register('language', { name: 'language', fieldType: languageField });
useFields().register('locale', { name: 'locale', fieldType: localeField });
useFields().register('timezone', { name: 'timezone', fieldType: timezoneField });
useFields().register('datePattern', { name: 'datePattern', fieldType: datePatternField });
useFields().register('files', { name: 'files', fieldType: filesField });
useCollections().register('Users', { name: 'Users', collection: UsersCollection });
useCollections().register('Uploads', { name: 'Uploads', collection: UploadsCollection });
useCollections().register('FileBundles', {
  name: 'FileBundles',
  collection: {
    fields: {
      title: field('text'),
      files: field('files'),
    },
  },
});
useCollections().register('FilePapers', {
  name: 'FilePapers',
  collection: {
    fields: {
      papers: field('files', { min: 1, max: 2, types: ['document'], maxSize: '1mb' }),
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
const report = await pdf({ name: 'report.pdf' });
const huge = await pdf({ name: 'huge.pdf', size: 2 * 1024 * 1024 });
const sunset = await upload({
  name: 'sunset.png',
  type: 'image/png',
  size: 48213,
  width: 1200,
  height: 800,
});
const archive = await upload({ kind: 'folder', directory: '', name: 'archive' });

async function failing(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const result = await queryUntyped('FileBundles').create({ title: 'Bundle', ...input });
  strictEqual(result.ok, false);
  ok(!result.ok);
  return { ...result.errors };
}

async function failingPapers(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const result = await queryUntyped('FilePapers').create(input);
  strictEqual(result.ok, false);
  ok(!result.ok);
  return { ...result.errors };
}

describe('files references', () => {
  it('stores the linked UUIDs of any files in order', async () => {
    const bundle = await queryUntyped('FileBundles').createOrThrow({
      title: 'Mixed',
      files: [sunset, brief],
    });
    deepStrictEqual(bundle.files, [sunset, brief]);
  });

  it('keys a folder at its index', async () => {
    const errors = await failing({ files: [brief, archive] });
    deepStrictEqual(errors, { 'files[1]': 'uploads.errors.notAFile' });
  });

  it('applies the constraints per item', async () => {
    const errors = await failingPapers({ papers: [sunset, huge] });
    deepStrictEqual(errors, {
      'papers[0]': { key: 'uploads.errors.typeNotAllowed', params: { type: 'image/png' } },
      'papers[1]': { key: 'uploads.errors.fileTooLarge', params: { max: '1mb' } },
    });
  });
});

describe('files count', () => {
  it('rejects a list below `min`', async () => {
    const errors = await failingPapers({ papers: [] });
    deepStrictEqual(errors.papers, { key: 'validation.minItems', params: { min: 1 } });
  });

  it('requires a list with a `min` when a create omits it', async () => {
    deepStrictEqual(await failingPapers({}), { papers: 'validation.required' });
  });

  it('rejects a list above `max`', async () => {
    const errors = await failingPapers({ papers: [brief, report, huge] });
    deepStrictEqual(errors.papers, { key: 'validation.maxItems', params: { max: 2 } });
  });

  it('accepts a list within bounds', async () => {
    const bundle = await queryUntyped('FilePapers').createOrThrow({ papers: [report, brief] });
    deepStrictEqual(bundle.papers, [report, brief]);
  });
});

describe('files onDelete', () => {
  it('drops the link when the upload is deleted, keeping the row', async () => {
    const gone = await pdf({ name: 'gone.pdf' });
    const bundle = await queryUntyped('FileBundles').createOrThrow({
      title: 'Thinned',
      files: [brief, gone],
    });
    await queryUntyped('Uploads').where({ UUID: gone }).delete();
    const read = await queryUntyped('FileBundles').where({ UUID: bundle.UUID }).findFirst();
    ok(read);
    deepStrictEqual(read.files, [brief]);
  });
});
