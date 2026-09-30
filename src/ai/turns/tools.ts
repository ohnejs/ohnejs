import type { ToolDefinition } from '../providers/provider.ts';

/**
 * The name of a tool the model may call.
 *
 * - `request`: proposes HTTP requests for the person to send.
 * - `describe`: reads one collection's fields.
 * - `skill`: reads a skill's instructions.
 * - `open`: opens a dashboard page for the person.
 */
export type ToolName = 'request' | 'describe' | 'skill' | 'open';

const PROPOSAL_SCHEMA = {
  type: 'object',
  properties: {
    route: { type: 'string', description: 'A route id from "Your routes", exactly as listed.' },
    params: {
      type: 'object',
      additionalProperties: { type: 'string' },
      description: "The route's `[param]` values, such as `uuid`.",
    },
    query: { type: 'object', description: 'The URL params the route takes, such as `locale`.' },
    body: { type: 'object', description: 'The JSON body.' },
    where: {
      type: 'object',
      description: 'A write by set: the filter of the records to write, in place of `params`.',
    },
  },
  required: ['route'],
  additionalProperties: false,
};

/**
 * The tools of every step, in the order the guard names them.
 * `request` takes a batch of proposals; `describe` and `skill` take one name each and are strict.
 * `open` takes a page or a record.
 */
export const TOOLS: readonly ToolDefinition[] = [
  {
    name: 'request',
    description:
      'Proposes HTTP requests for the person to send, in order. Each answers one receipt, in order. Reads run at once; writes wait for approval.',
    input: {
      type: 'object',
      properties: { requests: { type: 'array', items: PROPOSAL_SCHEMA } },
      required: ['requests'],
      additionalProperties: false,
    },
  },
  {
    name: 'describe',
    description:
      'Describes one collection: its fields, types, choices and flags. Use it when a receipt says `invalidField`.',
    input: {
      type: 'object',
      properties: { collection: { type: 'string', description: 'The collection name.' } },
      required: ['collection'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: 'skill',
    description: 'Reads a skill\'s instructions, by its name under "Skills".',
    input: {
      type: 'object',
      properties: { name: { type: 'string', description: 'The skill name.' } },
      required: ['name'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: 'open',
    description:
      'Opens a dashboard page for the person: a path under "Your pages", or a record you read by `collection` and `uuid`. Use it only when the person asks to see something. One per step.',
    input: {
      type: 'object',
      properties: {
        page: { type: 'string', description: 'A path from "Your pages", exactly as listed.' },
        collection: { type: 'string', description: 'The collection of the record.' },
        uuid: { type: 'string', description: 'The record `UUID`, from a receipt.' },
      },
      additionalProperties: false,
    },
  },
];
