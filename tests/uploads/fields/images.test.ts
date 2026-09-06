import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import UsersCollection from '../../../src/layer/collections/Users.ts';
import datePatternField from '../../../src/layer/fields/date-pattern.ts';
import languageField from '../../../src/layer/fields/language.ts';
import localeField from '../../../src/layer/fields/locale.ts';
import passwordField from '../../../src/layer/fields/password.ts';
import rolesField from '../../../src/layer/fields/roles.ts';
import timezoneField from '../../../src/layer/fields/timezone.ts';
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
import imagesField from '../../../src/uploads/fields/images.ts';

usePrinter().configure({ stream: { write: () => true } });

useFields().register('password', { name: 'password', fieldType: passwordField });
useFields().register('roles', { name: 'roles', fieldType: rolesField });
useFields().register('language', { name: 'language', fieldType: languageField });
useFields().register('locale', { name: 'locale', fieldType: localeField });
useFields().register('timezone', { name: 'timezone', fieldType: timezoneField });
useFields().register('datePattern', { name: 'datePattern', fieldType: datePatternField });
useFields().register('images', { name: 'images', fieldType: imagesField });
useCollections().register('Users', { name: 'Users', collection: UsersCollection });
useCollections().register('Uploads', { name: 'Uploads', collection: UploadsCollection });
useCollections().register('ImageGalleries', {
  name: 'ImageGalleries',
  collection: {
    fields: {
      title: field('text'),
      images: field('images'),
      picks: field('images', {
        allowEmpty: false,
        min: 2,
        max: 3,
        types: ['image/png'],
        maxWidth: 4000,
      }),
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
    directory: 'photos',
    ...input,
  });
  return record.UUID as string;
}

function png(input: Record<string, unknown>): Promise<string> {
  return upload({ type: 'image/png', size: 48213, width: 1200, height: 800, ...input });
}

const sunset = await png({ name: 'sunset.png' });
const dawn = await png({ name: 'dawn.png' });
const dusk = await png({ name: 'dusk.png' });
const wide = await png({ name: 'wide.png', width: 5000 });
const brief = await upload({ name: 'brief.pdf', type: 'application/pdf', size: 90000 });
const archive = await upload({ kind: 'folder', directory: '', name: 'archive' });

async function failing(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const result = await queryUntyped('ImageGalleries').create({ title: 'Gallery', ...input });
  strictEqual(result.ok, false);
  ok(!result.ok);
  return { ...result.errors };
}

describe('images references', () => {
  it('stores the linked UUIDs in order', async () => {
    const gallery = await queryUntyped('ImageGalleries').createOrThrow({
      title: 'Ordered',
      images: [dawn, sunset],
    });
    deepStrictEqual(gallery.images, [dawn, sunset]);
  });

  it('defaults to an empty list', async () => {
    const gallery = await queryUntyped('ImageGalleries').createOrThrow({ title: 'Bare' });
    deepStrictEqual(gallery.images, []);
  });

  it('keys each failing item at its index', async () => {
    const errors = await failing({ images: [sunset, brief, archive] });
    deepStrictEqual(errors, {
      'images[1]': 'uploads.errors.notAnImage',
      'images[2]': 'uploads.errors.notAFile',
    });
  });

  it('applies the constraints per item', async () => {
    const errors = await failing({ picks: [sunset, wide] });
    deepStrictEqual(errors, {
      'picks[1]': { key: 'uploads.errors.maxWidth', params: { max: 4000 } },
    });
  });

  it('leaves a missing row to the reference check', async () => {
    const errors = await failing({ images: [sunset, 'no-such-upload'] });
    deepStrictEqual(errors, { 'images[1]': 'validation.invalidReference' });
  });
});

describe('images count', () => {
  it('rejects a provided empty list under `allowEmpty: false`', async () => {
    const errors = await failing({ picks: [] });
    strictEqual(errors.picks, 'validation.emptyValue');
  });

  it('rejects a list below `min`', async () => {
    const errors = await failing({ picks: [sunset] });
    deepStrictEqual(errors.picks, { key: 'validation.minItems', params: { min: 2 } });
  });

  it('rejects a list above `max`', async () => {
    const errors = await failing({ picks: [sunset, dawn, dusk, wide] });
    deepStrictEqual(errors.picks, { key: 'validation.maxItems', params: { max: 3 } });
  });

  it('accepts a list within bounds', async () => {
    const gallery = await queryUntyped('ImageGalleries').createOrThrow({
      title: 'Picked',
      picks: [sunset, dawn],
    });
    deepStrictEqual(gallery.picks, [sunset, dawn]);
  });
});

describe('images onDelete', () => {
  it('drops the link when the upload is deleted, keeping the row', async () => {
    const gone = await png({ name: 'gone.png' });
    const gallery = await queryUntyped('ImageGalleries').createOrThrow({
      title: 'Thinned',
      images: [gone, sunset],
    });
    await queryUntyped('Uploads').where({ UUID: gone }).delete();
    const read = await queryUntyped('ImageGalleries').where({ UUID: gallery.UUID }).findFirst();
    ok(read);
    deepStrictEqual(read.images, [sunset]);
  });
});
