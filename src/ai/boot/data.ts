import { hook, ohneError, queryMetadata, useCollections } from 'ohnejs';
import { didYouMean, isUndefined } from 'ohnejs/utils';

import { useAIConfig } from '../config.ts';

// Once every collection is registered, so a name the schema lacks is known to be wrong.
hook('server:ready', assertReach);

/**
 * Refuses a collection or field the schema lacks in `ai.data`, `ai.autoAccept.fields` or `ai.deny`.
 * A name that matches nothing would open or deny nothing, without a word.
 * A listed field must also be readable, since a value the API never returns cannot reach a model.
 */
function assertReach(): void {
  const { data, autoAccept, deny } = useAIConfig();
  for (const name of deny.collections) assertCollection('deny.collections', name);
  for (const [key, opened] of Object.entries({ data, 'autoAccept.fields': autoAccept.fields })) {
    for (const [collection, fields] of Object.entries(opened)) {
      assertCollection(key, collection);
      if (isUndefined(fields) || fields === true) continue;
      const readable = readableFields(collection);
      const field = fields.find((name) => !readable.includes(name));
      if (isUndefined(field)) continue;
      const near = didYouMean(field, readable);
      throw ohneError({
        title: `\`ai.${key}\` names unknown field \`${collection}.${field}\``,
        body: [
          `\`${collection}\` has no readable field \`${field}\`.`,
          ...(isUndefined(near) ? [] : [`Did you mean \`${near}\`?`]),
        ],
      });
    }
  }
}

/**
 * Refuses `name`, listed under `ai.<key>`, when no collection by that name is registered.
 */
function assertCollection(key: string, name: string): void {
  const names = useCollections().keys();
  if (names.includes(name)) return;
  const near = didYouMean(name, names);
  throw ohneError({
    title: `\`ai.${key}\` names unknown collection \`${name}\``,
    body: [
      `No collection \`${name}\` is registered.`,
      ...(isUndefined(near) ? [] : [`Did you mean \`${near}\`?`]),
    ],
  });
}

/**
 * The fields of `collection` a read may return.
 */
function readableFields(collection: string): string[] {
  const { fields } = queryMetadata(collection);
  return Object.keys(fields).filter((name) => fields[name].readable !== false);
}
