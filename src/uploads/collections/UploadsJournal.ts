import { defineCollection, field } from 'ohnejs';

/**
 * The `UploadsJournal` collection: storage effects waiting to run, one row each.
 *
 * Storage is not transactional.
 * A helper writes the effect here, inside the transaction that changes `Uploads`.
 * A drain runs each entry against storage after the commit and deletes it once it succeeded.
 * An entry that fails waits for the next drain, and every drain replays at `server:ready`.
 * `UUID`s are time-ordered, so a drain ordered by `UUID` runs entries in the order they were written.
 * Never exposed over the API.
 */
export default defineCollection({
  fields: {
    op: field('select', {
      choices: ['move', 'delete'],
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
