import { defineCollection, field } from 'ohnejs';

/**
 * The `UploadsJournal` collection: storage effects waiting to run, one row each.
 *
 * Storage is not transactional.
 * A helper writes the effect here, inside the transaction that changes `Uploads`.
 * A drain runs each entry against storage after the commit and deletes it once it succeeded.
 * Each entry takes the next `sequence`, and a drain runs entries in that order.
 * An entry from before entries were numbered holds `null` and runs first, as it was written first.
 * An entry that fails waits for the next drain, and so does every later entry touching its paths.
 * A drain also runs at `schema:synced`.
 * Never exposed over the API.
 */
export default defineCollection({
  fields: {
    sequence: field('integer', {
      nullable: true,
      unique: true,
      immutable: true,
      label: 'uploads.journal.sequence.label',
      description: 'uploads.journal.sequence.description',
    }),

    op: field('select', {
      choices: ['move', 'delete', 'lock', 'unlock'],
      immutable: true,
      label: 'uploads.journal.op.label',
      description: 'uploads.journal.op.description',
    }),

    from: field('text', {
      allowEmpty: true,
      immutable: true,
      label: 'uploads.journal.from.label',
      description: 'uploads.journal.from.description',
    }),

    to: field('text', {
      nullable: true,
      immutable: true,
      label: 'uploads.journal.to.label',
      description: 'uploads.journal.to.description',
    }),
  },
});
