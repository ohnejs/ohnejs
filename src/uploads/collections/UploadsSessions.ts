import { defineCollection, field } from 'ohnejs';

import { canonicalDirectory, canonicalName } from '../uploads/path.ts';

/**
 * The `UploadsSessions` collection: resumable uploads in flight, one row each.
 *
 * A session takes one file in chunks over separate requests, so a lost connection loses no confirmed bytes.
 * Each chunk goes to storage as one part of the object at `.tmp/<UUID>`, a key derived from the row.
 * No status column: `token` and `upload` encode the phase.
 * The session is open while `token` holds the storage's handle.
 * It is sealed once the parts are assembled and `token` is `null`, and completed once `upload` is set.
 * A `null` `token` while `offset` is below `size` is a handle lost to a crash.
 * The next chunk or completion discards such a session.
 * `expiresAt` is fixed at create and never extended, and a sweep discards every session past it.
 * The row is bookkeeping, so every read and write of it skips the app's scoping hooks.
 * Never exposed over the API.
 */
export default defineCollection({
  fields: {
    author: field('record', {
      collection: 'Users',
      label: 'uploads.sessions.author.label',
      description: 'uploads.sessions.author.description',
    }),

    directory: field('text', {
      allowEmpty: true,
      immutable: true,
      sanitizers: [canonicalDirectory],
      label: 'uploads.sessions.directory.label',
      description: 'uploads.sessions.directory.description',
    }),

    name: field('text', {
      immutable: true,
      sanitizers: [canonicalName],
      label: 'uploads.sessions.name.label',
      description: 'uploads.sessions.name.description',
    }),

    type: field('text', {
      immutable: true,
      label: 'uploads.sessions.type.label',
      description: 'uploads.sessions.type.description',
    }),

    size: field('integer', {
      min: 1,
      immutable: true,
      label: 'uploads.sessions.size.label',
      description: 'uploads.sessions.size.description',
    }),

    chunkSize: field('integer', {
      min: 1,
      immutable: true,
      label: 'uploads.sessions.chunkSize.label',
      description: 'uploads.sessions.chunkSize.description',
    }),

    offset: field('integer', {
      min: 0,
      default: 0,
      label: 'uploads.sessions.offset.label',
      description: 'uploads.sessions.offset.description',
    }),

    hashState: field('text', {
      nullable: true,
      label: 'uploads.sessions.hashState.label',
      description: 'uploads.sessions.hashState.description',
    }),

    token: field('text', {
      nullable: true,
      label: 'uploads.sessions.token.label',
      description: 'uploads.sessions.token.description',
    }),

    receipts: field('text', {
      default: '[]',
      label: 'uploads.sessions.receipts.label',
      description: 'uploads.sessions.receipts.description',
    }),

    width: field('integer', {
      nullable: true,
      min: 1,
      label: 'uploads.sessions.width.label',
      description: 'uploads.sessions.width.description',
    }),

    height: field('integer', {
      nullable: true,
      min: 1,
      label: 'uploads.sessions.height.label',
      description: 'uploads.sessions.height.description',
    }),

    upload: field('record', {
      collection: 'Uploads',
      onDelete: 'cascade',
      label: 'uploads.sessions.upload.label',
      description: 'uploads.sessions.upload.description',
    }),

    expiresAt: field('dateTime', {
      index: true,
      label: 'uploads.sessions.expiresAt.label',
      description: 'uploads.sessions.expiresAt.description',
    }),
  },
});
