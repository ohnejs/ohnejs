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
import imageField from '../../../src/uploads/fields/image.ts';

usePrinter().configure({ stream: { write: () => true } });

useFields().register('password', { name: 'password', fieldType: passwordField });
useFields().register('roles', { name: 'roles', fieldType: rolesField });
useFields().register('language', { name: 'language', fieldType: languageField });
useFields().register('locale', { name: 'locale', fieldType: localeField });
useFields().register('timezone', { name: 'timezone', fieldType: timezoneField });
useFields().register('datePattern', { name: 'datePattern', fieldType: datePatternField });
useFields().register('image', { name: 'image', fieldType: imageField });
useCollections().register('Users', { name: 'Users', collection: UsersCollection });
useCollections().register('Uploads', { name: 'Uploads', collection: UploadsCollection });
useCollections().register('ImagePosts', {
  name: 'ImagePosts',
  collection: {
    fields: {
      title: field('text'),
      cover: field('image'),
      poster: field('image', { onDelete: 'cascade' }),
      hero: field('image', {
        types: ['image/png'],
        minSize: '1kb',
        maxSize: '1mb',
        minWidth: 100,
        maxWidth: 4000,
        minHeight: 100,
        maxHeight: 4000,
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
const dawn = await upload({
  name: 'dawn.jpg',
  type: 'image/jpeg',
  size: 20000,
  width: 1200,
  height: 800,
});
const brief = await upload({ name: 'brief.pdf', type: 'application/pdf', size: 90000 });
const archive = await upload({ kind: 'folder', directory: '', name: 'archive' });

async function failing(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const result = await queryUntyped('ImagePosts').create({ title: 'Post', ...input });
  strictEqual(result.ok, false);
  ok(!result.ok);
  return { ...result.errors };
}

describe('image reference', () => {
  it('stores the UUID of an uploaded image', async () => {
    const post = await queryUntyped('ImagePosts').createOrThrow({ title: 'Sunset', cover: sunset });
    strictEqual(post.cover, sunset);
    strictEqual(post.poster, null);
  });

  it('rejects a folder', async () => {
    const errors = await failing({ cover: archive });
    strictEqual(errors.cover, 'uploads.errors.notAFile');
  });

  it('rejects a file that is not an image', async () => {
    const errors = await failing({ cover: brief });
    strictEqual(errors.cover, 'uploads.errors.notAnImage');
  });

  it('rejects an image outside `types`, naming its type', async () => {
    const errors = await failing({ hero: dawn });
    deepStrictEqual(errors.hero, {
      key: 'uploads.errors.typeNotAllowed',
      params: { type: 'image/jpeg' },
    });
  });

  it('leaves a missing row to the reference check', async () => {
    const errors = await failing({ cover: 'no-such-upload' });
    strictEqual(errors.cover, 'validation.invalidReference');
  });
});

describe('image size bounds', () => {
  it('rejects a file below `minSize`, formatting the bound', async () => {
    const tiny = await png({ name: 'tiny.png', size: 100 });
    deepStrictEqual((await failing({ hero: tiny })).hero, {
      key: 'uploads.errors.fileTooSmall',
      params: { min: '1kb' },
    });
  });

  it('rejects a file above `maxSize`, formatting the bound', async () => {
    const huge = await png({ name: 'huge.png', size: 2 * 1024 * 1024 });
    deepStrictEqual((await failing({ hero: huge })).hero, {
      key: 'uploads.errors.fileTooLarge',
      params: { max: '1mb' },
    });
  });

  it('accepts a file within the bounds', async () => {
    const post = await queryUntyped('ImagePosts').createOrThrow({ title: 'Hero', hero: sunset });
    strictEqual(post.hero, sunset);
  });
});

describe('image pixel bounds', () => {
  it('rejects an image narrower than `minWidth`', async () => {
    const narrow = await png({ name: 'narrow.png', width: 50 });
    deepStrictEqual((await failing({ hero: narrow })).hero, {
      key: 'uploads.errors.minWidth',
      params: { min: 100 },
    });
  });

  it('rejects an image wider than `maxWidth`', async () => {
    const wide = await png({ name: 'wide.png', width: 5000 });
    deepStrictEqual((await failing({ hero: wide })).hero, {
      key: 'uploads.errors.maxWidth',
      params: { max: 4000 },
    });
  });

  it('rejects an image shorter than `minHeight`', async () => {
    const short = await png({ name: 'short.png', height: 50 });
    deepStrictEqual((await failing({ hero: short })).hero, {
      key: 'uploads.errors.minHeight',
      params: { min: 100 },
    });
  });

  it('rejects an image taller than `maxHeight`', async () => {
    const tall = await png({ name: 'tall.png', height: 5000 });
    deepStrictEqual((await failing({ hero: tall })).hero, {
      key: 'uploads.errors.maxHeight',
      params: { max: 4000 },
    });
  });

  it('passes an image with no recorded dimensions', async () => {
    const unsized = await png({ name: 'unsized.png', width: null, height: null });
    const post = await queryUntyped('ImagePosts').createOrThrow({
      title: 'Unsized',
      hero: unsized,
    });
    strictEqual(post.hero, unsized);
  });
});

describe('image onDelete', () => {
  it('clears the reference when the upload is deleted', async () => {
    const gone = await png({ name: 'gone.png' });
    const post = await queryUntyped('ImagePosts').createOrThrow({ title: 'Cleared', cover: gone });
    await queryUntyped('Uploads').where({ UUID: gone }).delete();
    const read = await queryUntyped('ImagePosts').where({ UUID: post.UUID }).findFirst();
    ok(read);
    strictEqual(read.cover, null);
  });

  it('deletes the referencing row under `cascade`', async () => {
    const gone = await png({ name: 'gone-cascade.png' });
    const post = await queryUntyped('ImagePosts').createOrThrow({ title: 'Doomed', poster: gone });
    await queryUntyped('Uploads').where({ UUID: gone }).delete();
    const read = await queryUntyped('ImagePosts').where({ UUID: post.UUID }).findFirst();
    strictEqual(read, undefined);
  });
});
