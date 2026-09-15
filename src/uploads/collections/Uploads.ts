import { defineCollection, field } from 'ohnejs';

import { canonicalDirectory, canonicalName } from '../uploads/path.ts';

/**
 * The `Uploads` collection: every file and folder of the media library, one row each.
 *
 * A row's location is its `directory` plus `name`; the pair is unique, as on a filesystem.
 * `directory` is the parent path with no leading slash, `''` at the root.
 * Listing a folder is therefore one equality.
 * A folder row holds no bytes: its `type`, `size`, and `hash` stay `null`.
 * A file row's path is also its storage key and its public URL, so moving a file moves its object.
 * The helpers in `ohnejs/uploads` keep rows and objects in agreement.
 * The collections API opens only `read`, guarded by the `collection.Uploads.read` capability.
 * Every read row is decorated with `path`, and a file row with `url`.
 * A file row gets `variants` too when an image service is configured and renders its type.
 */
const uploads = defineCollection({
  api: { read: true },
  compositeIndexes: [{ fields: ['directory', 'name'], unique: true }],
  dashboard: { icon: 'library-photo', recordLabel: 'name' },
  fields: {
    kind: field('select', {
      choices: ['file', 'folder'],
      immutable: true,
      label: 'uploads.fields.kind.label',
      description: 'uploads.fields.kind.description',
    }),

    directory: field('text', {
      allowEmpty: true,
      index: true,
      sanitizers: [canonicalDirectory],
      label: 'uploads.fields.directory.label',
      description: 'uploads.fields.directory.description',
    }),

    name: field('text', {
      sanitizers: [canonicalName],
      label: 'uploads.fields.name.label',
      description: 'uploads.fields.name.description',
    }),

    type: field('text', {
      nullable: true,
      immutable: true,
      label: 'uploads.fields.type.label',
      description: 'uploads.fields.type.description',
    }),

    size: field('integer', {
      nullable: true,
      min: 0,
      label: 'uploads.fields.size.label',
      description: 'uploads.fields.size.description',
    }),

    hash: field('text', {
      nullable: true,
      index: true,
      label: 'uploads.fields.hash.label',
      description: 'uploads.fields.hash.description',
    }),

    width: field('integer', {
      nullable: true,
      min: 1,
      label: 'uploads.fields.width.label',
      description: 'uploads.fields.width.description',
    }),

    height: field('integer', {
      nullable: true,
      min: 1,
      label: 'uploads.fields.height.label',
      description: 'uploads.fields.height.description',
    }),

    description: field('text', {
      nullable: true,
      translatable: true,
      multiline: true,
      label: 'uploads.fields.description.label',
      description: 'uploads.fields.description.description',
    }),

    focalX: field('number', {
      nullable: true,
      min: 0,
      max: 1,
      label: 'uploads.fields.focalX.label',
      description: 'uploads.fields.focalX.description',
    }),

    focalY: field('number', {
      nullable: true,
      min: 0,
      max: 1,
      label: 'uploads.fields.focalY.label',
      description: 'uploads.fields.focalY.description',
    }),

    author: field('record', {
      collection: 'Users',
      label: 'uploads.fields.author.label',
      description: 'uploads.fields.author.description',
    }),

    uploadedAt: field('dateTime', {
      default: () => Date.now(),
      label: 'uploads.fields.uploadedAt.label',
      description: 'uploads.fields.uploadedAt.description',
    }),
  },
});

/**
 * The `Uploads` definition, for an app that spreads it to add `access` scoping or drop `author`.
 */
export const uploadsDefinition: typeof uploads = uploads;

export default uploads;
