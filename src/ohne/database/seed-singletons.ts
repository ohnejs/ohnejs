import { useCollections } from '../collections/use-collections.ts';
import { ohneError } from '../error/ohne-error.ts';
import { resolveMessage } from '../http/translate.ts';
import { queryUntyped } from '../query/query.ts';
import { runCreate } from '../query/write/create.ts';
import { withLock } from './with-lock.ts';

/**
 * Creates the record of every singleton collection that has none, from its field defaults.
 * Runs under the `seed` cluster lock, so instances booting together seed once.
 * The create runs outside a request, so a default or hook that reads the ambient user sees none.
 * The seed throws when a `record:validate` hook rejects the create, naming each failing field.
 */
export async function seedSingletons(): Promise<void> {
  const singletons = Object.values(useCollections().all()).filter(
    (meta) => meta.collection.singleton === true,
  );
  if (singletons.length === 0) return;
  await withLock('seed', async () => {
    for (const { name } of singletons) {
      if (await queryUntyped(name).exists()) continue;
      const outcome = await runCreate(name, {}, null);
      if (outcome.ok) continue;
      throw ohneError({
        title: `Cannot seed singleton \`${name}\``,
        body: [
          'The record is created from the field defaults, and the create failed validation.',
          '',
          ...Object.entries(outcome.errors).map(
            ([field, message]) => `- \`${field}\`: ${resolveMessage(message)}`,
          ),
        ],
      });
    }
  });
}
