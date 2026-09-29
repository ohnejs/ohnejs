import { defineCollection, field } from 'ohnejs';

/**
 * The `AITurns` collection: one assistant turn per row, its whole state between steps.
 *
 * A step reads the row, runs, and writes it back, so any instance can take the next step.
 * The transcript is provider-native JSON and only ever grows.
 * `batches` holds the proposals of each step; the last one without reported results is pending.
 * `page` freezes the dashboard route the person asked from, so every step reads the same context.
 * `closedAt` stays empty while the turn is open.
 * Deleting a user deletes their turns.
 * Never exposed over the API.
 */
export default defineCollection({
  fields: {
    user: field('record', {
      collection: 'Users',
      onDelete: 'cascade',
      immutable: true,
      label: 'ai.turns.user.label',
      description: 'ai.turns.user.description',
    }),

    model: field('text', {
      immutable: true,
      label: 'ai.turns.model.label',
      description: 'ai.turns.model.description',
    }),

    page: field('text', {
      immutable: true,
      label: 'ai.turns.page.label',
      description: 'ai.turns.page.description',
    }),

    transcript: field('text', {
      default: '[]',
      label: 'ai.turns.transcript.label',
      description: 'ai.turns.transcript.description',
    }),

    batches: field('text', {
      default: '[]',
      label: 'ai.turns.batches.label',
      description: 'ai.turns.batches.description',
    }),

    step: field('integer', {
      min: 0,
      default: 0,
      label: 'ai.turns.step.label',
      description: 'ai.turns.step.description',
    }),

    usage: field('text', {
      default: JSON.stringify({ fresh: 0, cacheRead: 0, cacheWrite: 0, output: 0 }),
      label: 'ai.turns.usage.label',
      description: 'ai.turns.usage.description',
    }),

    closedAt: field('dateTime', {
      nullable: true,
      index: true,
      label: 'ai.turns.closedAt.label',
      description: 'ai.turns.closedAt.description',
    }),
  },
});
