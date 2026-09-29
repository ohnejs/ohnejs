import type { ToolDefinition } from '../providers/provider.ts';

/**
 * The name of a tool the model may call.
 *
 * - `request`: proposes HTTP requests for the person to send.
 * - `describe`: reads one collection's fields.
 * - `skill`: reads a skill's instructions.
 */
export type ToolName = 'request' | 'describe' | 'skill';

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
];
