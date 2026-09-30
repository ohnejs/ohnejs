import { defineCollection, field } from 'ohnejs';

import { CLOSE_REASONS } from '../turns/state.ts';

/**
 * The `AITurns` collection: one assistant turn per row, its whole state between steps.
 *
 * A step reads the row, runs, and writes it back, so any instance can take the next step.
 * The transcript is provider-native JSON and only ever grows.
 * `batches` holds the proposals of each step; the last one without reported results is pending.
 * Beside each proposal it keeps what the browser reported, a claim the server never checks.
 * `page` freezes the dashboard path the person asked from, so every step reads the same context.
 * `flow` holds a flow turn's walk: the flow, the typed message, the node running and the nodes still to run.
 * `closedAt` and `reason` stay empty while the turn is open.
 * `input`, `skill` and `texts` keep what the person typed and read, so a chat replays without its transcript.
 * A follow-up keeps its chat's first turn in `chat`.
 * The person lists and reopens their chats through `GET /ai/chats`.
 * `ai.audit.retain` sets how long a closed turn stays.
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

    input: field('text', {
      nullable: true,
      immutable: true,
      label: 'ai.turns.input.label',
      description: 'ai.turns.input.description',
    }),

    skill: field('text', {
      nullable: true,
      immutable: true,
      label: 'ai.turns.skill.label',
      description: 'ai.turns.skill.description',
    }),

    chat: field('text', {
      nullable: true,
      immutable: true,
      index: true,
      label: 'ai.turns.chat.label',
      description: 'ai.turns.chat.description',
    }),

    flow: field('text', {
      nullable: true,
      label: 'ai.turns.flow.label',
      description: 'ai.turns.flow.description',
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

    texts: field('text', {
      nullable: true,
      label: 'ai.turns.texts.label',
      description: 'ai.turns.texts.description',
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

    reason: field('select', {
      choices: [...CLOSE_REASONS],
      nullable: true,
      label: 'ai.turns.reason.label',
      description: 'ai.turns.reason.description',
    }),
  },
});
